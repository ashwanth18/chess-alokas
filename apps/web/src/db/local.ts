import Dexie, { type Table } from 'dexie';
import type { FilterGroup } from '@chess-alokas/shared';

export interface LocalTournament {
  id: string;
  name: string;
  date?: string | null;
  style: string;
  rounds: number;
  status: string;
  currentRound: number;
  /** false = pair/rank within each category (default); true = one mixed pool */
  mixCategories?: boolean;
  /** Top N places highlighted as prize winners (default 3). */
  prizePlaces?: number;
  updatedAt: string;
  deletedAt?: string | null;
  clientId?: string;
  dirty: 1 | 0;
}

export interface LocalCategory {
  id: string;
  tournamentId: string;
  name: string;
  filter: FilterGroup;
  sortOrder: number;
  /** Override tournament prizePlaces; null = inherit. */
  prizePlaces?: number | null;
  updatedAt: string;
  deletedAt?: string | null;
  dirty: 1 | 0;
}

export interface LocalParticipant {
  id: string;
  tournamentId: string;
  name: string;
  age: number;
  gender?: string | null;
  rating?: number | null;
  club?: string | null;
  customFields: Record<string, unknown>;
  categoryIds: string[];
  seed?: number;
  updatedAt: string;
  deletedAt?: string | null;
  dirty: 1 | 0;
}

export interface LocalGame {
  id: string;
  tournamentId: string;
  categoryId: string;
  round: number;
  board: number;
  whiteId?: string | null;
  blackId?: string | null;
  result: string;
  isBye: boolean;
  updatedAt: string;
  deletedAt?: string | null;
  dirty: 1 | 0;
}

export interface LocalMeta {
  key: string;
  value: string;
}

export class ChessDb extends Dexie {
  tournaments!: Table<LocalTournament>;
  categories!: Table<LocalCategory>;
  participants!: Table<LocalParticipant>;
  games!: Table<LocalGame>;
  meta!: Table<LocalMeta>;

  constructor() {
    super('chess-alokas');
    this.version(1).stores({
      tournaments: 'id, updatedAt, dirty',
      categories: 'id, tournamentId, updatedAt, dirty',
      participants: 'id, tournamentId, updatedAt, dirty',
      games: 'id, tournamentId, categoryId, round, dirty',
      meta: 'key',
    });
    // v2: mixCategories on tournaments (optional field; no index change needed)
    this.version(2).stores({
      tournaments: 'id, updatedAt, dirty',
      categories: 'id, tournamentId, updatedAt, dirty',
      participants: 'id, tournamentId, updatedAt, dirty',
      games: 'id, tournamentId, categoryId, round, dirty',
      meta: 'key',
    });
    // v3: prizePlaces on tournaments / categories (optional fields; no index change)
    this.version(3).stores({
      tournaments: 'id, updatedAt, dirty',
      categories: 'id, tournamentId, updatedAt, dirty',
      participants: 'id, tournamentId, updatedAt, dirty',
      games: 'id, tournamentId, categoryId, round, dirty',
      meta: 'key',
    });
  }
}

export const db = new ChessDb();

export async function getOrCreateClientId(): Promise<string> {
  const existing = await db.meta.get('clientId');
  if (existing) return existing.value;
  const id = crypto.randomUUID();
  await db.meta.put({ key: 'clientId', value: id });
  return id;
}

export async function getLastSyncAt(): Promise<string | null> {
  const rec = await db.meta.get('lastSyncAt');
  return rec?.value ?? null;
}

export async function setLastSyncAt(ts: string): Promise<void> {
  await db.meta.put({ key: 'lastSyncAt', value: ts });
}

export function nowIso(): string {
  return new Date().toISOString();
}
