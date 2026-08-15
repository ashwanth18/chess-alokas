import type { GameResult } from '@chess-alokas/shared';
import { compareRosterOrder } from './roster.js';

export type PlayerId = string;

export interface EnginePlayer {
  id: PlayerId;
  name: string;
  rating?: number | null;
  seed?: number;
}

export interface PastGame {
  round: number;
  whiteId: PlayerId | null;
  blackId: PlayerId | null;
  result: GameResult;
  isBye: boolean;
}

export interface PairingBoard {
  board: number;
  whiteId: PlayerId | null;
  blackId: PlayerId | null;
  isBye: boolean;
}

export interface PairingInput {
  players: EnginePlayer[];
  pastGames: PastGame[];
  round: number;
  /** Known tournament length; required for Dutch topscorer (A.7 / 1.8). */
  totalRounds?: number;
  /** Colour drawn for odd pairing numbers in round 1 (Dutch E.5). Default White. */
  initialColor?: 'W' | 'B';
}

export interface PairingOutput {
  boards: PairingBoard[];
  byePlayerId: PlayerId | null;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  rating: number;
  seed: number;
  score: number;
  opponents: PlayerId[];
  colors: Array<'W' | 'B'>;
  hadBye: boolean;
  floatHistory: Array<'up' | 'down' | null>;
}

export function buildPlayerStates(
  players: EnginePlayer[],
  pastGames: PastGame[],
): PlayerState[] {
  const states = new Map<PlayerId, PlayerState>();

  const sorted = [...players].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (a.seed != null && b.seed != null && sa !== sb) return sa - sb;
    return compareRosterOrder(
      { id: a.id, name: a.name, rating: a.rating },
      { id: b.id, name: b.name, rating: b.rating },
    );
  });

  sorted.forEach((p, index) => {
    states.set(p.id, {
      id: p.id,
      name: p.name,
      rating: p.rating ?? 0,
      seed: p.seed ?? index + 1,
      score: 0,
      opponents: [],
      colors: [],
      hadBye: false,
      floatHistory: [],
    });
  });

  const rounds = [...new Set(pastGames.map((g) => g.round))].sort((a, b) => a - b);

  for (const round of rounds) {
    const games = pastGames.filter((g) => g.round === round);
    for (const game of games) {
      if (game.isBye) {
        const byeId = game.whiteId ?? game.blackId;
        if (!byeId) continue;
        const st = states.get(byeId);
        if (!st) continue;
        st.score += 1;
        st.hadBye = true;
        st.floatHistory.push(null);
        continue;
      }

      const white = game.whiteId ? states.get(game.whiteId) : undefined;
      const black = game.blackId ? states.get(game.blackId) : undefined;
      if (!white || !black) continue;

      white.opponents.push(black.id);
      black.opponents.push(white.id);
      white.colors.push('W');
      black.colors.push('B');
      white.floatHistory.push(null);
      black.floatHistory.push(null);

      if (game.result === '1-0' || game.result === '1-0F') {
        white.score += 1;
      } else if (game.result === '0-1' || game.result === '0-1F') {
        black.score += 1;
      } else if (game.result === '1/2-1/2') {
        white.score += 0.5;
        black.score += 0.5;
      }
      // '0-0' both absent — no points; still counts as played for opponents/colors above.
    }
  }

  return [...states.values()];
}

export function colorPreference(state: PlayerState): 'W' | 'B' | null {
  const whites = state.colors.filter((c) => c === 'W').length;
  const blacks = state.colors.filter((c) => c === 'B').length;
  if (whites < blacks) return 'W';
  if (blacks < whites) return 'B';
  if (state.colors.length === 0) return null;
  const last = state.colors[state.colors.length - 1];
  return last === 'W' ? 'B' : 'W';
}

export function colorImbalance(state: PlayerState): number {
  const whites = state.colors.filter((c) => c === 'W').length;
  const blacks = state.colors.filter((c) => c === 'B').length;
  return whites - blacks;
}

function havePlayed(a: PlayerState, b: PlayerState): boolean {
  return a.opponents.includes(b.id);
}

