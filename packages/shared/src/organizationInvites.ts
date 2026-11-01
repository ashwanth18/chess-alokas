import { z } from 'zod';
import { OrganizationMemberRoleSchema, type OrganizationMemberRole } from './types.js';

/** Higher outranks lower. Nobody may grant, or act on, a role above their own. */
const ROLE_RANK: Record<OrganizationMemberRole, number> = {
  owner: 4,
  admin: 3,
  director: 2,
  arbiter: 1,
};

export function roleRank(role: OrganizationMemberRole): number {
  return ROLE_RANK[role];
}

export function canManageTeam(role: OrganizationMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** May someone with `actor` give out `role`, or act on a member or invite holding it? */
export function canActOnRole(
  actor: OrganizationMemberRole | null | undefined,
  role: OrganizationMemberRole,
): boolean {
  return canManageTeam(actor) && ROLE_RANK[actor!] >= ROLE_RANK[role];
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Shows enough for someone to recognise their address, without publishing it to a link holder. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export const OrganizationInviteStatusSchema = z.enum([
  'pending',
  'expired',
  'accepted',
  'revoked',
]);
export type OrganizationInviteStatus = z.infer<typeof OrganizationInviteStatusSchema>;

export const OrganizationInviteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string(),
  role: OrganizationMemberRoleSchema,
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  acceptedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type OrganizationInvite = z.infer<typeof OrganizationInviteSchema>;

export function inviteStatus(
  invite: Pick<OrganizationInvite, 'acceptedAt' | 'revokedAt' | 'expiresAt'>,
  now: Date = new Date(),
): OrganizationInviteStatus {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  return Date.parse(invite.expiresAt) <= now.getTime() ? 'expired' : 'pending';
}

export const OrganizationTeamMemberSchema = z.object({
  userId: z.string(),
  role: OrganizationMemberRoleSchema,
  /** The confirmed address they joined with. */
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  joinedAt: z.string(),
});
export type OrganizationTeamMember = z.infer<typeof OrganizationTeamMemberSchema>;

export type InviteViewer = 'signed_out' | 'unconfirmed' | 'wrong_email' | 'match';

/** What the public invite page may know. Holds no ids, and only a masked address. */
export interface OrganizationInvitePreview {
  status: OrganizationInviteStatus;
  organizationName: string;
  role: OrganizationMemberRole;
  emailHint: string;
  expiresAt: string;
  viewer: InviteViewer;
}

export type InviteEmailStatus = 'sent' | 'not_configured' | 'failed' | 'skipped';

export type AcceptInviteFailure = 'not_found' | 'used' | 'revoked' | 'expired' | 'wrong_email';

export type AcceptInviteResult =
  | {
      ok: true;
      organizationId: string;
      /** The role they hold now: an existing member keeps theirs. */
      role: OrganizationMemberRole;
      alreadyMember: boolean;
    }
  | { ok: false; code: AcceptInviteFailure };
