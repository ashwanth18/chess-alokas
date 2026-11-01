import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_REGISTRATION_FORM_CONFIG,
  RegistrationFormConfigSchema,
  type RegistrationPaymentStatus,
  type RegistrationPlayerSnapshot,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { optionalAuth, requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

function slugifyTournamentName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `event-${crypto.randomUUID().slice(0, 8)}`;
}

const UpdatePublishingBodySchema = z.object({
  publicSlug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/i, 'Slug may only contain letters, numbers, and hyphens')
    .nullable()
    .optional()
    .or(z.literal('')),
  isPublishedGlobal: z.boolean().optional(),
  registrationOpen: z.boolean().optional(),
  registrationDeadline: z.string().datetime().nullable().optional().or(z.literal('')),
  maxParticipants: z.number().int().positive().nullable().optional(),
  venueName: z.string().max(200).nullable().optional(),
  venueAddress: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  descriptionMd: z.string().max(10000).nullable().optional(),
  rulesMd: z.string().max(10000).nullable().optional(),
  timeControl: z.string().max(120).nullable().optional(),
  entryFeeCents: z.number().int().nonnegative().max(100_000_000).optional(),
  currency: z.string().max(10).optional(),
  paymentInstructions: z.string().max(4000).nullable().optional(),
  paymentQrUrl: z.string().max(2_000_000).nullable().optional(),
  registrationFormSchema: RegistrationFormConfigSchema.nullable().optional(),
});

const PublicRegisterBodySchema = z.object({
  playerProfileId: z.string().uuid().nullable().optional(),
  selectedCategoryId: z.string().uuid().nullable().optional().or(z.literal('')),
  name: z.string().trim().max(120).optional(),
  age: z.number().int().min(0).max(120).nullable().optional(),
  yearOfBirth: z.number().int().min(1900).max(2100).nullable().optional(),
  gender: z.string().max(32).nullable().optional(),
  fideId: z.number().int().positive().nullable().optional(),
  rating: z.number().int().min(0).max(3500).nullable().optional(),
  school: z.string().max(160).nullable().optional(),
  club: z.string().max(160).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(64).nullable().optional(),
  customAnswers: z.record(z.unknown()).optional(),
  receiptDataUrl: z.string().max(5_000_000).nullable().optional(),
});