function sortWithinGroup(players: PlayerState[]): PlayerState[] {
  return [...players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (a.seed !== b.seed) return a.seed - b.seed;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Backtracking perfect matching that prefers non-rematches.
 * Tries allowRematch=false first, then true as last resort.
 */
function findPerfectMatching(
  players: PlayerState[],
  allowRematch: boolean,
): Array<[PlayerState, PlayerState]> | null {
  if (players.length === 0) return [];
  if (players.length % 2 !== 0) return null;

  const sorted = sortWithinGroup(players);
  const byId = new Map(sorted.map((p) => [p.id, p]));
  const ids = sorted.map((p) => p.id);
  const paired = new Set<string>();
  const pairs: Array<[string, string]> = [];

  function candidatesFor(id: string): string[] {
    const a = byId.get(id)!;
    const rest = ids.filter((oid) => oid !== id && !paired.has(oid));
    const fresh = rest.filter((oid) => !havePlayed(a, byId.get(oid)!));
    const pool = allowRematch
      ? [...fresh, ...rest.filter((oid) => havePlayed(a, byId.get(oid)!))]
      : fresh;

    // Prefer similar rating / seed order (Dutch-like: mid-field partners first)
    return pool.sort((x, y) => {
      const px = byId.get(x)!;
      const py = byId.get(y)!;
      const rematchPenaltyX = havePlayed(a, px) ? 1 : 0;
      const rematchPenaltyY = havePlayed(a, py) ? 1 : 0;
      if (rematchPenaltyX !== rematchPenaltyY) return rematchPenaltyX - rematchPenaltyY;
      return Math.abs(px.rating - a.rating) - Math.abs(py.rating - a.rating) ||
        px.seed - py.seed;
    });
  }

  function search(): boolean {
    const unpaired = ids.filter((id) => !paired.has(id));
    if (unpaired.length === 0) return true;

    // Pick the unpaired player with fewest candidates (MRV heuristic)
    let best: string | null = null;
    let bestOpts: string[] = [];
    for (const id of unpaired) {
      const opts = candidatesFor(id);
      if (!best || opts.length < bestOpts.length) {
        best = id;
        bestOpts = opts;
      }
    }
    if (!best || bestOpts.length === 0) return false;

    for (const partner of bestOpts) {
      paired.add(best);
      paired.add(partner);
      pairs.push([best, partner]);
      if (search()) return true;
      pairs.pop();
      paired.delete(best);
      paired.delete(partner);
    }
    return false;
  }

  if (!search()) return null;
  return pairs.map(([a, b]) => [byId.get(a)!, byId.get(b)!]);
}

function pairGroup(
  group: PlayerState[],
): { pairs: Array<[PlayerState, PlayerState]>; leftover: PlayerState | null } {
  const sorted = sortWithinGroup(group);
  if (sorted.length === 0) return { pairs: [], leftover: null };

  let leftover: PlayerState | null = null;
  let working = sorted;

  if (working.length % 2 === 1) {
    // Downfloat lowest-ranked in group
    leftover = working[working.length - 1] ?? null;
    working = working.slice(0, -1);
  }

  const pairs =
    findPerfectMatching(working, false) ?? findPerfectMatching(working, true) ?? [];

  // If matching failed partially (shouldn't), greedy fill
  if (pairs.length * 2 !== working.length) {
    const used = new Set(pairs.flatMap(([a, b]) => [a.id, b.id]));
    const rem = working.filter((p) => !used.has(p.id));
    for (let i = 0; i + 1 < rem.length; i += 2) {
      const a = rem[i], b = rem[i + 1];
      if (a && b) pairs.push([a, b]);
    }
    if (rem.length % 2 === 1) {
      leftover = rem[rem.length - 1] ?? null;
    }
  }

  return { pairs, leftover };
}

function assignColors(
  a: PlayerState,
  b: PlayerState,
): { white: PlayerState; black: PlayerState } {
  const prefA = colorPreference(a);
  const prefB = colorPreference(b);
  const imbA = colorImbalance(a);
  const imbB = colorImbalance(b);

  if (prefA === 'W' && prefB !== 'W') return { white: a, black: b };
  if (prefB === 'W' && prefA !== 'W') return { white: b, black: a };
  if (prefA === 'B' && prefB !== 'B') return { white: b, black: a };
  if (prefB === 'B' && prefA !== 'B') return { white: a, black: b };

  if (imbA !== imbB) {
    return imbA < imbB ? { white: a, black: b } : { white: b, black: a };
  }

  if (a.seed !== b.seed) {
    return a.seed < b.seed ? { white: a, black: b } : { white: b, black: a };
  }

  return a.name.localeCompare(b.name) <= 0
    ? { white: a, black: b }
    : { white: b, black: a };
}

function selectByePlayer(players: PlayerState[]): PlayerState {
  const eligible = [...players].sort((a, b) => {
    if (a.hadBye !== b.hadBye) return a.hadBye ? 1 : -1;
    if (a.score !== b.score) return a.score - b.score;
    if (a.rating !== b.rating) return a.rating - b.rating;
    if (a.seed !== b.seed) return b.seed - a.seed;
    return b.name.localeCompare(a.name);
  });
  const chosen = eligible[0];
  if (!chosen) throw new Error('selectByePlayer called with empty player list');
  return chosen;
}

/** Classic Dutch fold: seed i vs seed i + n/2 (after sorting by seed). */
function dutchFoldPairs(pool: PlayerState[]): Array<[PlayerState, PlayerState]> {
  const sorted = [...pool].sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name));
  const half = sorted.length / 2;
  const pairs: Array<[PlayerState, PlayerState]> = [];
  for (let i = 0; i < half; i++) {
    const top = sorted[i]!;
    const bottom = sorted[i + half]!;
    pairs.push([top, bottom]);
  }
  return pairs;
}

