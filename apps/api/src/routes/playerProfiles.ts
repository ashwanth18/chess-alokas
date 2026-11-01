import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  GUARDIAN_CONSENT_ERROR_CODE,
  PRIVACY_NOTICE_VERSION,
  PlayerRelationshipSchema,
  guardianConsentRequired,
  type PlayerProfile,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

const UsernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9_.-]+$/i, 'Username may only contain letters, numbers, dots, underscores, and hyphens')
  .nullable()
  .optional()
  .or(z.literal(''));

const CreatePlayerProfileBodySchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  username: UsernameSchema,
  isPrimary: z.boolean().optional(),
  relationship: PlayerRelationshipSchema.default('self'),
  dateOfBirth: z.string().nullable().optional().or(z.literal('')),
  yearOfBirth: z.number().int().min(1900).max(2100).nullable().optional(),
  gender: z.string().max(32).nullable().optional(),
  nationalId: z.string().max(64).nullable().optional(),
  fideId: z.number().int().positive().nullable().optional(),
  fideStandard: z.number().int().min(0).max(3500).nullable().optional(),
  fideRapid: z.number().int().min(0).max(3500).nullable().optional(),
  fideBlitz: z.number().int().min(0).max(3500).nullable().optional(),
  school: z.string().max(160).nullable().optional(),
  club: z.string().max(160).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(64).nullable().optional(),
  guardianConsent: z.boolean().optional(),
});

const UpdatePlayerProfileBodySchema = CreatePlayerProfileBodySchema.partial();

const CONSENT_REFUSAL = {
  error: 'A parent or guardian must confirm their consent for a child’s profile.',
  code: GUARDIAN_CONSENT_ERROR_CODE,
};

export const playerProfilesPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  app.get('/player/profiles', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId ?? DEFAULT_USER_ID;
    const profiles = await store.listPlayerProfiles(userId);
    return { profiles };
  });

  app.post<{ Body: unknown }>(
    '/player/profiles',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = CreatePlayerProfileBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const userId = request.userId ?? DEFAULT_USER_ID;
      const input = parsed.data;
      const nowIso = new Date().toISOString();
      const needsConsent = guardianConsentRequired({
        relationship: input.relationship,
        yearOfBirth: input.yearOfBirth ?? null,
        dateOfBirth: input.dateOfBirth || null,
      });
      if (needsConsent && input.guardianConsent !== true) {
        return reply.code(400).send(CONSENT_REFUSAL);
      }

      const profile: PlayerProfile = {
        id: crypto.randomUUID(),
        accountUserId: userId,
        isPrimary: Boolean(input.isPrimary),
        relationship: input.relationship,
        username: input.username ? input.username.trim().toLowerCase() : null,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth || null,
        yearOfBirth: input.yearOfBirth ?? null,
        gender: input.gender ?? null,
        nationalId: input.nationalId ?? null,
        fideId: input.fideId ?? null,
        fideStandard: input.fideStandard ?? null,
        fideRapid: input.fideRapid ?? null,
        fideBlitz: input.fideBlitz ?? null,
        alokasRating: 1000,
        school: input.school ?? null,
        club: input.club ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        country: input.country || 'Malaysia',
        email: input.email || (input.relationship === 'self' ? (request.user?.email ?? null) : null),
        phone: input.phone ?? null,
        guardianConsentAt: needsConsent ? nowIso : null,
        guardianConsentNoticeVersion: needsConsent ? PRIVACY_NOTICE_VERSION : null,
        guardianConsentByUserId: needsConsent ? userId : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const created = await store.createPlayerProfile(profile);
      return reply.code(201).send({ profile: created });
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/player/profiles/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const parsed = UpdatePlayerProfileBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const { guardianConsent, ...data } = parsed.data;
      const existing = await store.getPlayerProfile(id);
      if (!existing || existing.accountUserId !== userId) {
        return reply.code(404).send({ error: 'Player profile not found' });
      }
      // Editing can turn a profile into one that needs consent, such as adding a birth year.
      const needsConsent =
        !existing.guardianConsentAt &&
        guardianConsentRequired({
          relationship: data.relationship ?? existing.relationship,
          yearOfBirth: data.yearOfBirth !== undefined ? data.yearOfBirth : existing.yearOfBirth,
          dateOfBirth: data.dateOfBirth !== undefined ? data.dateOfBirth || null : existing.dateOfBirth,
        });
      if (needsConsent && guardianConsent !== true) {
        return reply.code(400).send(CONSENT_REFUSAL);
      }
      const updated = await store.updatePlayerProfile(id, userId, {
        ...data,
        ...(needsConsent
          ? {
              guardianConsentAt: new Date().toISOString(),
              guardianConsentNoticeVersion: PRIVACY_NOTICE_VERSION,
              guardianConsentByUserId: userId,
            }
          : {}),
        ...(data.username !== undefined
          ? { username: data.username ? data.username.trim().toLowerCase() : null }
          : {}),
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth || null } : {}),
        ...(data.email !== undefined ? { email: data.email || null } : {}),
      });
      if (!updated) {
        return reply.code(404).send({ error: 'Player profile not found' });
      }
      return { profile: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/player/profiles/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const deleted = await store.deletePlayerProfile(id, userId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Player profile not found' });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/player/profiles/:id/claim',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      // Only a confirmed address proves who someone is. Names can be shared and FIDE ids
      // are public, so anything else in the body is ignored.
      const confirmedEmail = request.confirmedEmail ?? null;
      if (!confirmedEmail) {
        return reply.code(403).send({
          error:
            'Confirm your account email first. Past tournaments are linked using your confirmed email address.',
        });
      }
      return store.claimPastParticipations(userId, id, confirmedEmail);
    },
  );

  app.get<{ Querystring: { profileId?: string } }>(
    '/player/dashboard',
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.userId ?? DEFAULT_USER_ID;
      const profileId = request.query.profileId ?? null;
      return store.getPlayerCareerDashboard(userId, profileId, request.confirmedEmail ?? null);
    },
  );
};
