import { z } from 'zod';

export const TournamentStyleSchema = z.enum(['swiss', 'dutch', 'round_robin']);
export type TournamentStyle = z.infer<typeof TournamentStyleSchema>;

export const TournamentStatusSchema = z.enum([
  'draft',
  'ready',
  'in_progress',
  'completed',
]);
export type TournamentStatus = z.infer<typeof TournamentStatusSchema>;

/** Tiebreaks applied after game score (score is always primary). */
export const TiebreakKeySchema = z.enum([
  'buchholz',
  'buchholzCut1',
  'sonnebornBerger',
  'progressive',
  'directEncounter',
  'wins',
  'rating',
  'seed',
]);
export type TiebreakKey = z.infer<typeof TiebreakKeySchema>;

/** Default pro Swiss order after score. */
export const DEFAULT_TIEBREAK_ORDER: TiebreakKey[] = [
  'buchholz',
  'buchholzCut1',
  'sonnebornBerger',
  'progressive',
  'directEncounter',
  'wins',
  'rating',
  'seed',
];

export const TIEBREAK_LABELS: Record<TiebreakKey, string> = {
  buchholz: 'Buchholz',
  buchholzCut1: 'Buchholz Cut-1',
  sonnebornBerger: 'Sonneborn-Berger',
  progressive: 'Progressive',
  directEncounter: 'Direct encounter',
  wins: 'Wins',
  rating: 'Rating',
  seed: 'Seed',
};

