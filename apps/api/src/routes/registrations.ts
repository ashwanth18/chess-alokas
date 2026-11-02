import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { PRIVACY_NOTICE_VERSION } from '@chess-alokas/shared';
import { z } from 'zod';
import {
  AGE_PROOF_FIELD,
  DEFAULT_REGISTRATION_FORM_CONFIG,
  countRegistrationAnswers,
  maskNric,
  publicRegistrationForm,
  type Organization,
  type OrganizationMemberRole,
  type RegistrationPaymentStatus,
  type RegistrationPlayerSnapshot,
  type Tournament,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { playerLimitFor, registrationTakesReceipt } from '../db.js';
import { optionalAuth, requireAuth } from '../auth.js';
import { demoEntryRefusal } from '../demo/guards.js';
import { rateLimit, type RateLimitBucket } from '../lib/rateLimit.js';
import {
  MAX_RECEIPT_BYTES,
  decodeReceiptDataUrl,
  deleteReceipt,
  readReceipt,
  saveReceipt,
} from '../registrations/receipts.js';
import {
  FormChangeRefused,
  RegistrationAnswerError,
  RegistrationFormInputSchema,
  checkRegistrationAnswers,
  mergeRegistrationForm,
} from '../registrations/formAnswers.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

const MANAGER_ROLES: OrganizationMemberRole[] = ['owner', 'admin', 'director'];

const REGISTER_ATTEMPTS: RateLimitBucket = new Map();
const REGISTER_MAX_PER_WINDOW = 30;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;

const SCHOOL_LOOKUPS: RateLimitBucket = new Map();
const SCHOOL_LOOKUPS_PER_WINDOW = 300;
const SCHOOL_SUGGESTIONS = 8;

/** A receipt, age proof and three file questions, each at most 5 MB, as base64 in one request. */
const REGISTER_BODY_LIMIT = 36 * 1024 * 1024;

function isBlockedOrganization(org: Organization | null): boolean {
  return org?.verificationStatus === 'suspended' || org?.verificationStatus === 'rejected';
}

/** Ownerless rows exist only in local demo mode; with auth on, they belong to nobody. */
async function canManageTournament(
  store: Store,
  tournament: { ownerId?: string | null; organizationId?: string | null },
  id: string,
  userId: string,
): Promise<boolean> {
  if (process.env['AUTH_DISABLED'] === '1' && !tournament.ownerId && !tournament.organizationId) {
    return true;
  }
  return store.isTournamentOwnedBy(id, userId);
}

/**
 * Files and NRIC numbers: only an owner, admin or director of the event's organization. Stricter than
 * canManageTournament, because whoever created a tournament keeps that even after becoming an arbiter.
 */
async function canSeePrivateEntryData(
  store: Store,
  tournament: { ownerId?: string | null; organizationId?: string | null },
  id: string,
  userId: string,
): Promise<boolean> {
  if (!(await canManageTournament(store, tournament, id, userId))) return false;
  if (!tournament.organizationId) return true;
  return store.isOrganizationMember(tournament.organizationId, userId, MANAGER_ROLES);
}

/**
 * Strips internal receipt fields, the bytes of legacy rows, storage paths and the NRIC number from API
 * responses. Everything a client may hold goes through here, whoever asked.
 */
function toClientRegistration(reg: TournamentRegistration): TournamentRegistration {
  const { receiptDataUrl, receiptStoragePath, receiptContentType, nricNumber, privateFiles, ...rest } =
    reg;
  return {
    ...rest,
    hasReceipt: Boolean(receiptDataUrl || receiptStoragePath),
    nricMasked: maskNric(nricNumber),
    files: (privateFiles ?? []).map(({ storagePath: _storagePath, ...file }) => file),
  };
}

/**
 * Two live registrations with one name, where at least one has no email to tell them apart.
 * Only a hint for the organizer: two children can share a name, so both stay allowed.
 * The same name and email is refused when registering.
 */
function withDuplicateHints(registrations: TournamentRegistration[]): TournamentRegistration[] {
  const nameOf = (r: TournamentRegistration) => r.playerSnapshot.name.trim().toLowerCase();
  const live = registrations.filter((r) => r.status !== 'cancelled' && r.status !== 'rejected');
  const byName = new Map<string, TournamentRegistration[]>();
  for (const reg of live) {
    byName.set(nameOf(reg), [...(byName.get(nameOf(reg)) ?? []), reg]);
  }
  const hasEmail = (r: TournamentRegistration) => Boolean(r.playerSnapshot.email?.trim());
  return registrations.map((reg) => {
    const twins = byName.get(nameOf(reg))?.filter((other) => other.id !== reg.id) ?? [];
    const isLive = reg.status !== 'cancelled' && reg.status !== 'rejected';
    return {
      ...reg,
      possibleDuplicate:
        isLive && twins.some((other) => !hasEmail(reg) || !hasEmail(other)),
    };
  });
}

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
  registrationFormSchema: RegistrationFormInputSchema.nullable().optional(),
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
  guardianConsent: z.boolean().optional(),
  // base64 of MAX_RECEIPT_BYTES, plus the data URL prefix
  receiptDataUrl: z.string().max(7_000_100).nullable().optional(),
  // Absent from older clients. checkRegistrationAnswers decides whether the form still needs them.
  nricNumber: z.string().max(40).nullable().optional(),
  ageProofDataUrl: z.string().max(7_000_100).nullable().optional(),
  customFiles: z.record(z.string().max(7_000_100).nullable()).optional(),
});

