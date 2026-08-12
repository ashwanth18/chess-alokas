import postgres, { type Sql } from 'postgres';
import type {
  Tournament,
  TournamentTable,
  Category,
  Participant,
  Game,
  GameCard,
  GameCardType,
  SyncPushItem,
  FilterGroup,
  TournamentStyle,
  TournamentStatus,
  GameResult,
} from '@chess-alokas/shared';
import { generateTableSlug } from './floor/pin.js';

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
  getTournamentByPublicToken(token: string): Promise<Tournament | null>;
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
  /**
   * Set a game result with attribution + audit event.
   * Director overrides bump resultOverrideCount when previous result was entered.
   */
  recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
    },
  ): Promise<Game | null>;
  softDeleteGamesForRound(tournamentId: string, round: number, categoryId: string): Promise<void>;

  // Floor arbiter tables
  getTableBySlug(slug: string): Promise<TournamentTable | null>;
  listTables(tournamentId: string): Promise<TournamentTable[]>;
  ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]>;
  setArbiterPin(tournamentId: string, pinHash: string, pinRound: number): Promise<Tournament | null>;
  getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }>;
  findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null>;

  // Discipline cards (yellow/red)
  listGameCards(gameId: string, includeDeleted?: boolean): Promise<GameCard[]>;
  listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]>;
  createGameCard(card: GameCard): Promise<GameCard>;
  softDeleteGameCard(id: string): Promise<GameCard | null>;

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
  private tables = new Map<string, TournamentTable>();
  private gameCards = new Map<string, GameCard>();
  private pinMeta = new Map<string, { hash: string; round: number }>();
  private resultEvents: Array<{
    id: string;
    gameId: string;
    tournamentId: string;
    result: Game['result'];
    previousResult: Game['result'];
    actorRole: 'floor' | 'director';
    actorName: string | null;
    actorUserId: string | null;
    note: string | null;
    createdAt: string;
  }> = [];

  // ---- Tournaments ----

  async listTournaments(ownerId?: string | null): Promise<Tournament[]> {
    return [...this.tournaments.values()].filter(
      (t) => !t.deletedAt && (!ownerId || t.ownerId === ownerId),
    );
  }

  async getTournament(id: string): Promise<Tournament | null> {
    return this.tournaments.get(id) ?? null;
  }

  async getTournamentByPublicToken(token: string): Promise<Tournament | null> {
    const t = [...this.tournaments.values()].find(
      (row) => row.publicToken === token && row.publicEnabled && !row.deletedAt,
    );
    return t ?? null;
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

  async recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
    },
  ): Promise<Game | null> {
    const existing = this.games.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const prev = existing.result;
    const wasEntered = prev !== 'pending' && prev !== 'bye';
    const overrideBump =
      input.actorRole === 'director' && wasEntered && prev !== input.result ? 1 : 0;
    const updated: Game = {
      ...existing,
      result: input.result,
      resultLockedAt: input.lock ? now : (existing.resultLockedAt ?? null),
      resultEnteredByName: input.actorName?.trim() || existing.resultEnteredByName || null,
      resultEnteredByRole: input.actorRole,
      resultOverrideCount: (existing.resultOverrideCount ?? 0) + overrideBump,
      updatedAt: now,
    };
    this.games.set(id, updated);
    this.resultEvents.push({
      id: crypto.randomUUID(),
      gameId: id,
      tournamentId: existing.tournamentId,
      result: input.result,
      previousResult: prev,
      actorRole: input.actorRole,
      actorName: input.actorName?.trim() || null,
      actorUserId: input.actorUserId ?? null,
      note: input.note?.trim() || null,
      createdAt: now,
    });
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

  async getTableBySlug(slug: string): Promise<TournamentTable | null> {
    return [...this.tables.values()].find((t) => t.slug === slug) ?? null;
  }

  async listTables(tournamentId: string): Promise<TournamentTable[]> {
    return [...this.tables.values()]
      .filter((t) => t.tournamentId === tournamentId)
      .sort((a, b) => a.tableNumber - b.tableNumber);
  }

  async ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]> {
    const existing = await this.listTables(tournamentId);
    const byNum = new Map(existing.map((t) => [t.tableNumber, t]));
    const now = new Date().toISOString();
    for (let n = 1; n <= count; n++) {
      if (byNum.has(n)) continue;
      const row: TournamentTable = {
        id: crypto.randomUUID(),
        tournamentId,
        tableNumber: n,
        slug: generateTableSlug(),
        createdAt: now,
      };
      this.tables.set(row.id, row);
      byNum.set(n, row);
    }
    const t = this.tournaments.get(tournamentId);
    if (t) {
      this.tournaments.set(tournamentId, {
        ...t,
        tableCount: Math.max(t.tableCount ?? 0, count),
        updatedAt: now,
      });
    }
    return this.listTables(tournamentId);
  }

  async setArbiterPin(
    tournamentId: string,
    pinHash: string,
    pinRound: number,
  ): Promise<Tournament | null> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return null;
    this.pinMeta.set(tournamentId, { hash: pinHash, round: pinRound });
    const updated: Tournament = {
      ...t,
      arbiterPinRound: pinRound,
      updatedAt: new Date().toISOString(),
    };
    this.tournaments.set(tournamentId, updated);
    return updated;
  }

  async getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }> {
    const meta = this.pinMeta.get(tournamentId);
    const t = this.tournaments.get(tournamentId);
    return {
      hash: meta?.hash ?? null,
      round: meta?.round ?? t?.arbiterPinRound ?? null,
    };
  }

  async findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null> {
    const matches = [...this.games.values()].filter(
      (g) =>
        !g.deletedAt &&
        g.tournamentId === tournamentId &&
        g.board === tableNumber &&
        g.round === round,
    );
    if (matches.length !== 1) return null;
    return matches[0]!;
  }

  async listGameCards(gameId: string, includeDeleted = false): Promise<GameCard[]> {
    return [...this.gameCards.values()]
      .filter((c) => c.gameId === gameId && (includeDeleted || !c.deletedAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]> {
    let cards = [...this.gameCards.values()].filter(
      (c) => c.tournamentId === tournamentId && !c.deletedAt,
    );
    if (filters?.gameId) {
      cards = cards.filter((c) => c.gameId === filters.gameId);
    }
    if (filters?.round != null) {
      const gameIds = new Set(
        [...this.games.values()]
          .filter(
            (g) =>
              g.tournamentId === tournamentId &&
              !g.deletedAt &&
              g.round === filters.round,
          )
          .map((g) => g.id),
      );
      cards = cards.filter((c) => gameIds.has(c.gameId));
    }
    return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createGameCard(card: GameCard): Promise<GameCard> {
    this.gameCards.set(card.id, card);
    return card;
  }

  async softDeleteGameCard(id: string): Promise<GameCard | null> {
    const existing = this.gameCards.get(id);
    if (!existing || existing.deletedAt) return null;
    const updated: GameCard = {
      ...existing,
      deletedAt: new Date().toISOString(),
    };
    this.gameCards.set(id, updated);
    return updated;
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
        const existing = this.tournaments.get(tid);
        // Soft-deleted rows are reclaimable by sync; only block a live tournament owned by someone else.
        if (
          existing &&
          !existing.deletedAt &&
          existing.ownerId &&
          existing.ownerId !== ownerId
        ) {
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
        confirmedRounds: Number(payload['confirmedRounds'] ?? 0),
        mixCategories: Boolean(payload['mixCategories'] ?? false),
        prizePlaces: Number(payload['prizePlaces'] ?? 3),
        awardScope: (payload['awardScope'] as Tournament['awardScope']) ?? 'per_category',
        tiebreakOrder: Array.isArray(payload['tiebreakOrder'])
          ? (payload['tiebreakOrder'] as Tournament['tiebreakOrder'])
          : null,
        sharedPlaces: payload['sharedPlaces'] == null ? true : Boolean(payload['sharedPlaces']),
        ownerId: (payload['ownerId'] as string | null | undefined) ?? null,
        arbiterPinRound:
          payload['arbiterPinRound'] == null ? null : Number(payload['arbiterPinRound']),
        tableCount: Number(payload['tableCount'] ?? 0),
        publicToken: null,
        publicEnabled: false,
        clientId: (payload['clientId'] as string | undefined) ?? undefined,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      // Preserve server-owned live fields when client sync omits them.
      const prev = this.tournaments.get(id);
      if (prev) {
        t.publicToken = prev.publicToken ?? null;
        t.publicEnabled = prev.publicEnabled ?? false;
      }
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
        school: (payload['school'] as string | null | undefined) ?? null,
        city: (payload['city'] as string | null | undefined) ?? null,
        state: (payload['state'] as string | null | undefined) ?? null,
        country: (payload['country'] as string | null | undefined) ?? null,
        yearOfBirth:
          payload['yearOfBirth'] != null ? Number(payload['yearOfBirth']) : null,
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
        resultLockedAt: (payload['resultLockedAt'] as string | null | undefined) ?? null,
        resultEnteredByName:
          (payload['resultEnteredByName'] as string | null | undefined) ?? null,
        resultEnteredByRole:
          (payload['resultEnteredByRole'] as Game['resultEnteredByRole']) ?? null,
        resultOverrideCount: Number(payload['resultOverrideCount'] ?? 0),
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
  confirmed_rounds: number | null;
  mix_categories: boolean | null;
  prize_places: number | null;
  award_scope: string | null;
  tiebreak_order: unknown | null;
  shared_places: boolean | null;
  owner_id: string | null;
  arbiter_pin_hash: string | null;
  arbiter_pin_round: number | null;
  table_count: number | null;
  public_token: string | null;
  public_enabled: boolean | null;
  client_id: string | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface TournamentTableRow {
  id: string;
  tournament_id: string;
  table_number: number;
  slug: string;
  created_at: Date | string;
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
  school: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  year_of_birth: number | null;
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
  result_locked_at: Date | string | null;
  result_entered_by_name: string | null;
  result_entered_by_role: string | null;
  result_override_count: number | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface GameCardRow {
  id: string;
  game_id: string;
  tournament_id: string;
  player_id: string;
  card_type: string;
  note: string | null;
  actor_role: string;
  actor_name: string | null;
  actor_user_id: string | null;
  created_at: Date | string;
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
    confirmedRounds: row.confirmed_rounds ?? 0,
    mixCategories: row.mix_categories ?? false,
    prizePlaces: row.prize_places ?? 3,
    awardScope: (row.award_scope as Tournament['awardScope']) ?? 'per_category',
    tiebreakOrder: Array.isArray(row.tiebreak_order)
      ? (row.tiebreak_order as Tournament['tiebreakOrder'])
      : null,
    sharedPlaces: row.shared_places ?? true,
    ownerId: row.owner_id ?? null,
    arbiterPinRound: row.arbiter_pin_round ?? null,
    tableCount: row.table_count ?? 0,
    publicToken: row.public_token ?? null,
    publicEnabled: row.public_enabled ?? false,
    clientId: row.client_id ?? undefined,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToTournamentTable(row: TournamentTableRow): TournamentTable {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    tableNumber: row.table_number,
    slug: row.slug,
    createdAt: toIso(row.created_at)!,
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
    school: row.school ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    country: row.country ?? undefined,
    yearOfBirth: row.year_of_birth ?? undefined,
    email: row.email ?? undefined,
    customFields: row.custom_fields ?? {},
    categoryIds: row.category_ids ?? [],
    seed: row.seed ?? undefined,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToGame(row: GameRow): Game {
  const role = row.result_entered_by_role;
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
    resultLockedAt: toIso(row.result_locked_at) ?? null,
    resultEnteredByName: row.result_entered_by_name ?? null,
    resultEnteredByRole:
      role === 'floor' || role === 'director' ? role : null,
    resultOverrideCount: row.result_override_count ?? 0,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToGameCard(row: GameCardRow): GameCard {
  const role = row.actor_role;
  return {
    id: row.id,
    gameId: row.game_id,
    tournamentId: row.tournament_id,
    playerId: row.player_id,
    cardType: row.card_type as GameCardType,
    note: row.note ?? null,
    actorRole: role === 'floor' || role === 'director' ? role : 'floor',
    actorName: row.actor_name ?? null,
    actorUserId: row.actor_user_id ?? null,
    createdAt: toIso(row.created_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// PostgresStore
// ---------------------------------------------------------------------------

export class PostgresStore implements Store {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    // prepare:false — required for Supabase transaction pooler (PgBouncer);
    // prepared statements otherwise fail with "prepared statement does not exist".
    this.sql = postgres(databaseUrl, { max: 10, prepare: false });
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

  async getTournamentByPublicToken(token: string): Promise<Tournament | null> {
    const rows = await this.sql<TournamentRow[]>`
      SELECT * FROM tournaments
      WHERE public_token = ${token}
        AND public_enabled = true
        AND deleted_at IS NULL
      LIMIT 1
    `;
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
      INSERT INTO tournaments (id, name, date, style, rounds, status, current_round, confirmed_rounds, mix_categories, prize_places, award_scope, tiebreak_order, shared_places, owner_id, public_token, public_enabled, client_id, updated_at, deleted_at)
      VALUES (${t.id}, ${t.name}, ${t.date ?? null}, ${t.style}, ${t.rounds},
              ${t.status}, ${t.currentRound}, ${t.confirmedRounds ?? 0}, ${t.mixCategories ?? false}, ${t.prizePlaces ?? 3}, ${t.awardScope ?? 'per_category'},
              ${t.tiebreakOrder ? this.j(t.tiebreakOrder) : null}, ${t.sharedPlaces ?? true},
              ${t.ownerId ?? null}, ${t.publicToken ?? null}, ${t.publicEnabled ?? false}, ${t.clientId ?? null},
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
        confirmed_rounds = ${m.confirmedRounds ?? 0},
        mix_categories = ${m.mixCategories ?? false},
        prize_places = ${m.prizePlaces ?? 3},
        award_scope = ${m.awardScope ?? 'per_category'},
        tiebreak_order = ${m.tiebreakOrder ? this.j(m.tiebreakOrder) : null},
        shared_places = ${m.sharedPlaces ?? true},
        owner_id = ${m.ownerId ?? null},
        public_token = ${m.publicToken ?? null},
        public_enabled = ${m.publicEnabled ?? false},
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
        (id, tournament_id, name, age, gender, rating, club, school, city, state, country,
         year_of_birth, email, custom_fields, category_ids, seed, updated_at, deleted_at)
      VALUES
        (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
         ${p.rating ?? null}, ${p.club ?? null}, ${p.school ?? null}, ${p.city ?? null},
         ${p.state ?? null}, ${p.country ?? null}, ${p.yearOfBirth ?? null},
         ${p.email ?? null}, ${this.j(p.customFields)},
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
          (id, tournament_id, name, age, gender, rating, club, school, city, state, country,
           year_of_birth, email, custom_fields, category_ids, seed, updated_at, deleted_at)
        VALUES
          (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
           ${p.rating ?? null}, ${p.club ?? null}, ${p.school ?? null}, ${p.city ?? null},
           ${p.state ?? null}, ${p.country ?? null}, ${p.yearOfBirth ?? null},
           ${p.email ?? null}, ${this.j(p.customFields)},
           ${p.categoryIds}, ${p.seed ?? null}, ${p.updatedAt}, ${p.deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender,
          rating = EXCLUDED.rating, club = EXCLUDED.club, school = EXCLUDED.school,
          city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
          year_of_birth = EXCLUDED.year_of_birth, email = EXCLUDED.email,
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
        (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye,
         result_locked_at, result_entered_by_name, result_entered_by_role, result_override_count,
         updated_at, deleted_at)
      VALUES
        (${g.id}, ${g.tournamentId}, ${g.categoryId}, ${g.round}, ${g.board},
         ${g.whiteId}, ${g.blackId}, ${g.result}, ${g.isBye}, ${g.resultLockedAt ?? null},
         ${g.resultEnteredByName ?? null}, ${g.resultEnteredByRole ?? null},
         ${g.resultOverrideCount ?? 0},
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
        result_locked_at = ${m.resultLockedAt ?? null},
        result_entered_by_name = ${m.resultEnteredByName ?? null},
        result_entered_by_role = ${m.resultEnteredByRole ?? null},
        result_override_count = ${m.resultOverrideCount ?? 0},
        updated_at = ${m.updatedAt}, deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToGame(row) : null;
  }

  async recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
    },
  ): Promise<Game | null> {
    const existing = await this.getGame(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const prev = existing.result;
    const wasEntered = prev !== 'pending' && prev !== 'bye';
    const overrideBump =
      input.actorRole === 'director' && wasEntered && prev !== input.result ? 1 : 0;
    const actorName = input.actorName?.trim() || existing.resultEnteredByName || null;
    const nextOverride = (existing.resultOverrideCount ?? 0) + overrideBump;
    const lockAt = input.lock ? now : (existing.resultLockedAt ?? null);

    const rows = await this.sql<GameRow[]>`
      UPDATE games SET
        result = ${input.result},
        result_locked_at = ${lockAt},
        result_entered_by_name = ${actorName},
        result_entered_by_role = ${input.actorRole},
        result_override_count = ${nextOverride},
        updated_at = ${now}
      WHERE id = ${id}
      RETURNING *
    `;
    const row = rows[0];
    if (!row) return null;

    await this.sql`
      INSERT INTO game_result_events
        (id, game_id, tournament_id, result, previous_result, actor_role, actor_name, actor_user_id, note, created_at)
      VALUES
        (${crypto.randomUUID()}, ${id}, ${existing.tournamentId}, ${input.result}, ${prev},
         ${input.actorRole}, ${input.actorName?.trim() || null}, ${input.actorUserId ?? null},
         ${input.note?.trim() || null}, ${now})
    `;
    return rowToGame(row);
  }

  async getTableBySlug(slug: string): Promise<TournamentTable | null> {
    const rows = await this.sql<TournamentTableRow[]>`
      SELECT * FROM tournament_tables WHERE slug = ${slug} LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToTournamentTable(row) : null;
  }

  async listTables(tournamentId: string): Promise<TournamentTable[]> {
    const rows = await this.sql<TournamentTableRow[]>`
      SELECT * FROM tournament_tables
      WHERE tournament_id = ${tournamentId}
      ORDER BY table_number ASC
    `;
    return rows.map(rowToTournamentTable);
  }

  async ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]> {
    for (let n = 1; n <= count; n++) {
      const slug = generateTableSlug();
      await this.sql`
        INSERT INTO tournament_tables (id, tournament_id, table_number, slug)
        VALUES (${crypto.randomUUID()}, ${tournamentId}, ${n}, ${slug})
        ON CONFLICT (tournament_id, table_number) DO NOTHING
      `;
    }
    const now = new Date().toISOString();
    await this.sql`
      UPDATE tournaments
      SET table_count = GREATEST(table_count, ${count}), updated_at = ${now}
      WHERE id = ${tournamentId}
    `;
    return this.listTables(tournamentId);
  }

  async setArbiterPin(
    tournamentId: string,
    pinHash: string,
    pinRound: number,
  ): Promise<Tournament | null> {
    const now = new Date().toISOString();
    const rows = await this.sql<TournamentRow[]>`
      UPDATE tournaments
      SET arbiter_pin_hash = ${pinHash},
          arbiter_pin_round = ${pinRound},
          updated_at = ${now}
      WHERE id = ${tournamentId}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }> {
    const rows = await this.sql<{ arbiter_pin_hash: string | null; arbiter_pin_round: number | null }[]>`
      SELECT arbiter_pin_hash, arbiter_pin_round FROM tournaments WHERE id = ${tournamentId}
    `;
    const row = rows[0];
    return {
      hash: row?.arbiter_pin_hash ?? null,
      round: row?.arbiter_pin_round ?? null,
    };
  }

  async findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null> {
    const rows = await this.sql<GameRow[]>`
      SELECT * FROM games
      WHERE tournament_id = ${tournamentId}
        AND board = ${tableNumber}
        AND round = ${round}
        AND deleted_at IS NULL
    `;
    if (rows.length !== 1) return null;
    return rowToGame(rows[0]!);
  }

  async listGameCards(gameId: string, includeDeleted = false): Promise<GameCard[]> {
    const rows = includeDeleted
      ? await this.sql<GameCardRow[]>`
          SELECT * FROM game_cards WHERE game_id = ${gameId} ORDER BY created_at ASC`
      : await this.sql<GameCardRow[]>`
          SELECT * FROM game_cards
          WHERE game_id = ${gameId} AND deleted_at IS NULL
          ORDER BY created_at ASC`;
    return rows.map(rowToGameCard);
  }

  async listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]> {
    if (filters?.gameId) {
      return this.listGameCards(filters.gameId);
    }
    if (filters?.round != null) {
      const rows = await this.sql<GameCardRow[]>`
        SELECT c.* FROM game_cards c
        INNER JOIN games g ON g.id = c.game_id
        WHERE c.tournament_id = ${tournamentId}
          AND c.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND g.round = ${filters.round}
        ORDER BY c.created_at ASC
      `;
      return rows.map(rowToGameCard);
    }
    const rows = await this.sql<GameCardRow[]>`
      SELECT * FROM game_cards
      WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
      ORDER BY created_at ASC
    `;
    return rows.map(rowToGameCard);
  }

  async createGameCard(card: GameCard): Promise<GameCard> {
    const rows = await this.sql<GameCardRow[]>`
      INSERT INTO game_cards
        (id, game_id, tournament_id, player_id, card_type, note, actor_role, actor_name, actor_user_id, created_at, deleted_at)
      VALUES
        (${card.id}, ${card.gameId}, ${card.tournamentId}, ${card.playerId}, ${card.cardType},
         ${card.note ?? null}, ${card.actorRole}, ${card.actorName ?? null}, ${card.actorUserId ?? null},
         ${card.createdAt}, ${card.deletedAt ?? null})
      RETURNING *
    `;
    return rowToGameCard(rows[0]!);
  }

  async softDeleteGameCard(id: string): Promise<GameCard | null> {
    const now = new Date().toISOString();
    const rows = await this.sql<GameCardRow[]>`
      UPDATE game_cards SET deleted_at = ${now}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToGameCard(row) : null;
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
        const existing = await this.getTournament(tid);
        // Soft-deleted rows are reclaimable by a later tournament sync; only block a
        // live tournament owned by a different user.
        if (
          existing &&
          !existing.deletedAt &&
          existing.ownerId &&
          existing.ownerId !== ownerId
        ) {
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
        INSERT INTO tournaments (id, name, date, style, rounds, status, current_round, confirmed_rounds, mix_categories, prize_places, award_scope, tiebreak_order, shared_places, owner_id, client_id, updated_at, deleted_at)
        VALUES (${id}, ${String(p['name'] ?? '')}, ${(p['date'] as string) ?? null},
                ${String(p['style'] ?? 'swiss')}, ${Number(p['rounds'] ?? 1)},
                ${String(p['status'] ?? 'draft')}, ${Number(p['currentRound'] ?? 0)},
                ${Number(p['confirmedRounds'] ?? 0)},
                ${Boolean(p['mixCategories'] ?? false)},
                ${Number(p['prizePlaces'] ?? 3)},
                ${String(p['awardScope'] ?? 'per_category')},
                ${p['tiebreakOrder'] ? this.j(p['tiebreakOrder']) : null},
                ${p['sharedPlaces'] == null ? true : Boolean(p['sharedPlaces'])},
                ${(p['ownerId'] as string) ?? null},
                ${(p['clientId'] as string) ?? null}, ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, date = EXCLUDED.date, style = EXCLUDED.style,
          rounds = EXCLUDED.rounds, status = EXCLUDED.status,
          current_round = EXCLUDED.current_round,
          confirmed_rounds = EXCLUDED.confirmed_rounds,
          mix_categories = EXCLUDED.mix_categories,
          prize_places = EXCLUDED.prize_places,
          award_scope = EXCLUDED.award_scope,
          tiebreak_order = EXCLUDED.tiebreak_order,
          shared_places = EXCLUDED.shared_places,
          owner_id = COALESCE(EXCLUDED.owner_id, tournaments.owner_id),
          client_id = EXCLUDED.client_id,
          updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > tournaments.updated_at
      `;
      // public_token / public_enabled are server-owned (enable/rotate/disable API only).
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
          (id, tournament_id, name, age, gender, rating, club, school, city, state, country,
           year_of_birth, email, custom_fields, category_ids, seed, updated_at, deleted_at)
        VALUES
          (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['name'] ?? '')},
           ${Number(p['age'] ?? 0)}, ${(p['gender'] as string) ?? null},
           ${p['rating'] != null ? Number(p['rating']) : null},
           ${(p['club'] as string) ?? null}, ${(p['school'] as string) ?? null},
           ${(p['city'] as string) ?? null}, ${(p['state'] as string) ?? null},
           ${(p['country'] as string) ?? null},
           ${p['yearOfBirth'] != null ? Number(p['yearOfBirth']) : null},
           ${(p['email'] as string) ?? null}, ${this.j(customFields)},
           ${categoryIds}, ${p['seed'] != null ? Number(p['seed']) : null},
           ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          tournament_id = EXCLUDED.tournament_id, name = EXCLUDED.name, age = EXCLUDED.age,
          gender = EXCLUDED.gender, rating = EXCLUDED.rating, club = EXCLUDED.club,
          school = EXCLUDED.school, city = EXCLUDED.city, state = EXCLUDED.state,
          country = EXCLUDED.country, year_of_birth = EXCLUDED.year_of_birth,
          email = EXCLUDED.email,
          custom_fields = EXCLUDED.custom_fields, category_ids = EXCLUDED.category_ids,
          seed = EXCLUDED.seed, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > participants.updated_at
      `;
    } else if (entity === 'game') {
      const enteredRole = p['resultEnteredByRole'];
      const role =
        enteredRole === 'floor' || enteredRole === 'director' ? enteredRole : null;
      await this.sql`
        INSERT INTO games
          (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye,
           result_locked_at, result_entered_by_name, result_entered_by_role, result_override_count,
           updated_at, deleted_at)
        VALUES
          (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['categoryId'] ?? '')},
           ${Number(p['round'] ?? 1)}, ${Number(p['board'] ?? 1)},
           ${(p['whiteId'] as string) ?? null}, ${(p['blackId'] as string) ?? null},
           ${String(p['result'] ?? 'pending')}, ${Boolean(p['isBye'] ?? false)},
           ${(p['resultLockedAt'] as string) ?? null},
           ${(p['resultEnteredByName'] as string) ?? null}, ${role},
           ${Number(p['resultOverrideCount'] ?? 0)},
           ${updatedAt}, ${deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          tournament_id = EXCLUDED.tournament_id, category_id = EXCLUDED.category_id,
          round = EXCLUDED.round, board = EXCLUDED.board,
          white_id = EXCLUDED.white_id, black_id = EXCLUDED.black_id,
          result = EXCLUDED.result, is_bye = EXCLUDED.is_bye,
          result_locked_at = COALESCE(EXCLUDED.result_locked_at, games.result_locked_at),
          result_entered_by_name = COALESCE(EXCLUDED.result_entered_by_name, games.result_entered_by_name),
          result_entered_by_role = COALESCE(EXCLUDED.result_entered_by_role, games.result_entered_by_role),
          result_override_count = GREATEST(EXCLUDED.result_override_count, games.result_override_count),
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
