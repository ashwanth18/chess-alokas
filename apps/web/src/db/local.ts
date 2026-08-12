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
  /** Highest round explicitly confirmed finished by the director (default 0). */
  confirmedRounds?: number;
  /** false = pair/rank within each category (default); true = one mixed pool */
  mixCategories?: boolean;
  /** Top N places highlighted as prize winners (default 3). */
  prizePlaces?: number;
  /** overall | per_category — winners certificate scope */
  awardScope?: 'overall' | 'per_category';
  /** Tiebreak keys after score; null = app default */
  tiebreakOrder?: string[] | null;
  /** Shared 1224 ranks when performance TBs match (default true) */
  sharedPlaces?: boolean;
  /** Supabase Auth user id (manager) */
  ownerId?: string | null;
  /** Round the current arbiter PIN applies to (mirrors server). */
  arbiterPinRound?: number | null;
  /** Plaintext PIN for the current round — local display only; never sync. */
  arbiterPin?: string | null;
  tableCount?: number;
  /** Public live page token (from cloud; set via enable API). */
  publicToken?: string | null;
  publicEnabled?: boolean;
  updatedAt: string;
  deletedAt?: string | null;
  clientId?: string;
  dirty: 1 | 0;
}

export interface LocalTournamentTable {
  id: string;
  tournamentId: string;
  tableNumber: number;
  slug: string;
  createdAt: string;
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
  school?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  yearOfBirth?: number | null;
  email?: string | null;
  customFields: Record<string, unknown>;
  categoryIds: string[];
  /** Start rank / pairing number */
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
  resultLockedAt?: string | null;
  resultEnteredByName?: string | null;
  resultEnteredByRole?: 'floor' | 'director' | null;
  resultOverrideCount?: number;
  updatedAt: string;
  deletedAt?: string | null;
  dirty: 1 | 0;
}

export interface LocalCertificateTemplate {
  id: string;
  tournamentId?: string | null;
  name: string;
  certType: 'participation' | 'winner';
  /** Base64 PDF bytes */
  pdfBase64: string;
  layoutJson: string;
  updatedAt: string;
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
  certificateTemplates!: Table<LocalCertificateTemplate>;
  tournamentTables!: Table<LocalTournamentTable>;
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
    // v5: ownerId on tournaments for multi-tenant sync
    this.version(5).stores({
      tournaments: 'id, ownerId, updatedAt, dirty',
      categories: 'id, tournamentId, updatedAt, dirty',
      participants: 'id, tournamentId, updatedAt, dirty',
      games: 'id, tournamentId, categoryId, round, dirty',
      certificateTemplates: 'id, tournamentId, updatedAt, dirty',
      meta: 'key',
    });
    // v6: floor arbiter tables + result lock field on games
    this.version(6).stores({
      tournaments: 'id, ownerId, updatedAt, dirty',
      categories: 'id, tournamentId, updatedAt, dirty',
      participants: 'id, tournamentId, updatedAt, dirty',
      games: 'id, tournamentId, categoryId, round, dirty',
      certificateTemplates: 'id, tournamentId, updatedAt, dirty',
      tournamentTables: 'id, tournamentId, tableNumber, slug, dirty',
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
