import type { EnginePlayer } from './swiss.js';

/** Rated (>0) first by rating desc + name; then unrated A–Z. */
export function compareRosterOrder(
  a: { id: string; name: string; rating?: number | null },
  b: { id: string; name: string; rating?: number | null },
): number {
  const ra = a.rating != null && a.rating > 0 ? a.rating : 0;
  const rb = b.rating != null && b.rating > 0 ? b.rating : 0;
  const aRated = ra > 0;
  const bRated = rb > 0;
  if (aRated !== bRated) return aRated ? -1 : 1;
  if (aRated && rb !== ra) return rb - ra;
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export function sortRoster<T extends { id: string; name: string; rating?: number | null }>(
  players: T[],
): T[] {
  return [...players].sort(compareRosterOrder);
}

/**
 * Assign start ranks (seeds) 1…n from rated-first then unrated alphabetical order.
 * Does not mutate input; returns id → seed map.
 */
export function assignStartRanks(
  players: Array<{ id: string; name: string; rating?: number | null }>,
): Map<string, number> {
  const sorted = sortRoster(players);
  const map = new Map<string, number>();
  sorted.forEach((p, i) => map.set(p.id, i + 1));
  return map;
}

/** Apply start ranks onto engine players (for pairing). */
export function withStartRanks(players: EnginePlayer[]): EnginePlayer[] {
  const ranks = assignStartRanks(players);
  return players.map((p) => ({
    ...p,
    seed: ranks.get(p.id) ?? p.seed,
  }));
}
