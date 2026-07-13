import postgres, { type Sql } from 'postgres';
import type {
  Tournament,
  Category,
  Participant,
  Game,
  SyncPushItem,
  FilterGroup,
  TournamentStyle,
  TournamentStatus,
  GameResult,
} from '@chess-alokas/shared';

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export interface SyncPullResult {
  tournaments: Tournament[];
  categories: Category[];
  participants: Participant[];
  games: Game[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface Store {
  // Tournaments
  listTournaments(ownerId?: string | null): Promise<Tournament[]>;
  getTournament(id: string): Promise<Tournament | null>;
  createTournament(t: Tournament): Promise<Tournament>;
  updateTournament(id: string, patch: Partial<Omit<Tournament, 'id'>>): Promise<Tournament | null>;
  isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean>;

  // Categories
  listCategories(tournamentId: string, includeDeleted?: boolean): Promise<Category[]>;
  getCategory(id: string): Promise<Category | null>;
  createCategory(c: Category): Promise<Category>;
  updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<Category | null>;

  // Participants
  listParticipants(tournamentId: string, includeDeleted?: boolean): Promise<Participant[]>;
  getParticipant(id: string): Promise<Participant | null>;
  createParticipant(p: Participant): Promise<Participant>;
  upsertParticipants(participants: Participant[]): Promise<Participant[]>;
  softDeleteParticipantsByTournament(tournamentId: string): Promise<void>;

  // Games
  listGames(tournamentId: string, filters?: { round?: number; categoryId?: string }): Promise<Game[]>;
  getGame(id: string): Promise<Game | null>;
  createGame(g: Game): Promise<Game>;
  updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null>;
  softDeleteGamesForRound(tournamentId: string, round: number, categoryId: string): Promise<void>;

  // Sync
  pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult>;
  pushSync(items: SyncPushItem[], ownerId?: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory store (offline / dev – active when DATABASE_URL is absent)
// ---------------------------------------------------------------------------

export class MemoryStore implements Store {
  private tournaments = new Map<string, Tournament>();
  private categories = new Map<string, Category>();
  private participants = new Map<string, Participant>();
  private games = new Map<string, Game>();

  // ---- Tournaments ----

  async listTournaments(ownerId?: string | null): Promise<Tournament[]> {
    return [...this.tournaments.values()].filter(
      (t) => !t.deletedAt && (!ownerId || t.ownerId === ownerId),
    );
  }

  async getTournament(id: string): Promise<Tournament | null> {
    return this.tournaments.get(id) ?? null;
  }

  async isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean> {
    const t = this.tournaments.get(tournamentId);
    return Boolean(t && !t.deletedAt && t.ownerId === ownerId);
  }

  async createTournament(t: Tournament): Promise<Tournament> {
    this.tournaments.set(t.id, t);
    return t;
  }

  async updateTournament(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
  ): Promise<Tournament | null> {
    const existing = this.tournaments.get(id);
    if (!existing) return null;
    const updated: Tournament = { ...existing, ...patch, id };
    this.tournaments.set(id, updated);
    return updated;
  }

  // ---- Categories ----

  async listCategories(tournamentId: string, includeDeleted = false): Promise<Category[]> {
    return [...this.categories.values()].filter(
      (c) => c.tournamentId === tournamentId && (includeDeleted || !c.deletedAt),
    );
  }

  async getCategory(id: string): Promise<Category | null> {
    return this.categories.get(id) ?? null;
  }

  async createCategory(c: Category): Promise<Category> {
    this.categories.set(c.id, c);
    return c;
  }

  async updateCategory(
    id: string,
    patch: Partial<Omit<Category, 'id'>>,
  ): Promise<Category | null> {
    const existing = this.categories.get(id);
    if (!existing) return null;
    const updated: Category = { ...existing, ...patch, id };
    this.categories.set(id, updated);
    return updated;
  }

  // ---- Participants ----

  async listParticipants(tournamentId: string, includeDeleted = false): Promise<Participant[]> {
    return [...this.participants.values()].filter(
      (p) => p.tournamentId === tournamentId && (includeDeleted || !p.deletedAt),
    );
  }

  async getParticipant(id: string): Promise<Participant | null> {
    return this.participants.get(id) ?? null;
  }

  async createParticipant(p: Participant): Promise<Participant> {
    this.participants.set(p.id, p);
    return p;
  }

  async upsertParticipants(participants: Participant[]): Promise<Participant[]> {
    for (const p of participants) {
      const existing = this.participants.get(p.id);
      if (!existing || p.updatedAt > existing.updatedAt) {
        this.participants.set(p.id, p);
      }
    }
    return participants;
  }

  async softDeleteParticipantsByTournament(tournamentId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, p] of this.participants.entries()) {
      if (p.tournamentId === tournamentId && !p.deletedAt) {
        this.participants.set(id, { ...p, deletedAt: now, updatedAt: now });
      }
    }
  }

  // ---- Games ----

  async listGames(
    tournamentId: string,
    filters?: { round?: number; categoryId?: string },
  ): Promise<Game[]> {
    return [...this.games.values()].filter((g) => {
      if (g.tournamentId !== tournamentId || g.deletedAt) return false;
      if (filters?.round !== undefined && g.round !== filters.round) return false;
      if (filters?.categoryId !== undefined && g.categoryId !== filters.categoryId) return false;
      return true;
    });
  }

  async getGame(id: string): Promise<Game | null> {
    return this.games.get(id) ?? null;
  }

  async createGame(g: Game): Promise<Game> {
    this.games.set(g.id, g);
    return g;
  }

  async updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null> {
    const existing = this.games.get(id);
    if (!existing) return null;
    const updated: Game = { ...existing, ...patch, id };
    this.games.set(id, updated);
    return updated;
  }

  async softDeleteGamesForRound(
    tournamentId: string,
    round: number,
    categoryId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, g] of this.games.entries()) {
      if (
        g.tournamentId === tournamentId &&
        g.round === round &&
        g.categoryId === categoryId &&
        !g.deletedAt
      ) {
        this.games.set(id, { ...g, deletedAt: now, updatedAt: now });
      }
    }
  }

  // ---- Sync ----

  async pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult> {
    const tournaments = [...this.tournaments.values()].filter(
      (t) => t.updatedAt > since && (!ownerId || t.ownerId === ownerId),
    );
    const ownedIds = ownerId
      ? new Set(
          [...this.tournaments.values()]
            .filter((t) => t.ownerId === ownerId)
            .map((t) => t.id),
        )
      : null;
    const tournamentUpdated = new Set(tournaments.map((t) => t.id));
    const childOk = (tournamentId: string, updatedAt: string) => {
      if (ownedIds && !ownedIds.has(tournamentId)) return false;
      return updatedAt > since || tournamentUpdated.has(tournamentId);
    };
    return {
      tournaments,
      categories: [...this.categories.values()].filter((c) => childOk(c.tournamentId, c.updatedAt)),
      participants: [...this.participants.values()].filter((p) =>
        childOk(p.tournamentId, p.updatedAt),
      ),
      games: [...this.games.values()].filter((g) => childOk(g.tournamentId, g.updatedAt)),
    };
  }

  async pushSync(items: SyncPushItem[], ownerId?: string | null): Promise<void> {
    for (const item of items) {
      if (item.entity === 'tournament' && ownerId) {
        item.payload = { ...item.payload, ownerId };
      }
      if (item.entity !== 'tournament' && ownerId) {
        const tid = String(item.payload['tournamentId'] ?? '');
        const owned = await this.isTournamentOwnedBy(tid, ownerId);
        const existing = this.tournaments.get(tid);
        if (!owned && existing) {
          throw Object.assign(new Error('Forbidden tournament'), { statusCode: 403 });
        }
      }
      this.applySyncItem(item);
    }
  }

  private applySyncItem(item: SyncPushItem): void {
    const { entity, id, payload, updatedAt, deletedAt } = item;

    function applyIfNewer<T extends { updatedAt: string }>(
      store: Map<string, T>,
      incoming: T,
    ): void {
      const existing = store.get(id);
      if (!existing || incoming.updatedAt > existing.updatedAt) {
        store.set(id, incoming);
      }
    }

    if (entity === 'tournament') {
      const t: Tournament = {
        id,
        name: String(payload['name'] ?? ''),
        date: (payload['date'] as string | null | undefined) ?? null,
        style: (payload['style'] as TournamentStyle) ?? 'swiss',
        rounds: Number(payload['rounds'] ?? 1),
        status: (payload['status'] as TournamentStatus) ?? 'draft',
        currentRound: Number(payload['currentRound'] ?? 0),
        mixCategories: Boolean(payload['mixCategories'] ?? false),
        prizePlaces: Number(payload['prizePlaces'] ?? 3),
        awardScope: (payload['awardScope'] as Tournament['awardScope']) ?? 'per_category',
        ownerId: (payload['ownerId'] as string | null | undefined) ?? null,
        clientId: (payload['clientId'] as string | undefined) ?? undefined,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      applyIfNewer(this.tournaments, t);
    } else if (entity === 'category') {
      const c: Category = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        name: String(payload['name'] ?? ''),
        filter: (payload['filter'] as FilterGroup) ?? { logic: 'and', rules: [] },
        sortOrder: Number(payload['sortOrder'] ?? 0),
        prizePlaces:
          payload['prizePlaces'] == null ? null : Number(payload['prizePlaces']),
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      applyIfNewer(this.categories, c);
    } else if (entity === 'participant') {
      const p: Participant = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        name: String(payload['name'] ?? ''),
        age: Number(payload['age'] ?? 0),
        gender: (payload['gender'] as string | null | undefined) ?? null,
        rating: payload['rating'] != null ? Number(payload['rating']) : null,
        club: (payload['club'] as string | null | undefined) ?? null,
        email: (payload['email'] as string | null | undefined) || null,
        customFields: (payload['customFields'] as Record<string, unknown>) ?? {},
        categoryIds: (payload['categoryIds'] as string[]) ?? [],
        seed: payload['seed'] != null ? Number(payload['seed']) : undefined,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      applyIfNewer(this.participants, p);
    } else if (entity === 'game') {
      const g: Game = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        categoryId: String(payload['categoryId'] ?? ''),
        round: Number(payload['round'] ?? 1),
        board: Number(payload['board'] ?? 1),
        whiteId: (payload['whiteId'] as string | null) ?? null,
        blackId: (payload['blackId'] as string | null) ?? null,
        result: (payload['result'] as GameResult) ?? 'pending',
        isBye: Boolean(payload['isBye'] ?? false),
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      applyIfNewer(this.games, g);
    }
  }
}

// ---------------------------------------------------------------------------
// Postgres row types (snake_case mirrors the DB schema)
// ---------------------------------------------------------------------------

interface TournamentRow {
  id: string;
  name: string;
  date: string | null;
  style: string;
  rounds: number;
  status: string;
  current_round: number;
  mix_categories: boolean | null;
  prize_places: number | null;
  award_scope: string | null;
  owner_id: string | null;
  client_id: string | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface CategoryRow {
  id: string;
  tournament_id: string;
  name: string;
  filter: FilterGroup;
  sort_order: number;
  prize_places: number | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface ParticipantRow {
  id: string;
  tournament_id: string;
  name: string;
  age: number;
  gender: string | null;
  rating: number | null;
  club: string | null;
  email: string | null;
  custom_fields: Record<string, unknown>;
  category_ids: string[];
  seed: number | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface GameRow {
  id: string;
  tournament_id: string;
  category_id: string;
  round: number;
  board: number;
  white_id: string | null;
  black_id: string | null;
  result: string;
  is_bye: boolean;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

// ---------------------------------------------------------------------------
// Helpers – row → domain type
// ---------------------------------------------------------------------------

function toIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date ?? undefined,
    style: row.style as TournamentStyle,
    rounds: row.rounds,
    status: row.status as TournamentStatus,
    currentRound: row.current_round,
    mixCategories: row.mix_categories ?? false,
    prizePlaces: row.prize_places ?? 3,
    awardScope: (row.award_scope as Tournament['awardScope']) ?? 'per_category',
    ownerId: row.owner_id ?? null,
    clientId: row.client_id ?? undefined,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    filter: row.filter,
    sortOrder: row.sort_order,
    prizePlaces: row.prize_places ?? null,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    age: row.age,
    gender: row.gender ?? undefined,
    rating: row.rating ?? undefined,
    club: row.club ?? undefined,
    email: row.email ?? undefined,
    customFields: row.custom_fields ?? {},
    categoryIds: row.category_ids ?? [],
    seed: row.seed ?? undefined,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToGame(row: GameRow): Game {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    categoryId: row.category_id,
    round: row.round,
    board: row.board,
    whiteId: row.white_id,
    blackId: row.black_id,
    result: row.result as GameResult,
    isBye: row.is_bye,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// PostgresStore
// ---------------------------------------------------------------------------

export class PostgresStore implements Store {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10 });
  }

  // postgres.js sql.json() expects its own JSONValue recursive type; our objects
  // are always valid JSON at runtime – cast at the boundary to avoid noise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private j(v: unknown): ReturnType<Sql['json']> { return this.sql.json(v as any); }

  // ---- Tournaments ----

  async listTournaments(ownerId?: string | null): Promise<Tournament[]> {
    const rows = ownerId
      ? await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE deleted_at IS NULL AND owner_id = ${ownerId}
          ORDER BY updated_at DESC
        `
      : await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments WHERE deleted_at IS NULL ORDER BY updated_at DESC
        `;
    return rows.map(rowToTournament);
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const rows = await this.sql<TournamentRow[]>`SELECT * FROM tournaments WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<{ ok: boolean }[]>`
      SELECT true AS ok FROM tournaments
      WHERE id = ${tournamentId} AND owner_id = ${ownerId} AND deleted_at IS NULL
      LIMIT 1
    `;
    return Boolean(rows[0]);
  }

  async createTournament(t: Tournament): Promise<Tournament> {
    const rows = await this.sql<TournamentRow[]>`
      INSERT INTO tournaments (id, name, date, style, rounds, status, current_round, mix_categories, prize_places, award_scope, owner_id, client_id, updated_at, deleted_at)
      VALUES (${t.id}, ${t.name}, ${t.date ?? null}, ${t.style}, ${t.rounds},
              ${t.status}, ${t.currentRound}, ${t.mixCategories ?? false}, ${t.prizePlaces ?? 3}, ${t.awardScope ?? 'per_category'},
              ${t.ownerId ?? null}, ${t.clientId ?? null},
              ${t.updatedAt}, ${t.deletedAt ?? null})
      RETURNING *
    `;
    return rowToTournament(rows[0]!);
  }

  async updateTournament(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
  ): Promise<Tournament | null> {
    const existing = await this.getTournament(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql<TournamentRow[]>`
      UPDATE tournaments SET
        name = ${m.name}, date = ${m.date ?? null}, style = ${m.style},
        rounds = ${m.rounds}, status = ${m.status}, current_round = ${m.currentRound},
        mix_categories = ${m.mixCategories ?? false},
        prize_places = ${m.prizePlaces ?? 3},
        award_scope = ${m.awardScope ?? 'per_category'},
        owner_id = ${m.ownerId ?? null},
        client_id = ${m.clientId ?? null}, updated_at = ${m.updatedAt},
        deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  // ---- Categories ----

  async listCategories(tournamentId: string, includeDeleted = false): Promise<Category[]> {
    const rows = includeDeleted
      ? await this.sql<CategoryRow[]>`
          SELECT * FROM categories WHERE tournament_id = ${tournamentId} ORDER BY sort_order`
      : await this.sql<CategoryRow[]>`
          SELECT * FROM categories WHERE tournament_id = ${tournamentId}
            AND deleted_at IS NULL ORDER BY sort_order`;
    return rows.map(rowToCategory);
  }

  async getCategory(id: string): Promise<Category | null> {
    const rows = await this.sql<CategoryRow[]>`SELECT * FROM categories WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToCategory(row) : null;
  }

  async createCategory(c: Category): Promise<Category> {
    const rows = await this.sql<CategoryRow[]>`
      INSERT INTO categories (id, tournament_id, name, filter, sort_order, prize_places, updated_at, deleted_at)
      VALUES (${c.id}, ${c.tournamentId}, ${c.name}, ${this.j(c.filter)},
              ${c.sortOrder}, ${c.prizePlaces ?? null}, ${c.updatedAt}, ${c.deletedAt ?? null})
      RETURNING *
    `;
    return rowToCategory(rows[0]!);
  }

  async updateCategory(
    id: string,
    patch: Partial<Omit<Category, 'id'>>,
  ): Promise<Category | null> {
    const existing = await this.getCategory(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql<CategoryRow[]>`
      UPDATE categories SET
        tournament_id = ${m.tournamentId}, name = ${m.name},
        filter = ${this.j(m.filter)}, sort_order = ${m.sortOrder},
        prize_places = ${m.prizePlaces ?? null},
        updated_at = ${m.updatedAt}, deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToCategory(row) : null;
  }

  // ---- Participants ----

  async listParticipants(tournamentId: string, includeDeleted = false): Promise<Participant[]> {
    const rows = includeDeleted
      ? await this.sql<ParticipantRow[]>`
          SELECT * FROM participants WHERE tournament_id = ${tournamentId}`
      : await this.sql<ParticipantRow[]>`
          SELECT * FROM participants WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL`;
    return rows.map(rowToParticipant);
  }

  async getParticipant(id: string): Promise<Participant | null> {
    const rows = await this.sql<ParticipantRow[]>`SELECT * FROM participants WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToParticipant(row) : null;
  }

  async createParticipant(p: Participant): Promise<Participant> {
    const rows = await this.sql<ParticipantRow[]>`
      INSERT INTO participants
        (id, tournament_id, name, age, gender, rating, club, email, custom_fields, category_ids, seed, updated_at, deleted_at)
      VALUES
        (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
         ${p.rating ?? null}, ${p.club ?? null}, ${p.email ?? null}, ${this.j(p.customFields)},
           ${p.categoryIds}, ${p.seed ?? null}, ${p.updatedAt}, ${p.deletedAt ?? null})
      RETURNING *
    `;
    return rowToParticipant(rows[0]!);
  }

  async upsertParticipants(participants: Participant[]): Promise<Participant[]> {
    if (participants.length === 0) return [];
    const results: Participant[] = [];
    for (const p of participants) {
      const rows = await this.sql<ParticipantRow[]>`
        INSERT INTO participants
          (id, tournament_id, name, age, gender, rating, club, email, custom_fields, category_ids, seed, updated_at, deleted_at)
        VALUES
          (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
           ${p.rating ?? null}, ${p.club ?? null}, ${p.email ?? null}, ${this.j(p.customFields)},
           ${p.categoryIds}, ${p.seed ?? null}, ${p.updatedAt}, ${p.deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender,
          rating = EXCLUDED.rating, club = EXCLUDED.club, email = EXCLUDED.email,
          custom_fields = EXCLUDED.custom_fields, category_ids = EXCLUDED.category_ids,
          seed = EXCLUDED.seed, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > participants.updated_at
        RETURNING *
      `;
      const row = rows[0];
      results.push(row ? rowToParticipant(row) : p);
    }
    return results;
  }

  async softDeleteParticipantsByTournament(tournamentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.sql`
      UPDATE participants SET deleted_at = ${now}, updated_at = ${now}
      WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
    `;
  }

  // ---- Games ----

  async listGames(
    tournamentId: string,
    filters?: { round?: number; categoryId?: string },
  ): Promise<Game[]> {
    let rows: GameRow[];
    if (filters?.round !== undefined && filters.categoryId !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
          AND round = ${filters.round} AND category_id = ${filters.categoryId}`;
    } else if (filters?.round !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL AND round = ${filters.round}`;
    } else if (filters?.categoryId !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL AND category_id = ${filters.categoryId}`;
    } else {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL`;
    }
    return rows.map(rowToGame);
  }

  async getGame(id: string): Promise<Game | null> {
    const rows = await this.sql<GameRow[]>`SELECT * FROM games WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToGame(row) : null;
  }

  async createGame(g: Game): Promise<Game> {
    const rows = await this.sql<GameRow[]>`
      INSERT INTO games
        (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye, updated_at, deleted_at)
      VALUES
        (${g.id}, ${g.tournamentId}, ${g.categoryId}, ${g.round}, ${g.board},
         ${g.whiteId}, ${g.blackId}, ${g.result}, ${g.isBye},
         ${g.updatedAt}, ${g.deletedAt ?? null})
      RETURNING *
    `;
    return rowToGame(rows[0]!);
  }

  async updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null> {
    const existing = await this.getGame(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql<GameRow[]>`
      UPDATE games SET
        tournament_id = ${m.tournamentId}, category_id = ${m.categoryId},
        round = ${m.round}, board = ${m.board},
        white_id = ${m.whiteId}, black_id = ${m.blackId},
        result = ${m.result}, is_bye = ${m.isBye},
        updated_at = ${m.updatedAt}, deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToGame(row) : null;
  }

  async softDeleteGamesForRound(
    tournamentId: string,
    round: number,
    categoryId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.sql`
      UPDATE games SET deleted_at = ${now}, updated_at = ${now}
      WHERE tournament_id = ${tournamentId} AND round = ${round}
        AND category_id = ${categoryId} AND deleted_at IS NULL
    `;
  }

  // ---- Sync ----

  async pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult> {
    if (ownerId) {
      // When a tournament row is pulled (e.g. after owner claim), also return all of
      // its children even if child updated_at is older than `since`.
      const [tournaments, categories, participants, games] = await Promise.all([
        this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE updated_at > ${since} AND owner_id = ${ownerId}
        `,
        this.sql<CategoryRow[]>`
          SELECT c.* FROM categories c
          INNER JOIN tournaments t ON t.id = c.tournament_id
          WHERE t.owner_id = ${ownerId}
            AND (c.updated_at > ${since} OR t.updated_at > ${since})
        `,
        this.sql<ParticipantRow[]>`
          SELECT p.* FROM participants p
          INNER JOIN tournaments t ON t.id = p.tournament_id
          WHERE t.owner_id = ${ownerId}
            AND (p.updated_at > ${since} OR t.updated_at > ${since})
        `,
        this.sql<GameRow[]>`
          SELECT g.* FROM games g
          INNER JOIN tournaments t ON t.id = g.tournament_id
          WHERE t.owner_id = ${ownerId}
            AND (g.updated_at > ${since} OR t.updated_at > ${since})
        `,
      ]);
      return {
        tournaments: tournaments.map(rowToTournament),
        categories: categories.map(rowToCategory),
        participants: participants.map(rowToParticipant),
        games: games.map(rowToGame),
      };
    }
    const [tournaments, categories, participants, games] = await Promise.all([
      this.sql<TournamentRow[]>`SELECT * FROM tournaments WHERE updated_at > ${since}`,
      this.sql<CategoryRow[]>`SELECT * FROM categories WHERE updated_at > ${since}`,
      this.sql<ParticipantRow[]>`SELECT * FROM participants WHERE updated_at > ${since}`,
      this.sql<GameRow[]>`SELECT * FROM games WHERE updated_at > ${since}`,
    ]);
    return {
      tournaments: tournaments.map(rowToTournament),
      categories: categories.map(rowToCategory),
      participants: participants.map(rowToParticipant),
      games: games.map(rowToGame),
    };
  }

  async pushSync(items: SyncPushItem[], ownerId?: string | null): Promise<void> {
    const order = { tournament: 0, category: 1, participant: 2, game: 3 } as const;
    const sorted = [...items].sort(
      (a, b) => (order[a.entity] ?? 9) - (order[b.entity] ?? 9),
    );
    for (const item of sorted) {
      if (ownerId && item.entity === 'tournament') {
        item.payload = { ...item.payload, ownerId };
      }
      if (ownerId && item.entity !== 'tournament') {
        const tid = String(item.payload['tournamentId'] ?? '');
        const owned = await this.isTournamentOwnedBy(tid, ownerId);
        const existing = await this.getTournament(tid);
        if (existing && !owned) {
          throw Object.assign(new Error('Forbidden tournament'), { statusCode: 403 });
        }
      }
      await this.applySyncItem(item);
    }
  }

  private async applySyncItem(item: SyncPushItem): Promise<void> {
    const { entity, id, payload: p, updatedAt, deletedAt } = item;

    if (entity === 'game') {
      const categoryId = String(p['categoryId'] ?? '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId)) {
        throw Object.assign(
          new Error(
            `Game ${id} has invalid categoryId "${categoryId}". Re-pair or repair local data before syncing.`,
          ),
          { statusCode: 400 },
        );
      }
    }

    if (entity === 'tournament') {
      await this.sql`
        INSERT INTO tournaments (id, name, date, style, rounds, status, current_round, mix_categories, prize_places, award_scope, owner_id, client_id, updated_at, deleted_at)
        VALUES (${id}, ${String(p['name'] ?? '')}, ${(p['date'] as string) ?? null},
                ${String(p['style'] ?? 'swiss')}, ${Number(p['rounds'] ?? 1)},
                ${String(p['status'] ?? 'draft')}, ${Number(p['currentRound'] ?? 0)},
                ${Boolean(p['mixCategories'] ?? false)},
                ${Number(p['prizePlaces'] ?? 3)},
                ${String(p['awardScope'] ?? 'per_category')},
                ${(p['ownerId'] as string) ?? null},
                ${(p['clientId'] as string) ?? null}, ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, date = EXCLUDED.date, style = EXCLUDED.style,
          rounds = EXCLUDED.rounds, status = EXCLUDED.status,
          current_round = EXCLUDED.current_round, mix_categories = EXCLUDED.mix_categories,
          prize_places = EXCLUDED.prize_places,
          award_scope = EXCLUDED.award_scope,
          owner_id = COALESCE(EXCLUDED.owner_id, tournaments.owner_id),
          client_id = EXCLUDED.client_id,
          updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > tournaments.updated_at
      `;
    } else if (entity === 'category') {
      const filter = (p['filter'] as FilterGroup) ?? { logic: 'and', rules: [] };
      await this.sql`
        INSERT INTO categories (id, tournament_id, name, filter, sort_order, prize_places, updated_at, deleted_at)
        VALUES (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['name'] ?? '')},
                ${this.j(filter)}, ${Number(p['sortOrder'] ?? 0)},
                ${p['prizePlaces'] == null ? null : Number(p['prizePlaces'])},
                ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          tournament_id = EXCLUDED.tournament_id, name = EXCLUDED.name,
          filter = EXCLUDED.filter, sort_order = EXCLUDED.sort_order,
          prize_places = EXCLUDED.prize_places,
          updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > categories.updated_at
      `;
    } else if (entity === 'participant') {
      const customFields = (p['customFields'] as Record<string, unknown>) ?? {};
      const categoryIds = (p['categoryIds'] as string[]) ?? [];
      await this.sql`
        INSERT INTO participants
          (id, tournament_id, name, age, gender, rating, club, email, custom_fields, category_ids, seed, updated_at, deleted_at)
        VALUES
          (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['name'] ?? '')},
           ${Number(p['age'] ?? 0)}, ${(p['gender'] as string) ?? null},
           ${p['rating'] != null ? Number(p['rating']) : null},
           ${(p['club'] as string) ?? null}, ${(p['email'] as string) ?? null}, ${this.j(customFields)},
           ${categoryIds}, ${p['seed'] != null ? Number(p['seed']) : null},
           ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          tournament_id = EXCLUDED.tournament_id, name = EXCLUDED.name, age = EXCLUDED.age,
          gender = EXCLUDED.gender, rating = EXCLUDED.rating, club = EXCLUDED.club,
          email = EXCLUDED.email,
          custom_fields = EXCLUDED.custom_fields, category_ids = EXCLUDED.category_ids,
          seed = EXCLUDED.seed, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > participants.updated_at
      `;
    } else if (entity === 'game') {
      await this.sql`
        INSERT INTO games
          (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye, updated_at, deleted_at)
        VALUES
          (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['categoryId'] ?? '')},
           ${Number(p['round'] ?? 1)}, ${Number(p['board'] ?? 1)},
           ${(p['whiteId'] as string) ?? null}, ${(p['blackId'] as string) ?? null},
           ${String(p['result'] ?? 'pending')}, ${Boolean(p['isBye'] ?? false)},
           ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          tournament_id = EXCLUDED.tournament_id, category_id = EXCLUDED.category_id,
          round = EXCLUDED.round, board = EXCLUDED.board,
          white_id = EXCLUDED.white_id, black_id = EXCLUDED.black_id,
          result = EXCLUDED.result, is_bye = EXCLUDED.is_bye,
          updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > games.updated_at
      `;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory – returns the right store based on environment
// ---------------------------------------------------------------------------

export function createStore(): Store {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    return new PostgresStore(dbUrl);
  }
  return new MemoryStore();
}