/** Dedupe valid keys; empty/null → default. Always keeps seed as final fallback. */
export function normalizeTiebreakOrder(
  order: TiebreakKey[] | null | undefined,
): TiebreakKey[] {
  const source = order?.length ? order : DEFAULT_TIEBREAK_ORDER;
  const seen = new Set<TiebreakKey>();
  const out: TiebreakKey[] = [];
  for (const key of source) {
    if (!TiebreakKeySchema.safeParse(key).success) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (out.length === 0) return [...DEFAULT_TIEBREAK_ORDER];
  if (!seen.has('seed')) out.push('seed');
  return out;
}

export const GameResultSchema = z.enum([
  '1-0',
  '0-1',
  '1/2-1/2',
  'bye',
  'pending',
  /** Black no-show — White wins. Unplayed: no colour, rematch allowed. */
  '1-0F',
  /** White no-show — Black wins. Unplayed: no colour, rematch allowed. */
  '0-1F',
  /** Both absent. Unplayed. */
  '0-0',
]);
export type GameResult = z.infer<typeof GameResultSchema>;

/** No-show / double no-show. Card-limit losses are played 1-0 / 0-1, not these. */
export function isAbsenceResult(result: string): boolean {
  return result === '1-0F' || result === '0-1F' || result === '0-0';
}

/** Results the floor arbiter may confirm (excludes bye/pending). */
export const ArbiterScorableResultSchema = z.enum([
  '1-0',
  '0-1',
  '1/2-1/2',
  '1-0F',
  '0-1F',
  '0-0',
]);
export type ArbiterScorableResult = z.infer<typeof ArbiterScorableResultSchema>;

export function isResultEntered(result: string, isBye = false): boolean {
  if (isBye || result === 'bye') return true;
  return result !== 'pending';
}

/** Simple filter DSL for category assignment */
export const FilterOpSchema = z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in']);
export type FilterOp = z.infer<typeof FilterOpSchema>;

export const FilterRuleSchema = z.object({
  field: z.string(),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});
export type FilterRule = z.infer<typeof FilterRuleSchema>;

export const FilterGroupSchema = z.object({
  logic: z.enum(['and', 'or']).default('and'),
  rules: z.array(FilterRuleSchema),
});
export type FilterGroup = z.infer<typeof FilterGroupSchema>;

export const CategorySchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  name: z.string().min(1),
  filter: FilterGroupSchema,
  sortOrder: z.number().int().default(0),
  /** Override tournament prizePlaces; null/undefined = inherit tournament default. */
  prizePlaces: z.number().int().min(1).max(20).nullable().optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Category = z.infer<typeof CategorySchema>;

export const ParticipantSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  name: z.string().min(1),
  age: z.number().int().nonnegative(),
  gender: z.string().nullable().optional(),
  /** FIDE (or other) rating; null/0 = unrated. */
  rating: z.number().int().nullable().optional(),
  /** Official FIDE ID when known; preferred for rating lookups. */
  fideId: z.number().int().positive().nullable().optional(),
  /** Legacy club field; prefer school when both exist. */
  club: z.string().nullable().optional(),
  school: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  yearOfBirth: z.number().int().nullable().optional(),
  email: z
    .union([z.string().email(), z.literal(''), z.null()])
    .optional(),
  customFields: z.record(z.unknown()).default({}),
  categoryIds: z.array(z.string().uuid()).default([]),
  /** Start rank / pairing number for the tournament. */
  seed: z.number().int().optional(),
  /**
   * Rounds this player is not paired for (0 points). Swiss-Manager “Exclude player”.
   * They return the following round unless also withdrawn.
   */
  excludedRounds: z.array(z.number().int().positive()).optional(),
  /** If set, excluded from this round onward (withdraw). */
  withdrawnFromRound: z.number().int().positive().nullable().optional(),
  /** Linked global player profile id (when claimed or registered via participant portal). */
  playerProfileId: z.string().uuid().nullable().optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const AwardScopeSchema = z.enum(['overall', 'per_category']);
export type AwardScope = z.infer<typeof AwardScopeSchema>;

export const TournamentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  date: z.string().nullable().optional(),
  style: TournamentStyleSchema,
  rounds: z.number().int().positive(),
  status: TournamentStatusSchema,
  currentRound: z.number().int().nonnegative().default(0),
  /**
   * Highest round the director has confirmed as finished.
   * Round N+1 cannot be paired until confirmedRounds >= N.
   */
  confirmedRounds: z.number().int().nonnegative().default(0),
  /**
   * When false (default), players only pair within their category and
   * standings are per category. When true, everyone shares one pool.
   */
  mixCategories: z.boolean().default(false),
  /** How many top places count as prize winners (podium / certificates). */
  prizePlaces: z.number().int().min(1).max(20).default(3),
  /** Whether winners certificates use overall standings or each category. */
  awardScope: AwardScopeSchema.default('per_category'),
  /**
   * Order of tiebreaks after score. Null/omit = DEFAULT_TIEBREAK_ORDER.
   * See TiebreakKeySchema.
   */
  tiebreakOrder: z.array(TiebreakKeySchema).nullable().optional(),
  /**
   * When true, players equal on performance tiebreaks share a rank (1224).
   * Rating/seed only break display order within a shared place.
   */
  sharedPlaces: z.boolean().default(true),
  /** Supabase Auth user id that owns this tournament (manager). */
  ownerId: z.string().uuid().nullable().optional(),
  /** Multi-tenant B2B organization owning this tournament. */
  organizationId: z.string().uuid().nullable().optional(),
  /** Round the current arbiter PIN is valid for (server-side hash only). */
  arbiterPinRound: z.number().int().nonnegative().nullable().optional(),
  /** Number of physical floor tables allocated for QR stickers. */
  tableCount: z.number().int().nonnegative().default(0),
  /** Unguessable token for the public live page (null until enabled once). */
  publicToken: z.string().min(8).nullable().optional(),
  /** When true, GET /public/live/:token serves sanitized pairings/standings. */
  publicEnabled: z.boolean().default(false),
  /** Mass-email subject; merge tags {{playerName}} {{tournament}} {{certType}} {{serial}}. */
  certEmailSubject: z.string().nullable().optional(),
  certEmailBody: z.string().nullable().optional(),
  /** Serial prefix, e.g. OPEN → OPEN/001/2026. Unique per tournament. */
  certSerialPrefix: z.string().min(1).max(32).nullable().optional(),
  certSerialPad: z.number().int().min(1).max(8).nullable().optional(),
  /** Next sequence number to allocate (server-authoritative). */
  certSerialNext: z.number().int().positive().optional(),
  /** Public discovery & registration fields (Phase 2). */
  publicSlug: z.string().nullable().optional(),
  isPublishedGlobal: z.boolean().optional(),
  registrationOpen: z.boolean().optional(),
  registrationDeadline: z.string().datetime().nullable().optional(),
  maxParticipants: z.number().int().positive().nullable().optional(),
  venueName: z.string().nullable().optional(),
  venueAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  descriptionMd: z.string().nullable().optional(),
  rulesMd: z.string().nullable().optional(),
  timeControl: z.string().nullable().optional(),
  entryFeeCents: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  paymentInstructions: z.string().nullable().optional(),
  paymentQrUrl: z.string().nullable().optional(),
  /** When an Event Pass credit paid for publishing this event. Charged only once. */
  eventCreditConsumedAt: z.string().datetime().nullable().optional(),
  registrationFormSchema: z
    .object({
      collectSchool: z.boolean().default(true),
      collectFideId: z.boolean().default(true),
      collectPhone: z.boolean().default(true),
      collectNric: z.boolean().default(false),
      collectAgeProof: z.boolean().default(false),
      malayLabels: z.boolean().default(false),
      customQuestions: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            labelMs: z.string().nullable().optional(),
            type: z.enum(['text', 'select', 'checkbox', 'file']).default('text'),
            required: z.boolean().default(false),
            options: z.array(z.string()).optional(),
            retiredOptions: z.array(z.string()).optional(),
            hidden: z.boolean().optional(),
          }),
        )
        .default([]),
    })
    .nullable()
    .optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  clientId: z.string().optional(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

export const TournamentTableSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  tableNumber: z.number().int().positive(),
  slug: z.string().min(8),
  createdAt: z.string().datetime(),
});
export type TournamentTable = z.infer<typeof TournamentTableSchema>;

