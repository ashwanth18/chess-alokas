import {
  compareQuality,
  evaluateQuality,
  legalOpponents,
  pairsViolateAbsolute,
} from './criteria.js';
import { canReceivePab, sortByPairingOrder } from './state.js';
import type {
  BracketCandidate,
  DutchContext,
  DutchPair,
  DutchPlayer,
} from './types.js';

const MAX_CANDIDATES = 4_000;
const MAX_S2_PERM = 6;
const MAX_S2_PARTIAL = 200;
const NESTED_BUDGET = 400;

interface Tagged {
  player: DutchPlayer;
  bsn: number;
}

export interface BracketOpts {
  isLast: boolean;
  remainingAfter: DutchPlayer[];
  pabFromThis?: boolean;
  /** Unavoidable downfloaters in this bracket (0 if even, 1 if odd). */
  minDownfloaters?: number;
  budget?: number;
}

function tag(players: DutchPlayer[]): Tagged[] {
  return sortByPairingOrder(players).map((player, i) => ({ player, bsn: i + 1 }));
}

function nextPermutation(bsns: number[]): boolean {
  let i = bsns.length - 2;
  while (i >= 0 && bsns[i]! >= bsns[i + 1]!) i -= 1;
  if (i < 0) return false;
  let j = bsns.length - 1;
  while (bsns[j]! <= bsns[i]!) j -= 1;
  [bsns[i], bsns[j]] = [bsns[j]!, bsns[i]!];
  let l = i + 1;
  let r = bsns.length - 1;
  while (l < r) {
    [bsns[l], bsns[r]] = [bsns[r]!, bsns[l]!];
    l += 1;
    r -= 1;
  }
  return true;
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function compareExchange(
  a: { fromS1: number[]; fromS2: number[] },
  b: { fromS1: number[]; fromS2: number[] },
): number {
  if (a.fromS1.length !== b.fromS1.length) return a.fromS1.length - b.fromS1.length;
  const diffA = a.fromS2.reduce((s, n) => s + n, 0) - a.fromS1.reduce((s, n) => s + n, 0);
  const diffB = b.fromS2.reduce((s, n) => s + n, 0) - b.fromS1.reduce((s, n) => s + n, 0);
  if (diffA !== diffB) return diffA - diffB;
  const s1a = [...a.fromS1].sort((x, y) => y - x);
  const s1b = [...b.fromS1].sort((x, y) => y - x);
  for (let i = 0; i < s1a.length; i++) {
    if (s1a[i] !== s1b[i]) return (s1b[i] ?? 0) - (s1a[i] ?? 0);
  }
  const s2a = [...a.fromS2].sort((x, y) => x - y);
  const s2b = [...b.fromS2].sort((x, y) => x - y);
  for (let i = 0; i < s2a.length; i++) {
    if (s2a[i] !== s2b[i]) return (s2a[i] ?? 0) - (s2b[i] ?? 0);
  }
  return 0;
}

function applyExchange(
  originalS1: Tagged[],
  originalS2: Tagged[],
  fromS1: number[],
  fromS2: number[],
): { s1: Tagged[]; s2: Tagged[] } {
  const move1 = new Set(fromS1);
  const move2 = new Set(fromS2);
  const s1Players = [
    ...originalS1.filter((t) => !move1.has(t.bsn)).map((t) => t.player),
    ...originalS2.filter((t) => move2.has(t.bsn)).map((t) => t.player),
  ];
  const s2Players = [
    ...originalS2.filter((t) => !move2.has(t.bsn)).map((t) => t.player),
    ...originalS1.filter((t) => move1.has(t.bsn)).map((t) => t.player),
  ];
  const retag = (ps: DutchPlayer[]) =>
    sortByPairingOrder(ps).map((player) => {
      const prev = [...originalS1, ...originalS2].find((t) => t.player.id === player.id);
      return { player, bsn: prev?.bsn ?? 0 };
    });
  return { s1: retag(s1Players), s2: retag(s2Players) };
}

function* s2Orders(s2: Tagged[], _n1: number): Generator<Tagged[]> {
  if (s2.length === 0) {
    yield [];
    return;
  }
  yield s2;
  const byBsn = new Map(s2.map((t) => [t.bsn, t]));
  const seq = s2.map((t) => t.bsn);
  const limit = s2.length <= MAX_S2_PERM ? Number.POSITIVE_INFINITY : MAX_S2_PARTIAL;
  let emitted = 0;
  while (nextPermutation(seq) && emitted < limit) {
    yield seq.map((b) => byBsn.get(b)!);
    emitted += 1;
  }
}

function zipPairs(s1: Tagged[], s2: Tagged[]): { pairs: DutchPair[]; leftover: Tagged[] } {
  const n = Math.min(s1.length, s2.length);
  const pairs: DutchPair[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ a: s1[i]!.player, b: s2[i]!.player });
  }
  const leftover = s1.length >= s2.length ? s1.slice(n) : s2.slice(n);
  return { pairs, leftover };
}

