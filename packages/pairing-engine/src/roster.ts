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

type Rankable = {
  id: string;
  name: string;
  rating?: number | null;
  seed?: number | null;
  categoryIds?: string[];
};

/**
 * Start ranks for display: prefer persisted seed, otherwise rated-first then A–Z.
 * When not mixed, ranks are 1…n within each category.
 */
export function computeStartRankMap(
  players: Rankable[],
  opts?: { mixCategories?: boolean },
): Map<string, number> {
  const map = new Map<string, number>();
  const mix = opts?.mixCategories !== false;

  const applyPool = (pool: Rankable[]) => {
    const assigned = assignStartRanks(pool);
    for (const p of pool) {
      const stored = p.seed != null && p.seed > 0 ? p.seed : null;
      map.set(p.id, stored ?? assigned.get(p.id) ?? 0);
    }
  };

  if (mix) {
    applyPool(players);
    return map;
  }

  const byCat = new Map<string, Rankable[]>();
  for (const p of players) {
    const cats = p.categoryIds?.length ? p.categoryIds : ['_none'];
    for (const c of cats) {
      const list = byCat.get(c) ?? [];
      list.push(p);
      byCat.set(c, list);
    }
  }
  for (const pool of byCat.values()) applyPool(pool);
  return map;
}