function isFirstRound(input: PairingInput): boolean {
  return input.round === 1 || input.pastGames.length === 0;
}

/**
 * Generate FIDE Swiss pairings for one round.
 * Round 1 uses classic Dutch top-half vs bottom-half; later rounds use score groups.
 */
export function pairSwissRound(input: PairingInput): PairingOutput {
  const states = buildPlayerStates(input.players, input.pastGames);
  if (states.length === 0) {
    return { boards: [], byePlayerId: null };
  }

  let byePlayer: PlayerState | null = null;
  let pool = [...states];

  if (pool.length % 2 === 1) {
    byePlayer = selectByePlayer(pool);
    pool = pool.filter((p) => p.id !== byePlayer!.id);
  }

  let allPairs: Array<[PlayerState, PlayerState]>;

  if (isFirstRound(input)) {
    allPairs = dutchFoldPairs(pool);
  } else {
  // Try global rematch-free matching first (best for small fields)
  const globalNoRematch = findPerfectMatching(pool, false);

  if (globalNoRematch) {
    allPairs = globalNoRematch;
  } else {
    // Score-group pairing with floaters
    const scoreMap = new Map<number, PlayerState[]>();
    for (const p of pool) {
      const list = scoreMap.get(p.score) ?? [];
      list.push(p);
      scoreMap.set(p.score, list);
    }
    const scores = [...scoreMap.keys()].sort((a, b) => b - a);

    allPairs = [];
    let floater: PlayerState | null = null;

    for (let si = 0; si < scores.length; si++) {
      const score = scores[si]!;
      const group = [...(scoreMap.get(score) ?? [])];
      if (floater) {
        group.push(floater);
        floater = null;
      }

      const { pairs, leftover } = pairGroup(group);
      allPairs.push(...pairs);

      if (leftover) {
        if (si === scores.length - 1) {
          // Last group leftover — should not happen with even pool
          // Re-pair entire remaining including leftover via allow rematch
          const unpaired = [leftover];
          floater = leftover;
        } else {
          floater = leftover;
        }
      }
    }

    if (floater) {
      // Emergency: rematch-allowed global rematch of anyone still needing a game
      // Floater means our group logic left one out — re-solve whole pool allowing rematch
      allPairs = findPerfectMatching(pool, true) ?? allPairs;
    }
  }
  }

  const boards: PairingBoard[] = [];
  let boardNum = 1;

  allPairs.sort((x, y) => {
    const sx = x[0].score + x[1].score;
    const sy = y[0].score + y[1].score;
    if (sy !== sx) return sy - sx;
    if (isFirstRound(input)) {
      return Math.min(x[0].seed, x[1].seed) - Math.min(y[0].seed, y[1].seed);
    }
    return (
      Math.max(x[0].rating, x[1].rating) - Math.max(y[0].rating, y[1].rating)
    );
  });

  for (const [a, b] of allPairs) {
    const { white, black } = assignColors(a, b);
    boards.push({
      board: boardNum++,
      whiteId: white.id,
      blackId: black.id,
      isBye: false,
    });
  }

  if (byePlayer) {
    boards.push({
      board: boardNum,
      whiteId: byePlayer.id,
      blackId: null,
      isBye: true,
    });
  }

  return {
    boards,
    byePlayerId: byePlayer?.id ?? null,
  };
}

export type {
  Standing,
  StandingRowMetrics,
  StandingsOptions,
} from './standings.js';

export {
  computeStandingsFromStates,
  reRankSection,
} from './standings.js';

import {
  computeStandingsFromStates,
  reRankSection,
  type Standing,
  type StandingsOptions,
} from './standings.js';

/**
 * Ranking: score first, then configured tiebreaks (see DEFAULT_TIEBREAK_ORDER).
 */
export function computeStandings(
  players: EnginePlayer[],
  pastGames: PastGame[],
  options?: StandingsOptions,
): Standing[] {
  return computeStandingsFromStates(
    buildPlayerStates(players, pastGames),
    pastGames,
    options,
  );
}

