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
  rating: z.number().int().nullable().optional(),
  club: z.string().nullable().optional(),
  email: z
    .union([z.string().email(), z.literal(''), z.null()])
    .optional(),
  customFields: z.record(z.unknown()).default({}),
  categoryIds: z.array(z.string().uuid()).default([]),
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
  /** Supabase Auth user id that owns this tournament (manager). */
  ownerId: z.string().uuid().nullable().optional(),
  /** Round the current arbiter PIN is valid for (server-side hash only). */
  arbiterPinRound: z.number().int().nonnegative().nullable().optional(),
  /** Number of physical floor tables allocated for QR stickers. */
  tableCount: z.number().int().nonnegative().default(0),
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
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Game = z.infer<typeof GameSchema>;

export const CreateTournamentInputSchema = z.object({
  name: z.string().min(1),
  date: z.string().nullable().optional(),
  style: TournamentStyleSchema.default('swiss'),
  rounds: z.number().int().positive().default(5),
  /** Default false: separate pairing + ranking per category. */
  mixCategories: z.boolean().default(false),
  prizePlaces: z.number().int().min(1).max(20).default(3),
  awardScope: AwardScopeSchema.default('per_category'),
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