export const ResultActorRoleSchema = z.enum(['floor', 'director']);
export type ResultActorRole = z.infer<typeof ResultActorRoleSchema>;

export const GameSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  categoryId: z.string().uuid(),
  round: z.number().int().positive(),
  board: z.number().int().positive(),
  whiteId: z.string().uuid().nullable(),
  blackId: z.string().uuid().nullable(),
  result: GameResultSchema,
  isBye: z.boolean().default(false),
  /** Set when floor arbiter confirms; public API refuses further writes. */
  resultLockedAt: z.string().datetime().nullable().optional(),
  /** Display name of who last set/confirmed this result. */
  resultEnteredByName: z.string().nullable().optional(),
  resultEnteredByRole: ResultActorRoleSchema.nullable().optional(),
  /** How many times a director overrode a prior result. */
  resultOverrideCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Game = z.infer<typeof GameSchema>;

export const GameResultEventSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  result: GameResultSchema,
  previousResult: GameResultSchema.nullable().optional(),
  actorRole: ResultActorRoleSchema,
  actorName: z.string().nullable().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type GameResultEvent = z.infer<typeof GameResultEventSchema>;

/**
 * A late correction to an entered result, queued on the game row until the server accepts it. Sent
 * in the row's payload as `corrections`. The server applies it only if `previousResult` is still
 * what it holds, so a correction made offline can't overwrite someone else's.
 */
export const GameCorrectionSchema = z.object({
  id: z.string().uuid(),
  previousResult: GameResultSchema,
  result: GameResultSchema,
  reason: z.string().trim().min(1).max(200),
  actorName: z.string().trim().max(80).nullable().optional(),
  at: z.string().datetime(),
});
export type GameCorrection = z.infer<typeof GameCorrectionSchema>;

/** Results a correction may set: anything but no result at all. */
export function isCorrectableResult(result: string): boolean {
  return result !== 'pending' && result !== 'bye';
}

/** Red card = illegal move; yellow card = warning / misconduct. */
export const GameCardTypeSchema = z.enum(['illegal_move', 'warning']);
export type GameCardType = z.infer<typeof GameCardTypeSchema>;

/** 2nd illegal move (red) → instant loss. */
export const ILLEGAL_MOVE_LIMIT = 2;
/** 3rd warning (yellow) → instant loss. */
export const WARNING_LIMIT = 3;

