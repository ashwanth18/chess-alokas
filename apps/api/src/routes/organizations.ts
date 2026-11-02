import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  OrganizationPlanTierSchema,
  OrganizationVerificationStatusSchema,
  type Organization,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth, requirePlatformAdmin } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

function slugifyOrganizationName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `org-${crypto.randomUUID().slice(0, 8)}`;
}

const CreateOrganizationBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/i, 'Slug may only contain letters, numbers, and hyphens')
    .optional(),
  logoUrl: z.string().url().nullable().optional().or(z.literal('')).optional(),
  description: z.string().max(1000).nullable().optional(),
  website: z
    .string()
    .max(255)
    .regex(/^(https?:\/\/.+)?$/i, 'Website must start with http:// or https://')
    .nullable()
    .optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal('')).optional(),
  contactPhone: z.string().max(64).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  paymentInstructions: z.string().max(2000).nullable().optional(),
});

const UpdateOrganizationBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/i, 'Slug may only contain letters, numbers, and hyphens')
    .optional(),
  logoUrl: z.string().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  website: z
    .string()
    .max(255)
    .regex(/^(https?:\/\/.+)?$/i, 'Website must start with http:// or https://')
    .nullable()
    .optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal('')).optional(),
  contactPhone: z.string().max(64).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  paymentInstructions: z.string().max(2000).nullable().optional(),
  paymentQrStoragePath: z.string().max(500).nullable().optional(),
});

const AdminUpdateOrganizationBodySchema = z.object({
  verificationStatus: OrganizationVerificationStatusSchema.optional(),
  planTier: OrganizationPlanTierSchema.optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  maxTournamentsQuota: z.number().int().nonnegative().nullable().optional(),
  maxPlayersPerTournament: z.number().int().positive().nullable().optional(),
  eventCreditsRemaining: z.number().int().nonnegative().optional(),
  canPublishGlobal: z.boolean().optional(),
  canAcceptPaidRegistrations: z.boolean().optional(),
});

export const organizationsPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  app.get('/organizations', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId ?? DEFAULT_USER_ID;
    const organizations = await store.listUserOrganizations(userId);
    return { organizations };
  });

  app.post<{ Body: unknown }>(
    '/organizations',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = CreateOrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const userId = request.userId ?? DEFAULT_USER_ID;
      const input = parsed.data;
      const now = new Date();
      const nowIso = now.toISOString();
      const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

      let slug = (input.slug ? input.slug.toLowerCase() : slugifyOrganizationName(input.name));
      if (!input.slug) {
        const existing = await store.getOrganizationBySlug(slug);
        if (existing) {
          slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
        }
      }

      const org: Organization = {
        id: crypto.randomUUID(),
        name: input.name,
        slug,
        logoUrl: input.logoUrl || null,
        description: input.description ?? null,
        website: input.website ?? null,
        contactEmail: input.contactEmail || request.user?.email || null,
        contactPhone: input.contactPhone ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        country: input.country || 'Malaysia',
        verificationStatus: 'pending_review',
        planTier: 'trial',
        trialEndsAt,
        maxTournamentsQuota: 1,
        maxPlayersPerTournament: 24,
        eventCreditsRemaining: 0,
        canPublishGlobal: false,
        canAcceptPaidRegistrations: false,
        paymentInstructions: input.paymentInstructions ?? null,
        paymentQrStoragePath: null,
        createdBy: userId,
        verifiedAt: null,
        verifiedBy: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const created = await store.createOrganization(org, userId, request.confirmedEmail ?? null);
      return reply.code(201).send({ organization: created });
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/organizations/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getOrganization(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Organization not found' });
      }
      const allowed = await store.isOrganizationMember(id, userId, ['owner', 'admin']);
      if (!allowed) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const parsed = UpdateOrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const patch = {
        ...parsed.data,
        ...(parsed.data.slug ? { slug: parsed.data.slug.toLowerCase() } : {}),
        ...(parsed.data.contactEmail !== undefined
          ? { contactEmail: parsed.data.contactEmail || null }
          : {}),
      };
      const updated = await store.updateOrganization(id, patch);
      if (!updated) {
        return reply.code(404).send({ error: 'Organization not found' });
      }
      return { organization: updated };
    },
  );

  app.get(
    '/admin/organizations',
    { preHandler: [requireAuth, requirePlatformAdmin] },
    async () => {
      const organizations = await store.listAllOrganizationsForAdmin();
      return { organizations };
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/admin/organizations/:id',
    { preHandler: [requireAuth, requirePlatformAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await store.getOrganization(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Organization not found' });
      }
      const parsed = AdminUpdateOrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const data = parsed.data;
      const nowIso = new Date().toISOString();
      const verifiedPatch =
        data.verificationStatus === 'verified'
          ? {
              verifiedAt: existing.verifiedAt ?? nowIso,
              verifiedBy: request.userId ?? existing.verifiedBy ?? null,
            }
          : data.verificationStatus
            ? {
                verifiedAt: null,
                verifiedBy: null,
              }
            : {};

      const updated = await store.adminUpdateOrganization(id, {
        ...data,
        ...verifiedPatch,
      });
      if (!updated) {
        return reply.code(404).send({ error: 'Organization not found' });
      }
      return { organization: updated };
    },
  );
};
