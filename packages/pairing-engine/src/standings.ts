import {
  normalizeTiebreakOrder,
  type TiebreakKey,
} from '@chess-alokas/shared';
import type { EnginePlayer } from './swiss.js';
import type { PastGame } from './swiss.js';
import type { PlayerId } from './swiss.js';
import type { PlayerState } from './swiss.js';

export type StandingRowMetrics = {
  buchholz: number;
  buchholzCut1: number;
  sonnebornBerger: number;
  progressive: number;
  wins: number;
  rank: number;
};

export type Standing = PlayerState & StandingRowMetrics;

export type StandingsOptions = {
  tiebreakOrder?: TiebreakKey[] | null;
  /** Default true: shared 1224 ranks when performance TBs match. */
  sharedPlaces?: boolean;
};

function pointsFromGame(
  playerId: PlayerId,
  game: PastGame,
): { opponentId: PlayerId; points: number } | null {
  if (game.isBye || game.result === 'bye') return null;
  const { whiteId, blackId, result } = game;
  if (!whiteId || !blackId) return null;
  if (playerId !== whiteId && playerId !== blackId) return null;

  const isWhite = playerId === whiteId;
  const opponentId = isWhite ? blackId : whiteId;
  let points = 0;
  if (result === '1-0' || result === '1-0F') points = isWhite ? 1 : 0;
  else if (result === '0-1' || result === '0-1F') points = isWhite ? 0 : 1;
  else if (result === '1/2-1/2') points = 0.5;
  return { opponentId, points };
}

function applyRoundPoints(scores: Map<PlayerId, number>, games: PastGame[]): void {
  for (const game of games) {
    if (game.isBye || game.result === 'bye') {
      const byeId = game.whiteId ?? game.blackId;
      if (byeId && scores.has(byeId)) {
        scores.set(byeId, (scores.get(byeId) ?? 0) + 1);
      }
      continue;
    }
    if (!game.whiteId || !game.blackId) continue;
    const whitePts =
      game.result === '1-0' || game.result === '1-0F'
        ? 1
        : game.result === '1/2-1/2'
          ? 0.5
          : 0;
    const blackPts =
      game.result === '0-1' || game.result === '0-1F'
        ? 1
        : game.result === '1/2-1/2'
          ? 0.5
          : 0;
    if (scores.has(game.whiteId)) {
      scores.set(game.whiteId, (scores.get(game.whiteId) ?? 0) + whitePts);
    }
    if (scores.has(game.blackId)) {
      scores.set(game.blackId, (scores.get(game.blackId) ?? 0) + blackPts);
    }
  }
}

function computeProgressiveMap(
  playerIds: PlayerId[],
  pastGames: PastGame[],
): Map<PlayerId, number> {
  const scores = new Map(playerIds.map((id) => [id, 0]));
  const progressive = new Map(playerIds.map((id) => [id, 0]));
  const rounds = [...new Set(pastGames.map((g) => g.round))].sort((a, b) => a - b);
  for (const round of rounds) {
    applyRoundPoints(
      scores,
      pastGames.filter((g) => g.round === round),
    );
    for (const id of playerIds) {
      progressive.set(id, (progressive.get(id) ?? 0) + (scores.get(id) ?? 0));
    }
  }
  return progressive;
}

function directEncounterPoints(
  pastGames: PastGame[],
  playerId: PlayerId,
  opponentId: PlayerId,
): number | null {
  let played = false;
  let points = 0;
  for (const game of pastGames) {
    const scored = pointsFromGame(playerId, game);
    if (!scored || scored.opponentId !== opponentId) continue;
    played = true;
    points += scored.points;
  }
  return played ? points : null;
}

type MetricsRow = PlayerState & {
  buchholz: number;
  buchholzCut1: number;
  sonnebornBerger: number;
  progressive: number;
  wins: number;
};