export function cardLimit(cardType: GameCardType): number {
  return cardType === 'illegal_move' ? ILLEGAL_MOVE_LIMIT : WARNING_LIMIT;
}

export function atCardLimit(counts: PlayerCardCounts): boolean {
  return counts.illegalMove >= ILLEGAL_MOVE_LIMIT || counts.warning >= WARNING_LIMIT;
}

/**
 * Locked board whose result was produced by a card limit (played 1-0/0-1),
 * including historical rows that were stored as 1-0F/0-1F before that split.
 */
export function isCardLimitAutoResult(
  result: string,
  locked: boolean,
  whiteCounts: PlayerCardCounts,
  blackCounts: PlayerCardCounts,
): boolean {
  if (!locked) return false;
  if (
    result !== '1-0' &&
    result !== '0-1' &&
    result !== '1-0F' &&
    result !== '0-1F'
  ) {
    return false;
  }
  return atCardLimit(whiteCounts) || atCardLimit(blackCounts);
}

/** Short floor/live banner, e.g. "2 illegal moves". */
export function cardLimitBannerReason(
  result: string,
  whiteCounts: PlayerCardCounts,
  blackCounts: PlayerCardCounts,
): string | null {
  if (
    result !== '1-0' &&
    result !== '0-1' &&
    result !== '1-0F' &&
    result !== '0-1F'
  ) {
    return null;
  }
  const offenderIsWhite = result === '0-1' || result === '0-1F';
  const counts = offenderIsWhite ? whiteCounts : blackCounts;
  if (counts.illegalMove >= ILLEGAL_MOVE_LIMIT) {
    return `${counts.illegalMove} illegal moves`;
  }
  if (counts.warning >= WARNING_LIMIT) {
    return `${counts.warning} warnings`;
  }
  if (atCardLimit(whiteCounts)) {
    if (whiteCounts.illegalMove >= ILLEGAL_MOVE_LIMIT) {
      return `${whiteCounts.illegalMove} illegal moves`;
    }
    return `${whiteCounts.warning} warnings`;
  }
  if (atCardLimit(blackCounts)) {
    if (blackCounts.illegalMove >= ILLEGAL_MOVE_LIMIT) {
      return `${blackCounts.illegalMove} illegal moves`;
    }
    return `${blackCounts.warning} warnings`;
  }
  return null;
}

export const GameCardSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  playerId: z.string().uuid(),
  cardType: GameCardTypeSchema,
  note: z.string().nullable().optional(),
  actorRole: ResultActorRoleSchema,
  actorName: z.string().nullable().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type GameCard = z.infer<typeof GameCardSchema>;

export type PlayerCardCounts = {
  illegalMove: number;
  warning: number;
};

export function emptyCardCounts(): PlayerCardCounts {
  return { illegalMove: 0, warning: 0 };
}

export function countCardsForPlayer(
  cards: Array<{ playerId: string; cardType: GameCardType; deletedAt?: string | null }>,
  playerId: string,
): PlayerCardCounts {
  const counts = emptyCardCounts();
  for (const c of cards) {
    if (c.deletedAt || c.playerId !== playerId) continue;
    if (c.cardType === 'illegal_move') counts.illegalMove += 1;
    else counts.warning += 1;
  }
  return counts;
}

export const CreateTournamentInputSchema = z.object({
  name: z.string().min(1),
  date: z.string().nullable().optional(),
  style: TournamentStyleSchema.default('swiss'),
  rounds: z.number().int().positive().default(5),
  /** Default false: separate pairing + ranking per category. */
  mixCategories: z.boolean().default(false),
  prizePlaces: z.number().int().min(1).max(20).default(3),
  awardScope: AwardScopeSchema.default('per_category'),
  tiebreakOrder: z.array(TiebreakKeySchema).nullable().optional(),
  sharedPlaces: z.boolean().default(true),
  organizationId: z.string().uuid().nullable().optional(),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        filter: FilterGroupSchema,
        sortOrder: z.number().int().optional(),
        prizePlaces: z.number().int().min(1).max(20).nullable().optional(),
      }),
    )
    .default([]),
});
export type CreateTournamentInput = z.infer<typeof CreateTournamentInputSchema>;

