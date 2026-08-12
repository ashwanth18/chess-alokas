import type { FidePlayerRow } from './types.js';

const LICHESS_FIDE_BASE = 'https://lichess.org/api/fide/player';
const USER_AGENT = 'ChessAlokas/1.0 (tournament-manager; fide-lookup)';
const DEFAULT_TIMEOUT_MS = 8_000;

export type LichessFidePlayer = {
  id: number;
  name: string;
  federation?: string | null;
  year?: number | null;
  title?: string | null;
  sex?: string | null;
  gender?: string | null;
  standard?: number | null;
  rapid?: number | null;
  blitz?: number | null;
  inactive?: boolean;
};

function ratingOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function mapLichessPlayer(p: LichessFidePlayer): FidePlayerRow {
  const sexRaw = p.sex ?? p.gender;
  return {
    fideId: Number(p.id),
    name: String(p.name ?? '').trim(),
    federation: p.federation ? String(p.federation).trim().toUpperCase() : null,
    birthYear: p.year != null && Number(p.year) > 1900 ? Number(p.year) : null,
    title: p.title ? String(p.title) : null,
    sex: sexRaw ? String(sexRaw) : null,
    standard: ratingOrNull(p.standard),
    rapid: ratingOrNull(p.rapid),
    blitz: ratingOrNull(p.blitz),
    inactive: Boolean(p.inactive),
  };
}

async function lichessFetch(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

/** Look up one FIDE player by ID via Lichess. */
export async function lichessGetById(fideId: number): Promise<FidePlayerRow | null> {
  const res = await lichessFetch(`${LICHESS_FIDE_BASE}/${fideId}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Lichess FIDE lookup failed (${res.status})`);
  }
  const body = (await res.json()) as LichessFidePlayer;
  if (body?.id == null) return null;
  return mapLichessPlayer(body);
}

/** Search FIDE players by query string via Lichess. */
export async function lichessSearch(query: string): Promise<FidePlayerRow[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${LICHESS_FIDE_BASE}?q=${encodeURIComponent(q)}`;
  const res = await lichessFetch(url);
  if (!res.ok) {
    throw new Error(`Lichess FIDE search failed (${res.status})`);
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body
    .filter((p): p is LichessFidePlayer => p != null && typeof p === 'object' && 'id' in p)
    .map(mapLichessPlayer)
    .filter((p) => p.fideId > 0 && p.name.length > 0);
}

/** Run async tasks with a concurrency limit. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
