import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OrganizationMemberRoleSchema,
  canActOnRole,
  canManageTeam,
  inviteStatus,
  maskEmail,
  normalizeInviteEmail,
  type AcceptInviteFailure,
  type InviteEmailStatus,
  type InviteViewer,
  type Organization,
  type OrganizationInvite,
  type OrganizationInvitePreview,
  type OrganizationMemberRole,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { optionalAuth, requireAuth } from '../auth.js';
import { rateLimit, type RateLimitBucket } from '../lib/rateLimit.js';
import { sendResendEmail } from '../lib/resend.js';
import {
  DEMO_INVITE_ACCEPT_BLOCKED_MESSAGE,
  DEMO_INVITE_BLOCKED_MESSAGE,
} from '../demo/constants.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const QUARTER_HOUR_MS = 15 * 60 * 1000;

const INVITE_SENDS: RateLimitBucket = new Map();
const INVITE_SENDS_PER_HOUR = 30;
const INVITE_LOOKUPS: RateLimitBucket = new Map();
const INVITE_LOOKUPS_PER_WINDOW = 60;
const INVITE_ACCEPTS: RateLimitBucket = new Map();
const INVITE_ACCEPTS_PER_WINDOW = 20;

const UuidSchema = z.string().uuid();
// The token travels in request bodies, never in API paths, so it stays out of access logs.
const TokenBodySchema = z.object({ token: z.string().min(20).max(200) });
const CreateInviteBodySchema = z.object({
  email: z.string().trim().email().max(320),
  role: OrganizationMemberRoleSchema,
});
const ResendBodySchema = z.object({ sendEmail: z.boolean().default(true) });
const ChangeRoleBodySchema = z.object({ role: OrganizationMemberRoleSchema });

const ROLE_LABEL: Record<OrganizationMemberRole, string> = {
  owner: 'an owner',
  admin: 'an admin',
  director: 'a tournament director',
  arbiter: 'an arbiter',
};

const ACCEPT_FAILURE: Record<AcceptInviteFailure, { status: number; message: string }> = {
  not_found: { status: 404, message: 'This invite link is not valid.' },
  used: { status: 410, message: 'This invite has already been used.' },
  revoked: { status: 410, message: 'This invite was withdrawn. Ask for a new one.' },
  expired: { status: 410, message: 'This invite has expired. Ask for a new one.' },
  wrong_email: { status: 403, message: 'This invite was sent to a different email address.' },
};

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/** From server config, never from request headers, which would let a caller rewrite the email's link. */
function inviteUrlFor(token: string): string {
  const base = (process.env['PUBLIC_APP_URL'] ?? 'https://chess-manager.alokas.com').replace(/\/+$/, '');
  return `${base}/invite/${token}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function emailInvite(
  request: FastifyRequest,
  invite: OrganizationInvite,
  organizationName: string,
  url: string,
): Promise<InviteEmailStatus> {
  if (!process.env['RESEND_API_KEY']) return 'not_configured';
  const org = escapeHtml(organizationName);
  try {
    const sent = await sendResendEmail({
      to: invite.email,
      subject: `You're invited to ${organizationName} on Chess Alokas`,
      html: `<p>You've been invited to join <strong>${org}</strong> on Chess Alokas as ${ROLE_LABEL[invite.role]}.</p>
<p><a href="${escapeHtml(url)}">Accept the invite</a></p>
<p>The link works once, for ${escapeHtml(invite.email)}, and expires in 7 days. If you weren't expecting it, you can ignore this email.</p>`,
    });
    if (!sent.ok) {
      request.log.warn({ inviteId: invite.id }, 'invite email failed');
      return 'failed';
    }
    return 'sent';
  } catch {
    request.log.warn({ inviteId: invite.id }, 'invite email failed');
    return 'failed';
  }
}

function userIdOf(request: FastifyRequest): string {
  return request.userId ?? DEFAULT_USER_ID;
}

function isBlocked(org: Organization): boolean {
  return org.verificationStatus === 'suspended' || org.verificationStatus === 'rejected';
}

