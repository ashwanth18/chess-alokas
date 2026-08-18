/**
 * Replay ALoKAS RAPID CHESS CHAMPIONSHIP 2026 with bbpPairings Dutch.
 * For each round: pair from historical results so far, compare to what was played.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairRound, diagnosePairings, type EnginePlayer, type PastGame } from '../packages/pairing-engine/src/index.ts';
import { pairDutchWithBbp } from '../packages/pairing-engine/src/dutch/bbp.ts';
import { isPlayedResult } from '../packages/pairing-engine/src/dutch/state.ts';
import type { GameResult } from '../packages/shared/src/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'arcc-2026.json'), 'utf8')) as {
  players: EnginePlayer[];
  games: PastGame[];
};

const PLAYED = new Set<GameResult>(['1-0', '0-1', '1/2-1/2']);

function shortName(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim();
  const parts = t.split(' ');
  if (parts[0] && parts[0].length >= 3) return parts[0];
  return t.slice(0, 18);
}

function pts(id: string, games: PastGame[]): number {
  let s = 0;
  for (const g of games) {
    if (g.isBye && (g.whiteId === id || g.blackId === id)) {
      s += 1;
      continue;
    }
    if (g.whiteId !== id && g.blackId !== id) continue;
    if (g.result === '1-0' || g.result === '1-0F') s += g.whiteId === id ? 1 : 0;
    else if (g.result === '0-1' || g.result === '0-1F') s += g.blackId === id ? 1 : 0;
    else if (g.result === '1/2-1/2') s += 0.5;
  }
  return s;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function opponentOf(g: PastGame, id: string): string | null {
  if (g.isBye) return null;
  if (g.whiteId === id) return g.blackId;
  if (g.blackId === id) return g.whiteId;
  return null;
}

function playedOpponents(id: string, games: PastGame[]): Set<string> {
  const out = new Set<string>();
  for (const g of games) {
    if (!isPlayedResult(g.result, g.isBye)) continue;
    const opp = opponentOf(g, id);
    if (opp) out.add(opp);
  }
  return out;
}

function boardsOf(games: PastGame[]) {
  return games
    .filter((g) => !g.isBye)
    .map((g) => ({
      whiteId: g.whiteId!,
      blackId: g.blackId!,
      isBye: false as const,
    }));
}

function pairSet(games: { whiteId: string | null; blackId: string | null; isBye: boolean }[]): Set<string> {
  const s = new Set<string>();
  for (const g of games) {
    if (g.isBye || !g.whiteId || !g.blackId) continue;
    s.add(pairKey(g.whiteId, g.blackId));
  }
  return s;
}

function scoreGapIssues(roundGames: PastGame[], prior: PastGame[], players: EnginePlayer[]) {
  const issues: Array<{
    white: string;
    black: string;
    whitePts: number;
    blackPts: number;
    gap: number;
  }> = [];
  for (const g of roundGames) {
    if (g.isBye || !g.whiteId || !g.blackId) continue;
    const w = pts(g.whiteId, prior);
    const b = pts(g.blackId, prior);
    const gap = Math.abs(w - b);
    if (gap >= 1) {
      issues.push({
        white: players.find((p) => p.id === g.whiteId)!.name,
        black: players.find((p) => p.id === g.blackId)!.name,
        whitePts: w,
        blackPts: b,
        gap,
      });
    }
  }
  return issues;
}

function rematchesIn(roundGames: PastGame[], prior: PastGame[], playedOnly: boolean) {
  const found: Array<{ a: string; b: string; priorRound: number; priorResult: string }> = [];
  for (const g of roundGames) {
    if (g.isBye || !g.whiteId || !g.blackId) continue;
    const prev = prior.find((p) => {
      if (p.isBye) return false;
      const same =
        (p.whiteId === g.whiteId && p.blackId === g.blackId) ||
        (p.whiteId === g.blackId && p.blackId === g.whiteId);
      if (!same) return false;
      if (playedOnly) return PLAYED.has(p.result);
      return true;
    });
    if (prev) {
      found.push({
        a: g.whiteId,
        b: g.blackId,
        priorRound: prev.round,
        priorResult: prev.result,
      });
    }
  }
  return found;
}

function nameOf(id: string | null | undefined): string {
  if (!id) return 'BYE';
  return data.players.find((p) => p.id === id)?.name ?? id.slice(0, 8);
}

function groupSizes(prior: PastGame[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of data.players) {
    const s = pts(p.id, prior).toFixed(1);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

function sameScoreRate(roundGames: PastGame[], prior: PastGame[]): number {
  const played = roundGames.filter((g) => !g.isBye && g.whiteId && g.blackId);
  if (!played.length) return 1;
  let same = 0;
  for (const g of played) {
    if (pts(g.whiteId!, prior) === pts(g.blackId!, prior)) same += 1;
  }
  return same / played.length;
}

const report: Record<string, unknown> = {
  event: 'ALoKAS RAPID CHESS CHAMPIONSHIP 2026',
  players: data.players.length,
  rounds: 5,
  method:
    'For each round, keep historical results 1..N-1 fixed, then re-pair round N with bbpPairings v6 Dutch.',
};

const byRound: unknown[] = [];
const players = data.players;

for (let round = 1; round <= 5; round++) {
  const prior = data.games.filter((g) => g.round < round);
  const actual = data.games.filter((g) => g.round === round);
  const input = { players, pastGames: prior, round, totalRounds: 5 as const };

  const dutch = await pairDutchWithBbp(input);
  const swiss = pairRound('swiss', input);

  const actualSet = pairSet(actual);
  const dutchSet = pairSet(dutch.boards);
  const swissSet = pairSet(swiss.boards);

  let dutchMatch = 0;
  for (const k of actualSet) if (dutchSet.has(k)) dutchMatch += 1;
  let swissMatch = 0;
  for (const k of actualSet) if (swissSet.has(k)) swissMatch += 1;

  const actualBye = actual.find((g) => g.isBye)?.whiteId ?? null;
  const scores = groupSizes(prior);

  const topScore = Math.max(...players.map((p) => pts(p.id, prior)));
  const leaders = players.filter((p) => pts(p.id, prior) === topScore);

  function leaderPairings(
    boards: { whiteId: string | null; blackId: string | null; isBye: boolean }[],
  ) {
    return leaders.map((p) => {
      const b = boards.find((x) => x.whiteId === p.id || x.blackId === p.id);
      const opp = !b || b.isBye ? null : b.whiteId === p.id ? b.blackId : b.whiteId;
      return {
        player: shortName(p.name),
        score: topScore,
        opponent: opp ? `${shortName(nameOf(opp))} (${pts(opp, prior)})` : 'BYE',
        sameScore: opp ? pts(opp, prior) === topScore : false,
      };
    });
  }

  byRound.push({
    round,
    scoreGroups: scores,
    actualSameScoreRate: Math.round(sameScoreRate(actual, prior) * 100),
    dutchSameScoreRate: Math.round(
      sameScoreRate(
        dutch.boards.map((b) => ({
          round,
          whiteId: b.whiteId,
          blackId: b.blackId,
          result: 'pending' as const,
          isBye: b.isBye,
        })),
        prior,
      ) * 100,
    ),
    actualPairsMatchingDutch: `${dutchMatch}/${actualSet.size}`,
    actualPairsMatchingOldSwiss: `${swissMatch}/${actualSet.size}`,
    actualBye: shortName(nameOf(actualBye)),
    dutchBye: shortName(nameOf(dutch.byePlayerId)),
    scoreGapsActual: scoreGapIssues(actual, prior, players).map((x) => ({
      ...x,
      white: shortName(x.white),
      black: shortName(x.black),
    })),
    scoreGapsDutch: scoreGapIssues(
      dutch.boards.map((b) => ({
        round,
        whiteId: b.whiteId,
        blackId: b.blackId,
        result: 'pending' as const,
        isBye: b.isBye,
      })),
      prior,
      players,
    ).map((x) => ({
      ...x,
      white: shortName(x.white),
      black: shortName(x.black),
    })),
    rematchesPlayed: rematchesIn(actual, prior, true).map((r) => ({
      a: shortName(nameOf(r.a)),
      b: shortName(nameOf(r.b)),
      priorRound: r.priorRound,
      priorResult: r.priorResult,
    })),
    rematchesAny: rematchesIn(actual, prior, false).map((r) => ({
      a: shortName(nameOf(r.a)),
      b: shortName(nameOf(r.b)),
      priorRound: r.priorRound,
      priorResult: r.priorResult,
    })),
    leadersActual: leaderPairings(actual),
    leadersDutch: leaderPairings(dutch.boards),
    r1Style:
      round === 1
        ? {
            actual: boardsOf(actual)
              .slice(0, 8)
              .map((b) => {
                const ws = players.find((p) => p.id === b.whiteId)?.seed;
                const bs = players.find((p) => p.id === b.blackId)?.seed;
                return `${ws}–${bs}`;
              }),
            dutch: dutch.boards
              .filter((b) => !b.isBye)
              .slice(0, 8)
              .map((b) => {
                const ws = players.find((p) => p.id === b.whiteId)?.seed;
                const bs = players.find((p) => p.id === b.blackId)?.seed;
                return `${ws}–${bs}`;
              }),
          }
        : undefined,
  });
}

const allPrior = data.games;
const diag = diagnosePairings(players, allPrior);
const byeRepeat = Object.entries(diag.byeCounts).filter(([, n]) => n > 1);
const colorBad = diag.colorImbalances
  .filter((c) => Math.abs(c.imbalance) >= 3)
  .map((c) => ({ name: shortName(c.name), imbalance: c.imbalance }));

const playedRematchTotal = data.games.filter((g, i, arr) => {
  if (g.isBye || !g.whiteId || !g.blackId) return false;
  return arr.some(
    (p) =>
      p.round < g.round &&
      PLAYED.has(p.result) &&
      !p.isBye &&
      ((p.whiteId === g.whiteId && p.blackId === g.blackId) ||
        (p.whiteId === g.blackId && p.blackId === g.whiteId)),
  );
}).length;

report.byRound = byRound;
report.wholeEvent = {
  playedRematches: playedRematchTotal,
  diagnoseRematchCount: diag.rematchCount,
  repeatByes: byeRepeat.map(([id, n]) => ({ name: shortName(nameOf(id)), n })),
  colorImbalance3plus: colorBad,
};

const out = path.join(__dirname, 'arcc-dutch-replay.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('\nWrote', out);
