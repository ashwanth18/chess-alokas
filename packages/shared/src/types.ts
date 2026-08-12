import { z } from 'zod';

export const TournamentStyleSchema = z.enum(['swiss', 'round_robin']);
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
  /** Black absent/forfeit — White wins */
  '1-0F',
  /** White absent/forfeit — Black wins */
  '0-1F',
  /** Both absent */
  '0-0',
]);
export type GameResult = z.infer<typeof GameResultSchema>;

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
  /** Round the current arbiter PIN is valid for (server-side hash only). */
  arbiterPinRound: z.number().int().nonnegative().nullable().optional(),
  /** Number of physical floor tables allocated for QR stickers. */
  tableCount: z.number().int().nonnegative().default(0),
  /** Unguessable token for the public live page (null until enabled once). */
  publicToken: z.string().min(8).nullable().optional(),
  /** When true, GET /public/live/:token serves sanitized pairings/standings. */
  publicEnabled: z.boolean().default(false),
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
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SUPPORTED_STYLES: TournamentStyle[] = ['swiss'];
export const COMING_SOON_STYLES: TournamentStyle[] = ['round_robin'];

export function isStyleImplemented(style: TournamentStyle): boolean {
  return SUPPORTED_STYLES.includes(style);
}