const ReviewRegistrationBodySchema = z.object({
  action: z.enum(['approve', 'reject', 'waitlist']),
  reviewerNote: z.string().max(1000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});

export const registrationsPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  // 1. Public discovery feed (with optional GPS Haversine distance + text search)
  app.get<{
    Querystring: {
      lat?: string;
      lng?: string;
      radiusKm?: string;
      search?: string;
    };
  }>('/public/events', async (request) => {
    const lat = request.query.lat != null && request.query.lat !== '' ? Number(request.query.lat) : undefined;
    const lng = request.query.lng != null && request.query.lng !== '' ? Number(request.query.lng) : undefined;
    const radiusKm =
      request.query.radiusKm != null && request.query.radiusKm !== ''
        ? Number(request.query.radiusKm)
        : undefined;
    const search = request.query.search?.trim() || undefined;

    const events = await store.listPublishedEvents({
      lat: lat != null && Number.isFinite(lat) ? lat : undefined,
      lng: lng != null && Number.isFinite(lng) ? lng : undefined,
      radiusKm: radiusKm != null && Number.isFinite(radiusKm) ? radiusKm : undefined,
      search,
    });
    return { events };
  });

  // 2. Public event details & registration form schema
  app.get<{ Params: { slugOrId: string } }>('/public/events/:slugOrId', async (request, reply) => {
    const { slugOrId } = request.params;
    const tournament = await store.getTournamentBySlugOrId(slugOrId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Event not found' });
    }

    const [categories, participants, org] = await Promise.all([
      store.listCategories(tournament.id),
      store.listParticipants(tournament.id),
      tournament.organizationId ? store.getOrganization(tournament.organizationId) : Promise.resolve(null),
    ]);

    const sanitizedCategories = categories.map((c) => ({
      id: c.id,
      name: c.name,
      filter: c.filter,
      sortOrder: c.sortOrder,
      prizePlaces: c.prizePlaces ?? null,
    }));

    const sanitizedParticipants = participants.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating ?? null,
      fideId: p.fideId ?? null,
      school: p.school ?? null,
      club: p.club ?? null,
      city: p.city ?? null,
      state: p.state ?? null,
      country: p.country ?? null,
      yearOfBirth: p.yearOfBirth ?? null,
      categoryIds: p.categoryIds ?? [],
    }));

    return {
      event: {
        id: tournament.id,
        publicSlug: tournament.publicSlug ?? null,
        name: tournament.name,
        date: tournament.date ?? null,
        style: tournament.style,
        rounds: tournament.rounds,
        status: tournament.status,
        registrationOpen: Boolean(tournament.registrationOpen),
        registrationDeadline: tournament.registrationDeadline ?? null,
        maxParticipants: tournament.maxParticipants ?? null,
        registeredCount: sanitizedParticipants.length,
        venueName: tournament.venueName ?? null,
        venueAddress: tournament.venueAddress ?? null,
        city: tournament.city ?? null,
        state: tournament.state ?? null,
        country: tournament.country ?? 'Malaysia',
        latitude: tournament.latitude ?? null,
        longitude: tournament.longitude ?? null,
        descriptionMd: tournament.descriptionMd ?? null,
        rulesMd: tournament.rulesMd ?? null,
        timeControl: tournament.timeControl ?? null,
        entryFeeCents: tournament.entryFeeCents ?? 0,
        currency: tournament.currency ?? 'MYR',
        paymentInstructions:
          tournament.paymentInstructions ?? org?.paymentInstructions ?? null,
        paymentQrUrl: tournament.paymentQrUrl ?? org?.paymentQrStoragePath ?? null,
        registrationFormSchema:
          tournament.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG,
        organizationName: org?.name ?? null,
        publicToken: tournament.publicEnabled ? (tournament.publicToken ?? null) : null,
      },
      categories: sanitizedCategories,
      participants: sanitizedParticipants,
    };
  });

  // 3. Submit tournament registration (supports 1-click playerProfileId autofill + receipt upload)
  app.post<{ Params: { slugOrId: string }; Body: unknown }>(
    '/public/events/:slugOrId/register',
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { slugOrId } = request.params;
      const tournament = await store.getTournamentBySlugOrId(slugOrId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      if (!tournament.registrationOpen) {
        return reply.code(400).send({
          error: 'Registration is currently closed for this tournament.',
        });
      }

      const parsed = PublicRegisterBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid registration data',
          details: parsed.error.format(),
        });
      }

      const input = parsed.data;
      const userId = request.userId ?? null;
      let linkedProfileId: string | null = null;

      let snapshot: Partial<RegistrationPlayerSnapshot> = {
        name: input.name?.trim() || '',
        age: input.age ?? undefined,
        yearOfBirth: input.yearOfBirth ?? null,
        gender: input.gender?.trim() || null,
        fideId: input.fideId ?? null,
        rating: input.rating ?? null,
        school: input.school?.trim() || null,
        club: input.club?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        country: input.country?.trim() || 'Malaysia',
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
      };

      if (input.playerProfileId) {
        const profile = await store.getPlayerProfile(input.playerProfileId);
        if (!profile) {
          return reply.code(404).send({ error: 'Selected player profile not found' });
        }
        if (userId && profile.accountUserId !== userId) {
          return reply.code(403).send({
            error: 'Player profile does not belong to the signed-in account',
          });
        }
        linkedProfileId = profile.id;
        const bestRating =
          input.rating ??
          profile.fideStandard ??
          profile.fideRapid ??
          profile.fideBlitz ??
          null;
        const yob = input.yearOfBirth ?? profile.yearOfBirth ?? null;
        const currentYear = new Date().getFullYear();
        const computedAge =
          input.age != null
            ? input.age
            : yob != null
              ? Math.max(0, currentYear - yob)
              : undefined;

        snapshot = {
          name: input.name?.trim() || profile.fullName,
          age: computedAge,
          yearOfBirth: yob,
          gender: input.gender?.trim() || profile.gender || null,
          fideId: input.fideId ?? profile.fideId ?? null,
          rating: bestRating,
          school: input.school?.trim() || profile.school || null,
          club: input.club?.trim() || profile.club || null,
          city: input.city?.trim() || profile.city || null,
          state: input.state?.trim() || profile.state || null,
          country: input.country?.trim() || profile.country || 'Malaysia',
          email: input.email?.trim() || profile.email || request.user?.email || null,
          phone: input.phone?.trim() || profile.phone || null,
        };
      } else if (snapshot.age == null && snapshot.yearOfBirth != null) {
        snapshot.age = Math.max(0, new Date().getFullYear() - snapshot.yearOfBirth);
      }

      if (!snapshot.name || !snapshot.name.trim()) {
        return reply.code(400).send({ error: 'Player full name is required.' });
      }

      const feeCents = tournament.entryFeeCents ?? 0;
      const receiptDataUrl = input.receiptDataUrl?.trim() || null;
      const paymentStatus: RegistrationPaymentStatus =
        feeCents > 0
          ? receiptDataUrl
            ? 'submitted'
            : 'pending_receipt'
          : 'not_required';

      const nowIso = new Date().toISOString();
      const registration: TournamentRegistration = {
        id: crypto.randomUUID(),
        tournamentId: tournament.id,
        playerProfileId: linkedProfileId,
        submittedByUserId: userId,
        selectedCategoryId: input.selectedCategoryId ? input.selectedCategoryId : null,
        playerSnapshot: {
          name: snapshot.name.trim(),
          age: snapshot.age,
          yearOfBirth: snapshot.yearOfBirth ?? null,
          gender: snapshot.gender ?? null,
          fideId: snapshot.fideId ?? null,
          rating: snapshot.rating ?? null,
          school: snapshot.school ?? null,
          club: snapshot.club ?? null,
          city: snapshot.city ?? null,
          state: snapshot.state ?? null,
          country: snapshot.country ?? 'Malaysia',
          email: snapshot.email ?? null,
          phone: snapshot.phone ?? null,
        },
        customAnswers: input.customAnswers ?? {},
        paymentStatus,
        receiptDataUrl,
        amountCents: feeCents,
        status: 'pending',
        reviewerNote: null,
        reviewedAt: null,
        participantId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const created = await store.createTournamentRegistration(registration);
      return reply.code(201).send({ registration: created });
    },
  );

  // 4. Organizer updates tournament publishing, GPS venue, entry fee, and registration form config
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/publishing',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (existing.ownerId && !(await store.isTournamentOwnedBy(id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const parsed = UpdatePublishingBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid publishing configuration',
          details: parsed.error.format(),
        });
      }

      const data = parsed.data;
      const org = existing.organizationId
        ? await store.getOrganization(existing.organizationId)
        : (await store.listUserOrganizations(userId))[0] ?? null;

      const nextPublishedGlobal =
        data.isPublishedGlobal !== undefined
          ? data.isPublishedGlobal
          : Boolean(existing.isPublishedGlobal);
      const nextFeeCents =
        data.entryFeeCents !== undefined ? data.entryFeeCents : (existing.entryFeeCents ?? 0);

      if (org) {
        if (nextPublishedGlobal && !org.canPublishGlobal) {
          return reply.code(403).send({
            error:
              'Organizer Verification is required to publish tournaments to the global discovery feed.',
            message:
              'Organizer Verification is required to publish tournaments to the global discovery feed.',
          });
        }
        if (nextFeeCents > 0 && !org.canAcceptPaidRegistrations) {
          return reply.code(403).send({
            error:
              'Organizer Verification is required to collect paid entry fees.',
            message:
              'Organizer Verification is required to collect paid entry fees.',
          });
        }
      }

      let publicSlug =
        data.publicSlug !== undefined
          ? data.publicSlug
            ? data.publicSlug.trim().toLowerCase()
            : null
          : (existing.publicSlug ?? null);

      if (!publicSlug && (data.registrationOpen || nextPublishedGlobal)) {
        let candidate = slugifyTournamentName(existing.name);
        const clash = await store.getTournamentBySlugOrId(candidate);
        if (clash && clash.id !== existing.id) {
          candidate = `${candidate}-${crypto.randomUUID().slice(0, 6)}`;
        }
        publicSlug = candidate;
      }

      const updated = await store.updateTournament(id, {
        ...(data.publicSlug !== undefined || publicSlug !== existing.publicSlug
          ? { publicSlug }
          : {}),
        ...(data.isPublishedGlobal !== undefined
          ? { isPublishedGlobal: data.isPublishedGlobal }
          : {}),
        ...(data.registrationOpen !== undefined
          ? { registrationOpen: data.registrationOpen }
          : {}),
        ...(data.registrationDeadline !== undefined
          ? { registrationDeadline: data.registrationDeadline || null }
          : {}),
        ...(data.maxParticipants !== undefined
          ? { maxParticipants: data.maxParticipants }
          : {}),
        ...(data.venueName !== undefined ? { venueName: data.venueName } : {}),
        ...(data.venueAddress !== undefined ? { venueAddress: data.venueAddress } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.descriptionMd !== undefined ? { descriptionMd: data.descriptionMd } : {}),
        ...(data.rulesMd !== undefined ? { rulesMd: data.rulesMd } : {}),
        ...(data.timeControl !== undefined ? { timeControl: data.timeControl } : {}),
        ...(data.entryFeeCents !== undefined ? { entryFeeCents: data.entryFeeCents } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.paymentInstructions !== undefined
          ? { paymentInstructions: data.paymentInstructions }
          : {}),
        ...(data.paymentQrUrl !== undefined ? { paymentQrUrl: data.paymentQrUrl } : {}),
        ...(data.registrationFormSchema !== undefined
          ? { registrationFormSchema: data.registrationFormSchema }
          : {}),
        updatedAt: new Date().toISOString(),
      });

      if (!updated) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      return { tournament: updated };
    },
  );

  // 5. Organizer lists incoming registrations for a tournament
  app.get<{ Params: { id: string } }>(
    '/tournaments/:id/registrations',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (existing.ownerId && !(await store.isTournamentOwnedBy(id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const registrations = await store.listTournamentRegistrations(id);
      return { registrations };
    },
  );

  // 6. Organizer approves / waitlists / rejects a registration
  app.post<{ Params: { id: string; regId: string }; Body: unknown }>(
    '/tournaments/:id/registrations/:regId/review',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, regId } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (existing.ownerId && !(await store.isTournamentOwnedBy(id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const parsed = ReviewRegistrationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid review payload',
          details: parsed.error.format(),
        });
      }

      const result = await store.reviewTournamentRegistration(id, regId, parsed.data);
      return result;
    },
  );

  // 7. Signed-in participant/parent lists their submitted registrations
  app.get(
    '/player/registrations',
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.userId ?? DEFAULT_USER_ID;
      const registrations = await store.listUserRegistrations(userId);
      return { registrations };
    },
  );
};