export const teamPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  /** The caller's role, or null after replying. A bad id and a missing org look the same. */
  async function roleInOrganization(
    organizationId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<OrganizationMemberRole | null> {
    if (!UuidSchema.safeParse(organizationId).success) {
      reply.code(404).send({ error: 'Organization not found' });
      return null;
    }
    const role = await store.getOrganizationMemberRole(organizationId, userIdOf(request));
    if (!role) {
      reply.code(403).send({ error: 'Forbidden' });
      return null;
    }
    return role;
  }

  async function teamManagerRole(
    organizationId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<OrganizationMemberRole | null> {
    const role = await roleInOrganization(organizationId, request, reply);
    if (role && !canManageTeam(role)) {
      reply.code(403).send({ error: 'Only owners and admins can manage the team.' });
      return null;
    }
    return role;
  }

  function withinSendLimit(request: FastifyRequest, reply: FastifyReply): boolean {
    if (rateLimit(INVITE_SENDS, userIdOf(request), INVITE_SENDS_PER_HOUR, HOUR_MS)) return true;
    reply.code(429).send({ error: 'Too many invites sent. Try again in an hour.' });
    return false;
  }

  // ---- Members ----

  app.get<{ Params: { id: string } }>(
    '/organizations/:id/members',
    { preHandler: requireAuth },
    async (request, reply) => {
      const role = await roleInOrganization(request.params.id, request, reply);
      if (!role) return;
      return { members: await store.listOrganizationMembers(request.params.id), yourRole: role };
    },
  );

  app.patch<{ Params: { id: string; userId: string }; Body: unknown }>(
    '/organizations/:id/members/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, userId: target } = request.params;
      const actor = await teamManagerRole(id, request, reply);
      if (!actor) return;
      const parsed = ChangeRoleBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Choose a valid role.' });
      if (!UuidSchema.safeParse(target).success) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      const current = await store.getOrganizationMemberRole(id, target);
      if (!current) return reply.code(404).send({ error: 'Member not found' });
      if (!canActOnRole(actor, current) || !canActOnRole(actor, parsed.data.role)) {
        return reply.code(403).send({ error: 'You cannot manage a role above your own.' });
      }
      const role = await store.updateOrganizationMemberRole(id, target, parsed.data.role);
      if (!role) return reply.code(404).send({ error: 'Member not found' });
      return { userId: target, role };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/organizations/:id/members/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, userId: target } = request.params;
      const actor = await teamManagerRole(id, request, reply);
      if (!actor) return;
      if (!UuidSchema.safeParse(target).success) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      const current = await store.getOrganizationMemberRole(id, target);
      if (!current) return reply.code(404).send({ error: 'Member not found' });
      if (!canActOnRole(actor, current)) {
        return reply.code(403).send({ error: 'You cannot manage a role above your own.' });
      }
      await store.removeOrganizationMember(id, target);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/organizations/:id/leave',
    { preHandler: requireAuth },
    async (request, reply) => {
      const role = await roleInOrganization(request.params.id, request, reply);
      if (!role) return;
      await store.removeOrganizationMember(request.params.id, userIdOf(request));
      return reply.code(204).send();
    },
  );

  // ---- Invites ----

  app.get<{ Params: { id: string } }>(
    '/organizations/:id/invites',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await teamManagerRole(request.params.id, request, reply))) return;
      const invites = await store.listOrganizationInvites(request.params.id);
      return { invites: invites.map((i) => ({ ...i, status: inviteStatus(i) })) };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/organizations/:id/invites',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const actor = await teamManagerRole(id, request, reply);
      if (!actor) return;
      const parsed = CreateInviteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Enter a valid email address and role.' });
      }
      if (!canActOnRole(actor, parsed.data.role)) {
        return reply.code(403).send({ error: 'You cannot invite someone above your own role.' });
      }
      const org = await store.getOrganization(id);
      if (!org) return reply.code(404).send({ error: 'Organization not found' });
      if (isBlocked(org)) {
        return reply.code(403).send({ error: 'This organization cannot invite anyone right now.' });
      }
      if (org.isDemo) {
        return reply.code(403).send({ error: DEMO_INVITE_BLOCKED_MESSAGE, code: 'DEMO_ORGANIZATION' });
      }
      if (!withinSendLimit(request, reply)) return;

      const now = new Date();
      const { token, tokenHash } = newInviteToken();
      const invite = await store.createOrganizationInvite({
        id: crypto.randomUUID(),
        organizationId: id,
        email: normalizeInviteEmail(parsed.data.email),
        role: parsed.data.role,
        tokenHash,
        invitedBy: request.userId ?? null,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
        createdAt: now.toISOString(),
      });
      const inviteUrl = inviteUrlFor(token);
      const emailStatus = await emailInvite(request, invite, org.name, inviteUrl);
      return reply
        .code(201)
        .send({ invite: { ...invite, status: inviteStatus(invite) }, inviteUrl, emailStatus });
    },
  );

  /**
   * Only the hash is stored, so a link can't be shown twice. This issues a new one, which
   * also restarts the 7 days and stops the old link working.
   */
  app.post<{ Params: { id: string; inviteId: string }; Body: unknown }>(
    '/organizations/:id/invites/:inviteId/resend',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, inviteId } = request.params;
      const actor = await teamManagerRole(id, request, reply);
      if (!actor) return;
      if (!UuidSchema.safeParse(inviteId).success) {
        return reply.code(404).send({ error: 'Invite not found' });
      }
      const parsed = ResendBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
      const existing = await store.getOrganizationInvite(id, inviteId);
      if (!existing) return reply.code(404).send({ error: 'Invite not found' });
      if (!canActOnRole(actor, existing.role)) {
        return reply.code(403).send({ error: 'You cannot manage a role above your own.' });
      }
      const org = await store.getOrganization(id);
      if (!org) return reply.code(404).send({ error: 'Organization not found' });
      if (isBlocked(org)) {
        return reply.code(403).send({ error: 'This organization cannot invite anyone right now.' });
      }
      if (org.isDemo) {
        return reply.code(403).send({ error: DEMO_INVITE_BLOCKED_MESSAGE, code: 'DEMO_ORGANIZATION' });
      }
      if (!withinSendLimit(request, reply)) return;

      const { token, tokenHash } = newInviteToken();
      const invite = await store.rotateOrganizationInvite(
        id,
        inviteId,
        tokenHash,
        new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      );
      if (!invite) {
        return reply.code(409).send({ error: 'This invite was already accepted or withdrawn.' });
      }
      const inviteUrl = inviteUrlFor(token);
      const emailStatus: InviteEmailStatus = parsed.data.sendEmail
        ? await emailInvite(request, invite, org.name, inviteUrl)
        : 'skipped';
      return { invite: { ...invite, status: inviteStatus(invite) }, inviteUrl, emailStatus };
    },
  );

  app.delete<{ Params: { id: string; inviteId: string } }>(
    '/organizations/:id/invites/:inviteId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, inviteId } = request.params;
      const actor = await teamManagerRole(id, request, reply);
      if (!actor) return;
      if (!UuidSchema.safeParse(inviteId).success) {
        return reply.code(404).send({ error: 'Invite not found' });
      }
      const existing = await store.getOrganizationInvite(id, inviteId);
      if (!existing) return reply.code(404).send({ error: 'Invite not found' });
      if (!canActOnRole(actor, existing.role)) {
        return reply.code(403).send({ error: 'You cannot manage a role above your own.' });
      }
      const revoked = await store.revokeOrganizationInvite(id, inviteId);
      if (!revoked) {
        return reply.code(409).send({ error: 'This invite was already accepted or withdrawn.' });
      }
      return reply.code(204).send();
    },
  );

  // ---- The invited person ----

  app.post<{ Body: unknown }>(
    '/public/invites/lookup',
    { preHandler: optionalAuth },
    async (request, reply) => {
      if (!rateLimit(INVITE_LOOKUPS, request.ip, INVITE_LOOKUPS_PER_WINDOW, QUARTER_HOUR_MS)) {
        return reply.code(429).send({ error: 'Too many attempts. Try again in a few minutes.' });
      }
      const parsed = TokenBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(404).send({ error: ACCEPT_FAILURE.not_found.message });
      const found = await store.findOrganizationInviteByTokenHash(hashInviteToken(parsed.data.token));
      if (!found) return reply.code(404).send({ error: ACCEPT_FAILURE.not_found.message });

      let viewer: InviteViewer = 'signed_out';
      if (request.userId) {
        if (!request.confirmedEmail) viewer = 'unconfirmed';
        else viewer = request.confirmedEmail === found.invite.email ? 'match' : 'wrong_email';
      }
      const preview: OrganizationInvitePreview = {
        status: inviteStatus(found.invite),
        organizationName: found.organizationName,
        role: found.invite.role,
        emailHint: maskEmail(found.invite.email),
        expiresAt: found.invite.expiresAt,
        viewer,
      };
      return preview;
    },
  );

  app.post<{ Body: unknown }>(
    '/invites/accept',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.userId) return reply.code(401).send({ error: 'Sign in to accept this invite.' });
      if (!rateLimit(INVITE_ACCEPTS, request.userId, INVITE_ACCEPTS_PER_WINDOW, QUARTER_HOUR_MS)) {
        return reply.code(429).send({ error: 'Too many attempts. Try again in a few minutes.' });
      }
      const parsed = TokenBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(ACCEPT_FAILURE.not_found.status)
          .send({ error: ACCEPT_FAILURE.not_found.message, code: 'not_found' });
      }
      if (!request.confirmedEmail) {
        return reply.code(403).send({
          error: 'Confirm your email address first, using the link we sent you.',
          code: 'email_unconfirmed',
        });
      }
      if (await store.demo().isAccount(request.userId)) {
        return reply.code(403).send({ error: DEMO_INVITE_ACCEPT_BLOCKED_MESSAGE, code: 'DEMO_ACCOUNT' });
      }
      const result = await store.acceptOrganizationInvite({
        tokenHash: hashInviteToken(parsed.data.token),
        userId: request.userId,
        confirmedEmail: request.confirmedEmail,
      });
      if (!result.ok) {
        const failure = ACCEPT_FAILURE[result.code];
        return reply.code(failure.status).send({ error: failure.message, code: result.code });
      }
      return result;
    },
  );
};