function compareByTiebreak(
  a: MetricsRow,
  b: MetricsRow,
  key: TiebreakKey,
  pastGames: PastGame[],
): number {
  switch (key) {
    case 'buchholz':
      return b.buchholz - a.buchholz;
    case 'buchholzCut1':
      return b.buchholzCut1 - a.buchholzCut1;
    case 'sonnebornBerger':
      return b.sonnebornBerger - a.sonnebornBerger;
    case 'progressive':
      return b.progressive - a.progressive;
    case 'directEncounter': {
      const aVsB = directEncounterPoints(pastGames, a.id, b.id);
      const bVsA = directEncounterPoints(pastGames, b.id, a.id);
      if (aVsB != null && bVsA != null && aVsB !== bVsA) return bVsA - aVsB;
      return 0;
    }
    case 'wins':
      return b.wins - a.wins;
    case 'rating':
      return b.rating - a.rating;
    case 'seed':
      return a.seed - b.seed;
    default:
      return 0;
  }
}

function performanceEqual(
  a: MetricsRow,
  b: MetricsRow,
  pastGames: PastGame[],
): boolean {
  if (a.score !== b.score) return false;
  if (a.buchholz !== b.buchholz) return false;
  if (a.buchholzCut1 !== b.buchholzCut1) return false;
  if (a.sonnebornBerger !== b.sonnebornBerger) return false;
  if (a.progressive !== b.progressive) return false;
  if (a.wins !== b.wins) return false;
  const aVsB = directEncounterPoints(pastGames, a.id, b.id);
  const bVsA = directEncounterPoints(pastGames, b.id, a.id);
  if (aVsB != null && bVsA != null && aVsB !== bVsA) return false;
  return true;
}

function assignRanks(
  sorted: MetricsRow[],
  pastGames: PastGame[],
  sharedPlaces: boolean,
): Standing[] {
  if (!sharedPlaces) {
    return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
  }
  const ranks: number[] = new Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && performanceEqual(sorted[i]!, sorted[i - 1]!, pastGames)) {
      ranks[i] = ranks[i - 1]!;
    } else {
      ranks[i] = i + 1;
    }
  }
  return sorted.map((s, i) => ({ ...s, rank: ranks[i]! }));
}

export function computeStandingsFromStates(
  states: PlayerState[],
  pastGames: PastGame[],
  options?: StandingsOptions,
): Standing[] {
  const order = normalizeTiebreakOrder(options?.tiebreakOrder);
  const sharedPlaces = options?.sharedPlaces !== false;
  const byId = new Map(states.map((s) => [s.id, s]));
  const progressiveMap = computeProgressiveMap(
    states.map((s) => s.id),
    pastGames,
  );

  const withMetrics: MetricsRow[] = states.map((s) => {
    const opponentScores = s.opponents.map((oid) => byId.get(oid)?.score ?? 0);
    const buchholz = opponentScores.reduce((sum, sc) => sum + sc, 0);
    const buchholzCut1 =
      opponentScores.length >= 2
        ? buchholz - Math.min(...opponentScores)
        : buchholz;

    let sonnebornBerger = 0;
    let wins = 0;
    for (const game of pastGames) {
      const scored = pointsFromGame(s.id, game);
      if (!scored) continue;
      const oppScore = byId.get(scored.opponentId)?.score ?? 0;
      sonnebornBerger += scored.points * oppScore;
      if (scored.points === 1) wins += 1;
    }

    return {
      ...s,
      buchholz,
      buchholzCut1,
      sonnebornBerger,
      progressive: progressiveMap.get(s.id) ?? 0,
      wins,
    };
  });

  withMetrics.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    for (const key of order) {
      const cmp = compareByTiebreak(a, b, key, pastGames);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return assignRanks(withMetrics, pastGames, sharedPlaces);
}

/** Standing already carries every MetricsRow field (plus rank), so re-ranking
 * an already-sorted section is the same shared-places logic as the initial
 * ranking pass. */
export function reRankSection(
  section: Standing[],
  pastGames: PastGame[],
  sharedPlaces: boolean,
): Standing[] {
  return assignRanks(section, pastGames, sharedPlaces);
}