const MATCH_NODE_LIMIT = 6_000;

function greedyPerfect(players: DutchPlayer[], ctx: DutchContext): boolean {
  const used = new Set<string>();
  const ordered = sortByPairingOrder(players);
  for (const a of ordered) {
    if (used.has(a.id)) continue;
    const b = ordered.find((p) => !used.has(p.id) && p.id !== a.id && legalOpponents(a, p, ctx));
    if (!b) return false;
    used.add(a.id);
    used.add(b.id);
  }
  return used.size === players.length;
}

function matchingExists(players: DutchPlayer[], ctx: DutchContext): boolean {
  const memo = ctx.matchMemo ?? (ctx.matchMemo = new Map());
  const key = `${ctx.allowRematch ? 'r' : 'n'}:${[...players].map((p) => p.id).sort().join(',')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const write = (ok: boolean) => {
    memo.set(key, ok);
    return ok;
  };

  if (players.length === 0) return write(true);
  if (players.length === 1) return write(canReceivePab(players[0]!) || ctx.allowRematch);
  if (players.length % 2 === 1) {
    const eligible = sortByPairingOrder(players)
      .filter((p) => canReceivePab(p) || ctx.allowRematch)
      .sort((a, b) => a.score - b.score || b.tpn - a.tpn);
    const tries = players.length <= 10 ? eligible : eligible.slice(0, 5);
    for (const bye of tries) {
      if (matchingExists(players.filter((p) => p.id !== bye.id), ctx)) return write(true);
    }
    return write(false);
  }

  if (greedyPerfect(players, ctx)) return write(true);

  const ids = players.map((p) => p.id);
  const byId = new Map(players.map((p) => [p.id, p]));
  const paired = new Set<string>();
  let nodes = 0;

  const candidates = (id: string): string[] => {
    const a = byId.get(id)!;
    return ids.filter((oid) => oid !== id && !paired.has(oid) && legalOpponents(a, byId.get(oid)!, ctx));
  };

  const search = (): boolean => {
    if (++nodes > MATCH_NODE_LIMIT) return true;
    const unpaired = ids.filter((id) => !paired.has(id));
    if (unpaired.length === 0) return true;
    let best: string | null = null;
    let bestOpts: string[] = [];
    for (const id of unpaired) {
      const opts = candidates(id);
      if (!best || opts.length < bestOpts.length) {
        best = id;
        bestOpts = opts;
      }
    }
    if (!best || bestOpts.length === 0) return false;
    for (const partner of bestOpts) {
      paired.add(best);
      paired.add(partner);
      if (search()) return true;
      paired.delete(best);
      paired.delete(partner);
    }
    return false;
  };

  return write(search());
}

/** C.8: the following score bracket plus these MDPs must still be pairable. */
function lookaheadPenalty(
  downfloaters: DutchPlayer[],
  remainingAfter: DutchPlayer[],
  ctx: DutchContext,
): number {
  if (remainingAfter.length === 0) {
    if (downfloaters.length <= 1) {
      const only = downfloaters[0];
      if (only && !canReceivePab(only) && !ctx.allowRematch) return 1;
      return 0;
    }
    return matchingExists(downfloaters, ctx) ? 0 : 1;
  }
  const top = Math.max(...remainingAfter.map((p) => p.score));
  const next = remainingAfter.filter((p) => p.score === top);
  return matchingExists([...downfloaters, ...next], ctx) ? 0 : 1;
}

function pabIfLast(
  downfloaters: DutchPlayer[],
  isLast: boolean,
): DutchPlayer | null {
  if (!isLast || downfloaters.length !== 1) return null;
  return downfloaters[0] ?? null;
}

function candidateFrom(
  pairs: DutchPair[],
  downfloaters: DutchPlayer[],
  ctx: DutchContext,
  opts: BracketOpts,
  mdps: DutchPlayer[],
): BracketCandidate | null {
  const pab = pabIfLast(downfloaters, opts.isLast);
  if (pab && !canReceivePab(pab) && !ctx.allowRematch) return null;
  if (pairsViolateAbsolute(pairs, ctx)) return null;
  const penalty = lookaheadPenalty(downfloaters, opts.remainingAfter, ctx);
  const quality = evaluateQuality(pairs, downfloaters, ctx, {
    pab,
    lookaheadPenalty: penalty,
    mdps,
  });
  return { pairs, downfloaters, quality };
}

function isPerfect(c: BracketCandidate, minDownfloaters: number): boolean {
  const c6 = c.quality[1] ?? 0;
  if (c6 > minDownfloaters) return false;
  return c.quality.every((n, i) => i === 1 || n <= 0);
}

function consider(
  state: { best: BracketCandidate | null; count: number; minDown: number; budget: number },
  cand: BracketCandidate | null,
): 'perfect' | 'continue' | 'stop' {
  if (!cand) return 'continue';
  state.count += 1;
  if (!state.best || compareQuality(cand.quality, state.best.quality) < 0) {
    state.best = cand;
  }
  if (isPerfect(cand, state.minDown)) return 'perfect';
  if (state.count >= state.budget) return 'stop';
  return 'continue';
}

function pairHomogeneous(
  players: DutchPlayer[],
  ctx: DutchContext,
  opts: BracketOpts,
  mdps: DutchPlayer[] = [],
): BracketCandidate {
  const ordered = sortByPairingOrder(players);
  if (ordered.length === 0) {
    return { pairs: [], downfloaters: [], quality: evaluateQuality([], [], ctx) };
  }
  if (ordered.length === 1) {
    const only = ordered[0]!;
    const cand = candidateFrom([], [only], ctx, opts, mdps);
    return cand ?? { pairs: [], downfloaters: [only], quality: evaluateQuality([], [only], ctx, { pab: only }) };
  }

  const maxPairs = Math.floor(ordered.length / 2);
  const tagged = tag(ordered);
  const originalS1 = tagged.slice(0, maxPairs);
  const originalS2 = tagged.slice(maxPairs);
  const minDown = opts.minDownfloaters ?? (ordered.length % 2);
  const state: { best: BracketCandidate | null; count: number; minDown: number; budget: number } = {
    best: null,
    count: 0,
    minDown,
    budget: opts.budget ?? MAX_CANDIDATES,
  };

  const trySplit = (s1: Tagged[], s2: Tagged[]): 'perfect' | 'continue' | 'stop' => {
    for (const s2o of s2Orders(s2, s1.length)) {
      const { pairs, leftover } = zipPairs(s1, s2o);
      const down = leftover.map((t) => t.player);
      const outcome = consider(state, candidateFrom(pairs, down, ctx, opts, mdps));
      if (outcome !== 'continue') return outcome;
    }
    return 'continue';
  };

  if (trySplit(originalS1, originalS2) === 'perfect') return state.best!;

  const maxK = Math.min(3, originalS1.length, originalS2.length);
  const exchanges: Array<{ fromS1: number[]; fromS2: number[] }> = [];
  for (let k = 1; k <= maxK; k++) {
    if (combinations(originalS1.map((t) => t.bsn), k).length *
        combinations(originalS2.map((t) => t.bsn), k).length >
      2500) {
      break;
    }
    for (const a of combinations(originalS1.map((t) => t.bsn), k)) {
      for (const b of combinations(originalS2.map((t) => t.bsn), k)) {
        exchanges.push({ fromS1: a, fromS2: b });
      }
    }
  }
  exchanges.sort(compareExchange);

  for (const ex of exchanges) {
    const { s1, s2 } = applyExchange(originalS1, originalS2, ex.fromS1, ex.fromS2);
    const outcome = trySplit(s1, s2);
    if (outcome === 'perfect' || outcome === 'stop') break;
  }

  if (state.best) return state.best;

  const greedy: DutchPair[] = [];
  const used = new Set<string>();
  for (const a of ordered) {
    if (used.has(a.id)) continue;
    const b = ordered.find((p) => !used.has(p.id) && p.id !== a.id && legalOpponents(a, p, ctx));
    if (b) {
      greedy.push({ a, b });
      used.add(a.id);
      used.add(b.id);
    }
  }
  const down = ordered.filter((p) => !used.has(p.id));
  return (
    candidateFrom(greedy, down, ctx, opts, mdps) ?? {
      pairs: greedy,
      downfloaters: down,
      quality: evaluateQuality(greedy, down, ctx),
    }
  );
}

function mdpSets(mdps: DutchPlayer[], m1: number): DutchPlayer[][] {
  if (m1 <= 0) return [[]];
  if (m1 >= mdps.length) return [sortByPairingOrder(mdps)];
  const ordered = sortByPairingOrder(mdps);
  const tagged = tag(ordered);
  const combos = combinations(tagged, m1);
  const valid = combos.map((c) => c.map((t) => t.player));
  valid.sort((a, b) => {
    const ta = tag(a);
    const tb = tag(b);
    const sa = ta.map((t) => t.bsn);
    const sb = tb.map((t) => t.bsn);
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa[i] !== sb[i]) return (sa[i] ?? 0) - (sb[i] ?? 0);
    }
    return sa.length - sb.length;
  });
  return valid;
}

function pairHeterogeneous(
  residents: DutchPlayer[],
  mdps: DutchPlayer[],
  ctx: DutchContext,
  opts: BracketOpts,
): BracketCandidate {
  const M0 = mdps.length;
  const maxPairs = Math.min(
    Math.floor((residents.length + M0) / 2),
    residents.length,
    M0 + Math.floor(residents.length / 2),
  );
  const M1 = Math.min(M0, maxPairs, residents.length);
  const minDown = opts.minDownfloaters ?? ((residents.length + M0) % 2);
  const state: { best: BracketCandidate | null; count: number; minDown: number; budget: number } = {
    best: null,
    count: 0,
    minDown,
    budget: opts.budget ?? MAX_CANDIDATES,
  };

  for (const s1Players of mdpSets(mdps, M1)) {
    const limbo = mdps.filter((p) => !s1Players.some((s) => s.id === p.id));
    const s1 = tag(s1Players);
    const s2orig = tag(residents);

    for (const s2 of s2Orders(s2orig, s1.length)) {
      const { pairs: mdpPairs, leftover } = zipPairs(s1, s2);
      if (pairsViolateAbsolute(mdpPairs, ctx)) {
        state.count += 1;
        if (state.count >= MAX_CANDIDATES) break;
        continue;
      }
      const remainderPlayers = leftover.map((t) => t.player);
      const rem = pairHomogeneous(remainderPlayers, ctx, {
        ...opts,
        isLast: opts.isLast && limbo.length === 0,
        remainingAfter: opts.remainingAfter,
        budget: Math.min(NESTED_BUDGET, opts.budget ?? MAX_CANDIDATES),
      }, mdps);
      const pairs = [...mdpPairs, ...rem.pairs];
      const down = [...limbo, ...rem.downfloaters];
      const outcome = consider(state, candidateFrom(pairs, down, ctx, opts, mdps));
      if (outcome === 'perfect' || outcome === 'stop') {
        return state.best!;
      }
    }
  }

  if (state.best) return state.best;
  return pairHomogeneous([...mdps, ...residents], ctx, opts, mdps);
}

export function pairBracket(
  residents: DutchPlayer[],
  mdps: DutchPlayer[],
  ctx: DutchContext,
  opts: BracketOpts,
): BracketCandidate {
  if (mdps.length === 0) return pairHomogeneous(residents, ctx, opts, []);
  return pairHeterogeneous(residents, mdps, ctx, opts);
}

export function pairScoreBrackets(
  players: DutchPlayer[],
  ctx: DutchContext,
): { pairs: DutchPair[]; bye: DutchPlayer | null } {
  if (!ctx.matchMemo) ctx.matchMemo = new Map();
  if (players.length === 0) return { pairs: [], bye: null };

  const byScore = new Map<number, DutchPlayer[]>();
  for (const p of players) {
    const list = byScore.get(p.score) ?? [];
    list.push(p);
    byScore.set(p.score, list);
  }
  const scores = [...byScore.keys()].sort((a, b) => b - a);
  const pairs: DutchPair[] = [];
  let mdps: DutchPlayer[] = [];

  for (let i = 0; i < scores.length; i++) {
    const residents = sortByPairingOrder(byScore.get(scores[i]!) ?? []);
    const later: DutchPlayer[] = [];
    for (let j = i + 1; j < scores.length; j++) {
      later.push(...(byScore.get(scores[j]!) ?? []));
    }
    const cand = pairBracket(residents, mdps, ctx, {
      isLast: i === scores.length - 1,
      remainingAfter: later,
    });
    pairs.push(...cand.pairs);
    mdps = cand.downfloaters;
  }

  if (mdps.length <= 1) {
    return { pairs, bye: mdps[0] ?? null };
  }

  const collapsed = pairHomogeneous(mdps, ctx, { isLast: true, remainingAfter: [] }, []);
  pairs.push(...collapsed.pairs);
  const leftover = collapsed.downfloaters;
  if (leftover.length <= 1) return { pairs, bye: leftover[0] ?? null };

  const used = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]));
  const rest = players.filter((p) => !used.has(p.id));
  if (rest.length === 1) return { pairs, bye: rest[0]! };
  const rematchCtx: DutchContext = { ...ctx, allowRematch: true };
  const forced = pairHomogeneous(rest, rematchCtx, { isLast: true, remainingAfter: [] }, []);
  pairs.push(...forced.pairs);
  return { pairs, bye: forced.downfloaters[0] ?? null };
}

export { matchingExists };