/**
 * Full-field metrics, then re-rank within a section (e.g. age category).
 */
export function computeSectionStandings(
  players: EnginePlayer[],
  pastGames: PastGame[],
  sectionPlayerIds: ReadonlySet<string>,
  options?: StandingsOptions,
): Standing[] {
  const full = computeStandings(players, pastGames, options);
  if (sectionPlayerIds.size === 0) return [];
  const section = full.filter((s) => sectionPlayerIds.has(s.id));
  return reRankSection(section, pastGames, options?.sharedPlaces !== false);
}

type RankablePlayer = {
  id: string;
  name: string;
  rating?: number | null;
  seed?: number | null;
  categoryIds?: string[];
};

/**
 * Current / end rank for every player in their pairing pool.
 * Mixed (or no categories): one field ranking. Separate categories: 1…n within each section.
 * Empty until at least one finished game exists.
 */
export function computeEndRankMap(
  players: RankablePlayer[],
  games: Array<{
    round: number;
    whiteId?: string | null;
    blackId?: string | null;
    result: string;
    isBye: boolean;
    categoryId?: string | null;
  }>,
  opts?: {
    mixCategories?: boolean;
    tiebreakOrder?: StandingsOptions['tiebreakOrder'];
    sharedPlaces?: boolean;
  },
): Map<string, number> {
  const map = new Map<string, number>();
  const finished = games.filter((g) => g.result !== 'pending');
  if (finished.length === 0 || players.length === 0) return map;

  const standingsOpts: StandingsOptions = {
    tiebreakOrder: opts?.tiebreakOrder ?? null,
    sharedPlaces: opts?.sharedPlaces ?? true,
  };
  const mix = opts?.mixCategories !== false;
  const toEngine = (list: RankablePlayer[]): EnginePlayer[] =>
    list.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating ?? undefined,
      seed: p.seed ?? undefined,
    }));
  const toPast = (list: typeof finished): PastGame[] =>
    list.map((g) => ({
      round: g.round,
      whiteId: g.whiteId ?? null,
      blackId: g.blackId ?? null,
      result: g.result as GameResult,
      isBye: g.isBye,
    }));
  const write = (rows: Standing[]) => {
    for (const s of rows) map.set(s.id, s.rank);
  };

  if (mix) {
    write(computeStandings(toEngine(players), toPast(finished), standingsOpts));
    return map;
  }

  const byCat = new Map<string, RankablePlayer[]>();
  for (const p of players) {
    const cats = p.categoryIds?.length ? p.categoryIds : ['_none'];
    for (const c of cats) {
      const list = byCat.get(c) ?? [];
      list.push(p);
      byCat.set(c, list);
    }
  }
  for (const [catId, pool] of byCat) {
    const catGames =
      catId === '_none'
        ? finished
        : finished.filter((g) => !g.categoryId || g.categoryId === catId);
    write(computeStandings(toEngine(pool), toPast(catGames), standingsOpts));
  }
  return map;
}

export function diagnosePairings(
  players: EnginePlayer[],
  pastGames: PastGame[],
): {
  rematchCount: number;
  byeCounts: Record<string, number>;
  colorImbalances: Array<{ id: string; name: string; imbalance: number }>;
} {
  const states = buildPlayerStates(players, pastGames);

  let rematchCount = 0;
  const pairCounts = new Map<string, number>();
  for (const s of states) {
    for (const oid of s.opponents) {
      if (s.id < oid) {
        const key = `${s.id}:${oid}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  for (const count of pairCounts.values()) {
    if (count > 1) rematchCount += count - 1;
  }

  const byeCounts: Record<string, number> = {};
  for (const g of pastGames) {
    if (!g.isBye) continue;
    const id = g.whiteId ?? g.blackId;
    if (!id) continue;
    byeCounts[id] = (byeCounts[id] ?? 0) + 1;
  }

  const colorImbalances = states.map((s) => ({
    id: s.id,
    name: s.name,
    imbalance: colorImbalance(s),
  }));

  return { rematchCount, byeCounts, colorImbalances };
}

/** First round before `beforeRound` that still has pending non-bye results. */
export function firstRoundMissingResults(
  pastGames: PastGame[],
  beforeRound: number,
): number | null {
  for (let r = 1; r < beforeRound; r++) {
    const roundGames = pastGames.filter((g) => g.round === r);
    if (roundGames.length === 0) continue;
    if (roundGames.some((g) => !g.isBye && g.result === 'pending')) return r;
  }
  return null;
}