const RECEIPT_UPLOADS: RateLimitBucket = new Map();
const RECEIPT_UPLOADS_PER_WINDOW = 20;
const RECEIPT_REFUSED =
  'This entry can’t take a receipt: it has no fee, has already been decided, or its payment is settled.';

const UploadReceiptBodySchema = z.object({
  // base64 of MAX_RECEIPT_BYTES, plus the data URL prefix
  receiptDataUrl: z.string().max(7_000_100),
});

const ReviewRegistrationBodySchema = z.object({
  action: z.enum(['approve', 'reject', 'waitlist']),
  reviewerNote: z.string().max(1000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  confirmPaymentWithoutReceipt: z.boolean().optional(),
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
      demo?: string;
    };
  }>('/public/events', { preHandler: optionalAuth }, async (request) => {
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
      // demo=1 and demo accounts see demo events even while they're off for the public.
      includeDemo:
        request.query.demo === '1' ||
        Boolean(request.userId && (await store.demo().isAccount(request.userId))),
    });
    return { events };
  });

  // 2. Public event details & registration form schema
  app.get<{ Params: { slugOrId: string } }>('/public/events/:slugOrId', async (request, reply) => {
    const { slugOrId } = request.params;
    const tournament = await store.getTournamentBySlugOrId(slugOrId);
    if (
      !tournament ||
      tournament.deletedAt ||
      !(tournament.isPublishedGlobal || tournament.registrationOpen)
    ) {
      return reply.code(404).send({ error: 'Event not found' });
    }

    const [categories, participants, org] = await Promise.all([
      store.listCategories(tournament.id),
      store.listParticipants(tournament.id),
      tournament.organizationId ? store.getOrganization(tournament.organizationId) : Promise.resolve(null),
    ]);
    if (isBlockedOrganization(org)) {
      return reply.code(404).send({ error: 'Event not found' });
    }

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
      // Rosters include minors: no school, club (imports often hold the school there),
      // home city or birth year on public pages.
      categoryIds: p.categoryIds ?? [],
    }));

    return {
      event: {
        ...(org?.isDemo ? { isDemo: true } : {}),
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
        paymentQrUrl: tournament.paymentQrUrl ?? null,
        registrationFormSchema: publicRegistrationForm(
          tournament.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG,
        ),
        organizationName: org?.name ?? null,
        publicToken: tournament.publicEnabled ? (tournament.publicToken ?? null) : null,
      },
      categories: sanitizedCategories,
      participants: sanitizedParticipants,
    };
  });

  // School suggestions on the form, from this organizer's own earlier entries. School names only,
  // with nothing about who entered them.
  app.get<{ Params: { slugOrId: string }; Querystring: { q?: string } }>(
    '/public/events/:slugOrId/schools',
    async (request, reply) => {
      const query = request.query.q?.trim() ?? '';
      if (query.length < 2 || query.length > 80) return { schools: [] };
      if (
        !rateLimit(SCHOOL_LOOKUPS, request.ip || 'unknown', SCHOOL_LOOKUPS_PER_WINDOW, REGISTER_WINDOW_MS)
      ) {
        return reply.code(429).send({ error: 'Too many requests. Try again later.' });
      }
      const tournament = await store.getTournamentBySlugOrId(request.params.slugOrId);
      if (!tournament || tournament.deletedAt || !tournament.registrationOpen) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      const org = tournament.organizationId
        ? await store.getOrganization(tournament.organizationId)
        : null;
      if (isBlockedOrganization(org)) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      const schools = await store.listKnownSchools(
        { organizationId: tournament.organizationId, ownerId: tournament.ownerId },
        query,
        SCHOOL_SUGGESTIONS,
      );
      return { schools };
    },
  );

  // 3. Submit tournament registration (supports 1-click playerProfileId autofill + receipt upload)
  app.post<{ Params: { slugOrId: string }; Body: unknown }>(
    '/public/events/:slugOrId/register',
    { preHandler: optionalAuth, bodyLimit: REGISTER_BODY_LIMIT },
    async (request, reply) => {
      const { slugOrId } = request.params;
      if (
        !rateLimit(
          REGISTER_ATTEMPTS,
          `${slugOrId}:${request.ip || 'unknown'}`,
          REGISTER_MAX_PER_WINDOW,
          REGISTER_WINDOW_MS,
        )
      ) {
        return reply.code(429).send({ error: 'Too many registrations. Try again later.' });
      }
      const tournament = await store.getTournamentBySlugOrId(slugOrId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      if (!tournament.registrationOpen) {
        return reply.code(400).send({
          error: 'Registration is currently closed for this tournament.',
        });
      }
      if (
        tournament.registrationDeadline &&
        new Date(tournament.registrationDeadline).getTime() < Date.now()
      ) {
        return reply.code(400).send({ error: 'The registration deadline has passed.' });
      }
      const eventOrg = tournament.organizationId
        ? await store.getOrganization(tournament.organizationId)
        : null;
      if (isBlockedOrganization(eventOrg)) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      const demoRefusal = await demoEntryRefusal(store, tournament, request.userId ?? null);
      if (demoRefusal) {
        return reply.code(403).send({ error: demoRefusal, code: 'DEMO_EVENT' });
      }
      if ((tournament.entryFeeCents ?? 0) > 0 && !eventOrg?.canAcceptPaidRegistrations) {
        return reply.code(403).send({
          error: 'This organizer is not currently able to accept paid registrations.',
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
      if (input.selectedCategoryId) {
        const category = await store.getCategory(input.selectedCategoryId);
        if (!category || category.deletedAt || category.tournamentId !== tournament.id) {
          return reply.code(400).send({ error: 'That category is not part of this tournament.' });
        }
      }
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
        if (!userId) {
          return reply.code(401).send({ error: 'Sign in to register with a saved player profile.' });
        }
        if (profile.accountUserId !== userId) {
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

      let checked: ReturnType<typeof checkRegistrationAnswers>;
      try {
        checked = checkRegistrationAnswers(
          tournament.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG,
          {
            customAnswers: input.customAnswers,
            customFiles: input.customFiles,
            nricNumber: input.nricNumber,
            ageProofDataUrl: input.ageProofDataUrl,
          },
        );
      } catch (err) {
        if (err instanceof RegistrationAnswerError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }

      // A current client sends this because its form shows the notice. An older one doesn't, and
      // is still welcome: it just leaves no record of acceptance.
      const acceptedNotice = input.guardianConsent === true;

      const feeCents = tournament.entryFeeCents ?? 0;
      const receiptInput = input.receiptDataUrl?.trim() || null;
      const receipt = receiptInput ? decodeReceiptDataUrl(receiptInput) : null;
      if (receiptInput && !receipt) {
        return reply.code(400).send({
          error: `Receipt must be a PNG, JPEG, WebP or PDF file of at most ${Math.floor(MAX_RECEIPT_BYTES / (1024 * 1024))} MB.`,
        });
      }
      const paymentStatus: RegistrationPaymentStatus =
        feeCents > 0
          ? receipt
            ? 'submitted'
            : 'pending_receipt'
          : 'not_required';

      // The plan's limit counts too, so a trial's extra entries wait rather than fail at approval.
      const planLimit = playerLimitFor(eventOrg, tournament);
      const rosterCap =
        tournament.maxParticipants != null && planLimit != null
          ? Math.min(tournament.maxParticipants, planLimit)
          : (tournament.maxParticipants ?? planLimit);
      const participantCount = rosterCap != null ? (await store.listParticipants(tournament.id)).length : 0;
      const isFull = rosterCap != null && participantCount >= rosterCap;

      const nowIso = new Date().toISOString();
      const registrationId = crypto.randomUUID();
      const registration: TournamentRegistration = {
        id: registrationId,
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
        customAnswers: checked.answers,
        nricNumber: checked.nricNumber,
        privateFiles: [],
        paymentStatus,
        receiptDataUrl: null,
        receiptStoragePath: null,
        receiptContentType: receipt?.contentType ?? null,
        amountCents: feeCents,
        status: isFull ? 'waitlisted' : 'pending',
        reviewerNote: null,
        reviewedAt: null,
        participantId: null,
        guardianConsentAt: acceptedNotice ? nowIso : null,
        guardianConsentNoticeVersion: acceptedNotice ? PRIVACY_NOTICE_VERSION : null,
        guardianConsentByUserId: acceptedNotice ? userId : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Saved before the row exists, so a refused or failed entry must take its files with it.
      const savedPaths: string[] = [];
      try {
        if (receipt) {
          registration.receiptStoragePath = await saveReceipt(tournament.id, registrationId, receipt);
          savedPaths.push(registration.receiptStoragePath);
        }
        for (const { field, file } of checked.files) {
          const fileId = crypto.randomUUID();
          const storagePath = await saveReceipt(tournament.id, `${registrationId}-${fileId}`, file);
          savedPaths.push(storagePath);
          registration.privateFiles!.push({
            id: fileId,
            field,
            storagePath,
            contentType: file.contentType,
            bytes: file.bytes.byteLength,
          });
        }
        const created = await store.createTournamentRegistration(registration);
        return reply.code(201).send({ registration: toClientRegistration(created) });
      } catch (err) {
        for (const file of savedPaths) {
          await deleteReceipt(file).catch(() => {
            request.log.warn({ registrationId }, 'could not remove a file from a failed registration');
          });
        }
        throw err;
      }
    },
  );

  // Everything the organizer's Registrations step needs to open, read from the server rather than
  // the desk's local copy, so the form and its answer counts are current.
  app.get<{ Params: { id: string } }>(
    '/tournaments/:id/publishing',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const org = existing.organizationId
        ? await store.getOrganization(existing.organizationId)
        : ((await store.listUserOrganizations(userId)).find((o) =>
            MANAGER_ROLES.includes(o.memberRole),
          ) ?? null);
      const form = existing.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG;
      const registrations = await store.listTournamentRegistrations(id);
      return {
        tournament: existing,
        form,
        answerCounts: countRegistrationAnswers(form.customQuestions ?? [], registrations),
        can: {
          listPublicly: org?.verificationStatus === 'verified' && Boolean(org.canPublishGlobal),
          takePaidEntries: Boolean(org?.canAcceptPaidRegistrations),
          maxPlayers: playerLimitFor(org, existing),
        },
      };
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
      if (!(await canManageTournament(store, existing, id, userId))) {
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
      // An arbiter-only membership grants nothing here, and neither does a tournament that
      // was attached to an organization its owner doesn't belong to.
      const org = existing.organizationId
        ? await store.getOrganization(existing.organizationId)
        : ((await store.listUserOrganizations(userId)).find((o) =>
            MANAGER_ROLES.includes(o.memberRole),
          ) ?? null);
      if (
        org &&
        existing.organizationId &&
        request.userId &&
        !(await store.isOrganizationMember(org.id, request.userId, MANAGER_ROLES))
      ) {
        return reply.code(403).send({ error: 'You are not a member of this organization.' });
      }

      const nextPublishedGlobal =
        data.isPublishedGlobal !== undefined
          ? data.isPublishedGlobal
          : Boolean(existing.isPublishedGlobal);
      const nextFeeCents =
        data.entryFeeCents !== undefined ? data.entryFeeCents : (existing.entryFeeCents ?? 0);

      if (isBlockedOrganization(org)) {
        const message = 'This organization is suspended or rejected and cannot publish events.';
        return reply.code(403).send({ error: message, message });
      }
      if (nextPublishedGlobal && !(org?.verificationStatus === 'verified' && org.canPublishGlobal)) {
        const message =
          'Organizer Verification is required to publish tournaments to the global discovery feed.';
        return reply.code(403).send({ error: message, message });
      }
      if (nextFeeCents > 0 && !org?.canAcceptPaidRegistrations) {
        const message = 'Organizer Verification is required to collect paid entry fees.';
        return reply.code(403).send({ error: message, message });
      }

      let publicSlug =
        data.publicSlug !== undefined
          ? data.publicSlug
            ? data.publicSlug.trim().toLowerCase()
            : null
          : (existing.publicSlug ?? null);

      if (publicSlug && publicSlug !== existing.publicSlug) {
        const taken = await store.getTournamentBySlugOrId(publicSlug);
        if (taken && taken.id !== existing.id) {
          const message = 'That link name is taken. Try another.';
          return reply.code(409).send({ error: message, message });
        }
      }

      if (!publicSlug && (data.registrationOpen || nextPublishedGlobal)) {
        let candidate = slugifyTournamentName(existing.name);
        const clash = await store.getTournamentBySlugOrId(candidate);
        if (clash && clash.id !== existing.id) {
          candidate = `${candidate}-${crypto.randomUUID().slice(0, 6)}`;
        }
        publicSlug = candidate;
      }

      let nextForm: Tournament['registrationFormSchema'];
      if (data.registrationFormSchema !== undefined) {
        try {
          nextForm = mergeRegistrationForm(
            existing.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG,
            data.registrationFormSchema ?? RegistrationFormInputSchema.parse({}),
            await store.listTournamentRegistrations(id),
          );
        } catch (err) {
          if (err instanceof FormChangeRefused) {
            return reply.code(409).send({ error: err.message, message: err.message });
          }
          throw err;
        }
      }

      // A limit above the plan's would only fail later, at approval, so it is held to the plan here.
      const planLimit = playerLimitFor(org, existing);
      const askedLimit = data.maxParticipants;
      const cappedLimit =
        askedLimit !== undefined && planLimit != null && (askedLimit == null || askedLimit > planLimit)
          ? planLimit
          : undefined;

      // An Event Pass pays for one published event. Republishing doesn't charge again.
      const chargeCredit =
        nextPublishedGlobal &&
        org?.planTier === 'event_pass' &&
        !existing.eventCreditConsumedAt;

      const updated = await store.updateTournament(id, {
        // The feed joins on organization_id, so attach the org that passed the gate.
        ...(org && !existing.organizationId ? { organizationId: org.id } : {}),
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
          ? { maxParticipants: cappedLimit ?? data.maxParticipants }
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
        ...(nextForm !== undefined ? { registrationFormSchema: nextForm } : {}),
        updatedAt: new Date().toISOString(),
      }, chargeCredit && org ? { chargeEventCreditTo: org.id } : undefined);

      if (!updated) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      const form = updated.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG;
      return {
        tournament: updated,
        ...(cappedLimit !== undefined ? { playerLimitCapped: cappedLimit } : {}),
        answerCounts: countRegistrationAnswers(
          form.customQuestions ?? [],
          await store.listTournamentRegistrations(id),
        ),
      };
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
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const registrations = await store.listTournamentRegistrations(id);
      return { registrations: withDuplicateHints(registrations.map(toClientRegistration)) };
    },
  );

  // Organizer views a payment receipt. Bytes are served only from this authorised route.
  app.get<{ Params: { id: string; regId: string } }>(
    '/tournaments/:id/registrations/:regId/receipt',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, regId } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const reg = (await store.listTournamentRegistrations(id)).find((r) => r.id === regId);
      if (!reg) return reply.code(404).send({ error: 'Registration not found' });

      let receipt: { contentType: string; bytes: Uint8Array } | null = null;
      if (reg.receiptStoragePath) {
        const bytes = await readReceipt(reg.receiptStoragePath);
        if (bytes) {
          receipt = {
            contentType: reg.receiptContentType ?? 'application/octet-stream',
            bytes,
          };
        }
      } else if (reg.receiptDataUrl) {
        receipt = decodeReceiptDataUrl(reg.receiptDataUrl);
      }
      if (!receipt) return reply.code(404).send({ error: 'Receipt not found' });

      return reply
        .header('Content-Type', receipt.contentType)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(Buffer.from(receipt.bytes));
    },
  );

  // Age proof or a file answer. Bytes are served only from this authorised route.
  app.get<{ Params: { id: string; regId: string; fileId: string } }>(
    '/tournaments/:id/registrations/:regId/files/:fileId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, regId, fileId } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const reg = (await store.listTournamentRegistrations(id)).find((r) => r.id === regId);
      const file = reg?.privateFiles?.find((f) => f.id === fileId);
      if (!file) return reply.code(404).send({ error: 'File not found' });
      const bytes = await readReceipt(file.storagePath);
      if (!bytes) return reply.code(404).send({ error: 'File not found' });
      return reply
        .header('Content-Type', file.contentType)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(Buffer.from(bytes));
    },
  );

  // The full NRIC number, when an organizer opens it on purpose. Lists only ever carry the mask.
  app.get<{ Params: { id: string; regId: string } }>(
    '/tournaments/:id/registrations/:regId/nric',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, regId } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const reg = (await store.listTournamentRegistrations(id)).find((r) => r.id === regId);
      if (!reg?.nricNumber) return reply.code(404).send({ error: 'No NRIC number on this entry' });
      return reply.header('Cache-Control', 'private, no-store').send({ nricNumber: reg.nricNumber });
    },
  );

  // "Delete age proofs for this event": the age proof files and NRIC numbers. Receipts and file
  // answers stay. A file that can't be removed keeps its link, so pressing the button again retries.
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/registrations/delete-age-proofs',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId ?? DEFAULT_USER_ID;
      const existing = await store.getTournament(id);
      if (!existing || existing.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await canSeePrivateEntryData(store, existing, id, userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const confirmed = z.object({ confirm: z.literal(true) }).safeParse(request.body);
      if (!confirmed.success) {
        return reply.code(400).send({ error: 'Confirm deleting age proofs first.' });
      }
      const result = { files: 0, nricNumbers: 0, failed: 0 };
      for (const reg of await store.listTournamentRegistrations(id)) {
        const proofs = (reg.privateFiles ?? []).filter((f) => f.field === AGE_PROOF_FIELD);
        if (!reg.nricNumber && proofs.length === 0) continue;
        const removed: string[] = [];
        for (const proof of proofs) {
          try {
            await deleteReceipt(proof.storagePath);
            removed.push(proof.id);
          } catch {
            request.log.warn({ registrationId: reg.id }, 'could not remove an age proof file');
            result.failed += 1;
          }
        }
        await store.clearRegistrationPrivateData(id, reg.id, {
          nric: Boolean(reg.nricNumber),
          fileIds: removed,
        });
        result.files += removed.length;
        if (reg.nricNumber) result.nricNumbers += 1;
      }
      return result;
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
      if (!(await canManageTournament(store, existing, id, userId))) {
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
      return { ...result, registration: toClientRegistration(result.registration) };
    },
  );

  // 7. Signed-in participant/parent lists their submitted registrations
  // The person who made an entry adds a receipt later, or replaces one before it is decided.
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/player/registrations/:id/receipt',
    { preHandler: requireAuth, bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const userId = request.userId ?? DEFAULT_USER_ID;
      if (!rateLimit(RECEIPT_UPLOADS, userId, RECEIPT_UPLOADS_PER_WINDOW, REGISTER_WINDOW_MS)) {
        return reply.code(429).send({ error: 'Too many uploads. Try again later.' });
      }
      // Looked up among the caller's own entries, so someone else's looks the same as none.
      const mine = await store.listUserRegistrations(userId);
      const reg = mine.find((r) => r.id === request.params.id);
      if (!reg) return reply.code(404).send({ error: 'Registration not found' });
      if (!registrationTakesReceipt(reg)) {
        return reply.code(409).send({ error: RECEIPT_REFUSED });
      }
      const parsed = UploadReceiptBodySchema.safeParse(request.body);
      const receipt = parsed.success ? decodeReceiptDataUrl(parsed.data.receiptDataUrl) : null;
      if (!receipt) {
        return reply.code(400).send({
          error: `Receipt must be a PNG, JPEG, WebP or PDF file of at most ${Math.floor(MAX_RECEIPT_BYTES / (1024 * 1024))} MB.`,
        });
      }

      // A new name each time: an upload that loses to an organizer's decision must not overwrite
      // the file that decision was based on.
      const storagePath = await saveReceipt(
        reg.tournamentId,
        `${reg.id}-${crypto.randomUUID()}`,
        receipt,
      );
      const removeQuietly = (file: string) =>
        deleteReceipt(file).catch(() => {
          request.log.warn({ registrationId: reg.id }, 'could not remove a replaced receipt');
        });
      const result = await store.replaceRegistrationReceipt(reg.id, {
        storagePath,
        contentType: receipt.contentType,
      });
      if (!result) {
        await removeQuietly(storagePath);
        return reply.code(409).send({ error: RECEIPT_REFUSED });
      }
      if (result.previousStoragePath) await removeQuietly(result.previousStoragePath);
      return { registration: toClientRegistration(result.registration) };
    },
  );

  app.get(
    '/player/registrations',
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.userId ?? DEFAULT_USER_ID;
      const registrations = await store.listUserRegistrations(userId);
      return { registrations: registrations.map(toClientRegistration) };
    },
  );
};