export const ColumnMappingSchema = z.object({
  name: z.string(),
  age: z.string(),
  gender: z.string().optional(),
  rating: z.string().optional(),
  club: z.string().optional(),
  school: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  yearOfBirth: z.string().optional(),
  email: z.string().optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export const CertificateIssueTypeSchema = z.enum(['participation', 'winner']);
export type CertificateIssueType = z.infer<typeof CertificateIssueTypeSchema>;

export const CertificateIssueStatusSchema = z.enum([
  'pending',
  'stored',
  'emailed',
  'failed',
]);
export type CertificateIssueStatus = z.infer<typeof CertificateIssueStatusSchema>;

export const CertificateIssueSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  participantId: z.string().uuid().nullable().optional(),
  type: CertificateIssueTypeSchema,
  rank: z.number().int().positive().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  recipientEmail: z.string().nullable().optional(),
  recipientName: z.string(),
  storagePath: z.string(),
  contentSha256: z.string(),
  byteSize: z.number().int().nonnegative(),
  status: CertificateIssueStatusSchema,
  /** Unique per tournament, e.g. OPEN/001/2026. */
  serial: z.string().nullable().optional(),
  emailedAt: z.string().datetime().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type CertificateIssue = z.infer<typeof CertificateIssueSchema>;

export const SyncPushItemSchema = z.object({
  entity: z.enum(['tournament', 'category', 'participant', 'game']),
  id: z.string().uuid(),
  payload: z.record(z.unknown()),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type SyncPushItem = z.infer<typeof SyncPushItemSchema>;

export const SyncPushRequestSchema = z.object({
  clientId: z.string().min(1),
  items: z.array(SyncPushItemSchema),
  /**
   * Set by clients that read `rejected` from the response. Older clients omit it and
   * get a whole-batch 4xx for a permission or quota problem, so their rows stay dirty.
   */
  reportRejections: z.boolean().optional(),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncRejectionCodeSchema = z.enum([
  /** Someone edited this row more recently. Pull brings their copy down. */
  'stale',
  /** The caller does not own this tournament, or the row belongs to another one. */
  'forbidden',
  /** organizationId names an organization the caller cannot manage. */
  'forbidden_organization',
  /** Plan limit reached. */
  'quota',
  /** The round is confirmed. Undo the confirmation to change its games. */
  'round_confirmed',
  /** A floor-locked result can only be replaced by a director result. */
  'result_locked',
  /** The parent tournament is not on the server. */
  'tournament_not_found',
  /** The payload fails validation, or refers to rows outside this tournament. */
  'invalid',
  /** Someone else changed the result first, or it can't take this one. The server's copy stands. */
  'correction_conflict',
  /** The round was undone, so this game no longer exists. The server's copy stands. */
  'game_removed',
]);
export type SyncRejectionCode = z.infer<typeof SyncRejectionCodeSchema>;

export const SyncRejectionSchema = z.object({
  entity: SyncPushItemSchema.shape.entity,
  id: z.string().uuid(),
  code: SyncRejectionCodeSchema,
  reason: z.string(),
});
export type SyncRejection = z.infer<typeof SyncRejectionSchema>;

export const SyncPushResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.array(SyncRejectionSchema),
  serverTime: z.string(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

export const SUPPORTED_STYLES: TournamentStyle[] = ['swiss', 'dutch'];
export const COMING_SOON_STYLES: TournamentStyle[] = ['round_robin'];

export function isStyleImplemented(style: TournamentStyle): boolean {
  return SUPPORTED_STYLES.includes(style);
}

// ---------------------------------------------------------------------------
// Multi-tenant B2B Organizations & Roles (Phase 1)
// ---------------------------------------------------------------------------

export const AccountRoleSchema = z.enum(['participant', 'organizer', 'both']);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const OrganizationVerificationStatusSchema = z.enum([
  'pending_review',
  'verified',
  'rejected',
  'suspended',
]);
export type OrganizationVerificationStatus = z.infer<
  typeof OrganizationVerificationStatusSchema
>;

export const OrganizationPlanTierSchema = z.enum([
  'trial',
  'event_pass',
  'pro',
  'enterprise',
]);
export type OrganizationPlanTier = z.infer<typeof OrganizationPlanTierSchema>;

export const OrganizationMemberRoleSchema = z.enum([
  'owner',
  'admin',
  'director',
  'arbiter',
]);
export type OrganizationMemberRole = z.infer<typeof OrganizationMemberRoleSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  logoUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  verificationStatus: OrganizationVerificationStatusSchema.default('pending_review'),
  planTier: OrganizationPlanTierSchema.default('trial'),
  trialEndsAt: z.string().datetime().nullable().optional(),
  maxTournamentsQuota: z.number().int().nullable().optional(),
  maxPlayersPerTournament: z.number().int().nullable().optional(),
  eventCreditsRemaining: z.number().int().nonnegative().default(0),
  canPublishGlobal: z.boolean().default(false),
  canAcceptPaidRegistrations: z.boolean().default(false),
  /** The fictional tenant for showing the product. Only the demo command sets it: docs/DEMO.md. */
  isDemo: z.boolean().optional(),
  paymentInstructions: z.string().nullable().optional(),
  paymentQrStoragePath: z.string().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
  verifiedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const OrganizationMemberSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrganizationMemberRoleSchema.default('owner'),
  createdAt: z.string().datetime(),
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;

export type AdminOrganizationRow = Organization & {
  memberCount: number;
  tournamentCount: number;
  ownerEmail?: string | null;
};

// ---------------------------------------------------------------------------
// Global B2C Player & Family Profiles (Phase 1)
// ---------------------------------------------------------------------------

export const PlayerRelationshipSchema = z.enum([
  'self',
  'child',
  'student',
  'family',
]);
export type PlayerRelationship = z.infer<typeof PlayerRelationshipSchema>;

export const PlayerProfileSchema = z.object({
  id: z.string().uuid(),
  accountUserId: z.string().uuid(),
  isPrimary: z.boolean().default(false),
  relationship: PlayerRelationshipSchema.default('self'),
  username: z.string().nullable().optional(),
  fullName: z.string().min(1),
  dateOfBirth: z.string().nullable().optional(),
  yearOfBirth: z.number().int().nullable().optional(),
  gender: z.string().nullable().optional(),
  nationalId: z.string().nullable().optional(),
  fideId: z.number().int().positive().nullable().optional(),
  fideStandard: z.number().int().nullable().optional(),
  fideRapid: z.number().int().nullable().optional(),
  fideBlitz: z.number().int().nullable().optional(),
  alokasRating: z.number().int().default(1000),
  school: z.string().nullable().optional(),
  club: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  guardianConsentAt: z.string().nullable().optional(),
  guardianConsentNoticeVersion: z.string().nullable().optional(),
  guardianConsentByUserId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export interface PlayerLiveMatchCard {
  tournamentId: string;
  tournamentName: string;
  tournamentStatus: TournamentStatus;
  publicToken: string | null;
  participantId: string;
  round: number;
  board: number;
  color: 'white' | 'black' | 'bye';
  opponentId: string | null;
  opponentName: string | null;
  opponentRating: number | null;
  result: GameResult;
  isBye: boolean;
  currentScore: number;
}

export interface PlayerTournamentHistoryItem {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  tournamentStatus: TournamentStatus;
  style: TournamentStyle;
  rounds: number;
  currentRound: number;
  participantId: string;
  playerName: string;
  rating: number | null;
  score: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  publicToken: string | null;
}

export interface PlayerCertificateItem {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  participantId: string | null;
  recipientName: string;
  type: CertificateIssueType;
  rank: number | null;
  serial: string | null;
  createdAt: string;
}

export interface PlayerCareerStats {
  tournamentsCount: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  totalPoints: number;
}

export interface PlayerCareerDashboard {
  profiles: PlayerProfile[];
  selectedProfile: PlayerProfile | null;
  liveMatches: PlayerLiveMatchCard[];
  stats: PlayerCareerStats;
  tournaments: PlayerTournamentHistoryItem[];
  certificates: PlayerCertificateItem[];
}

// ---------------------------------------------------------------------------
// Tournament Discovery, GPS Nearby Search & Shareable Registrations (Phase 2)
// ---------------------------------------------------------------------------

export const RegistrationQuestionTypeSchema = z.enum(['text', 'select', 'checkbox', 'file']);
export type RegistrationQuestionType = z.infer<typeof RegistrationQuestionTypeSchema>;

export const RegistrationCustomQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Optional Malay label. The form shows both: "T-shirt size / Saiz baju". */
  labelMs: z.string().nullable().optional(),
  type: RegistrationQuestionTypeSchema.default('text'),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  /** Removed from the form, kept because entries chose them. Never sent to public pages. */
  retiredOptions: z.array(z.string()).optional(),
  /** Off the form for new entries, kept because entries answered it. Never sent to public pages. */
  hidden: z.boolean().optional(),
});
export type RegistrationCustomQuestion = z.infer<typeof RegistrationCustomQuestionSchema>;

export const RegistrationFormConfigSchema = z.object({
  collectSchool: z.boolean().default(true),
  collectFideId: z.boolean().default(true),
  collectPhone: z.boolean().default(true),
  collectNric: z.boolean().default(false),
  collectAgeProof: z.boolean().default(false),
  /** Shows the standard labels in English and Malay, as the organizer's own questions can be. */
  malayLabels: z.boolean().default(false),
  customQuestions: z.array(RegistrationCustomQuestionSchema).default([]),
});
export type RegistrationFormConfig = z.infer<typeof RegistrationFormConfigSchema>;

export const DEFAULT_REGISTRATION_FORM_CONFIG: RegistrationFormConfig = {
  collectSchool: true,
  collectFideId: true,
  collectPhone: true,
  collectNric: false,
  collectAgeProof: false,
  malayLabels: false,
  customQuestions: [],
};

/** A question as public pages receive it: nothing about what was hidden or retired. */
export interface PublicRegistrationQuestion {
  id: string;
  label: string;
  labelMs: string | null;
  type: RegistrationQuestionType;
  required: boolean;
  options?: string[];
}

export interface PublicRegistrationForm {
  collectSchool: boolean;
  collectFideId: boolean;
  collectPhone: boolean;
  collectNric: boolean;
  collectAgeProof: boolean;
  malayLabels: boolean;
  /** All visible questions, in order. Current clients read this. */
  questions: PublicRegistrationQuestion[];
  /** Text and select only, with both languages in `label`, for app builds that predate `questions`. */
  customQuestions: Array<{
    id: string;
    label: string;
    type: 'text' | 'select';
    required: boolean;
    options?: string[];
  }>;
}

/** A private file attached to an entry: `ageProof`, or the id of a file question. */
export const RegistrationFileFieldSchema = z.string().min(1);

export const RegistrationPrivateFileSchema = z.object({
  id: z.string().uuid(),
  field: RegistrationFileFieldSchema,
  storagePath: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export type RegistrationPrivateFile = z.infer<typeof RegistrationPrivateFileSchema>;

/** What a client is told about a private file. Bytes come from an authorised route. */
export type RegistrationFileInfo = Omit<RegistrationPrivateFile, 'storagePath'>;

export const RegistrationPaymentStatusSchema = z.enum([
  'not_required',
  'pending_receipt',
  'submitted',
  'verified',
  'refunded',
]);
export type RegistrationPaymentStatus = z.infer<typeof RegistrationPaymentStatusSchema>;

export const RegistrationStatusSchema = z.enum([
  'pending',
  'approved',
  'waitlisted',
  'rejected',
  'cancelled',
]);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const RegistrationPlayerSnapshotSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
  yearOfBirth: z.number().int().nullable().optional(),
  gender: z.string().nullable().optional(),
  fideId: z.number().int().positive().nullable().optional(),
  rating: z.number().int().nullable().optional(),
  school: z.string().nullable().optional(),
  club: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type RegistrationPlayerSnapshot = z.infer<typeof RegistrationPlayerSnapshotSchema>;

export const TournamentRegistrationSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  playerProfileId: z.string().uuid().nullable().optional(),
  submittedByUserId: z.string().uuid().nullable().optional(),
  selectedCategoryId: z.string().uuid().nullable().optional(),
  playerSnapshot: RegistrationPlayerSnapshotSchema,
  customAnswers: z.record(z.unknown()).default({}),
  paymentStatus: RegistrationPaymentStatusSchema.default('not_required'),
  /** Legacy rows only; new receipts live in private storage. Never sent to clients. */
  receiptDataUrl: z.string().nullable().optional(),
  /** Internal storage location. Never sent to clients. */
  receiptStoragePath: z.string().nullable().optional(),
  receiptContentType: z.string().nullable().optional(),
  /** Set on API responses; fetch bytes from /tournaments/:id/registrations/:regId/receipt. */
  hasReceipt: z.boolean().optional(),
  /** Internal. Only GET .../registrations/:regId/nric returns the value. Never on a participant. */
  nricNumber: z.string().nullable().optional(),
  /** Internal: age proof and file answers, with their storage paths. Never sent to clients. */
  privateFiles: z.array(RegistrationPrivateFileSchema).optional(),
  /** Set on API responses in place of nricNumber: ******-**-1234. */
  nricMasked: z.string().nullable().optional(),
  /** Set on API responses in place of privateFiles. */
  files: z.array(RegistrationPrivateFileSchema.omit({ storagePath: true })).optional(),
  amountCents: z.number().int().nonnegative().default(0),
  status: RegistrationStatusSchema.default('pending'),
  reviewerNote: z.string().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  participantId: z.string().uuid().nullable().optional(),
  guardianConsentAt: z.string().nullable().optional(),
  guardianConsentNoticeVersion: z.string().nullable().optional(),
  guardianConsentByUserId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Organizer list only: another live registration has this name and no email separates them. */
  possibleDuplicate: z.boolean().optional(),
});
export type TournamentRegistration = z.infer<typeof TournamentRegistrationSchema>;

export const PublicEventSummarySchema = z.object({
  /** A fictional event from the demo tenant. Absent on real events and older servers. */
  isDemo: z.boolean().optional(),
  id: z.string().uuid(),
  publicSlug: z.string().nullable().optional(),
  name: z.string().min(1),
  date: z.string().nullable().optional(),
  style: TournamentStyleSchema,
  rounds: z.number().int().positive(),
  status: TournamentStatusSchema,
  registrationOpen: z.boolean().default(false),
  registrationDeadline: z.string().datetime().nullable().optional(),
  maxParticipants: z.number().int().positive().nullable().optional(),
  registeredCount: z.number().int().nonnegative().default(0),
  venueName: z.string().nullable().optional(),
  venueAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  distanceKm: z.number().nullable().optional(),
  timeControl: z.string().nullable().optional(),
  entryFeeCents: z.number().int().nonnegative().default(0),
  currency: z.string().default('MYR'),
  descriptionMd: z.string().nullable().optional(),
  organizationName: z.string().nullable().optional(),
  categories: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
      }),
    )
    .default([]),
});
export type PublicEventSummary = z.infer<typeof PublicEventSummarySchema>;

/** Great-circle Haversine distance between two WGS84 coordinates in kilometers. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth mean radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return Math.round(R * c * 10) / 10;
}

// ---------------------------------------------------------------------------
// Floor Arbiter Zone Grid & Chief Arbiter Alerts (Phase 3)
// ---------------------------------------------------------------------------

export const FloorAlertSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  round: z.number().int().positive(),
  tableNumber: z.number().int().positive(),
  gameId: z.string().uuid().nullable(),
  arbiterName: z.string().nullable(),
  reason: z.string().min(1).max(300),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type FloorAlert = z.infer<typeof FloorAlertSchema>;

export const FloorZoneBoardSchema = z.object({
  tableNumber: z.number().int().positive(),
  slug: z.string(),
  gameId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: GameResultSchema.nullable(),
  isBye: z.boolean(),
  locked: z.boolean(),
});
export type FloorZoneBoard = z.infer<typeof FloorZoneBoardSchema>;


