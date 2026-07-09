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
]);
export type GameResult = z.infer<typeof GameResultSchema>;

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
  customFields: z.record(z.unknown()).default({}),
  categoryIds: z.array(z.string().uuid()).default([]),
  seed: z.number().int().optional(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const TournamentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  date: z.string().nullable().optional(),
  style: TournamentStyleSchema,
  rounds: z.number().int().positive(),
  status: TournamentStatusSchema,
  currentRound: z.number().int().nonnegative().default(0),
  /**
   * When false (default), players only pair within their category and
   * standings are per category. When true, everyone shares one pool.
   */
  mixCategories: z.boolean().default(false),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  clientId: z.string().optional(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

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
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        filter: FilterGroupSchema,
        sortOrder: z.number().int().optional(),
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
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

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
