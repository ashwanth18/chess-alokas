import type { GameResult } from '@chess-alokas/shared';
import { computeSectionStandings, computeStandings } from '@chess-alokas/pairing-engine';
import type { PublicLivePayload } from '../api/client';

export type LivePlayer = PublicLivePayload['players'][number];
export type LiveGame = PublicLivePayload['games'][number];

function pointsForPlayer(game: LiveGame, playerId: string): number {
  if (game.isBye || game.result === 'bye') {
    if (game.whiteId === playerId || game.blackId === playerId) return 1;
    return 0;
  }
  if (game.result === 'pending') return 0;
  const isWhite = game.whiteId === playerId;
  const isBlack = game.blackId === playerId;
  if (!isWhite && !isBlack) return 0;
  switch (game.result) {
    case '1-0':
    case '1-0F':
      return isWhite ? 1 : 0;
    case '0-1':
    case '0-1F':
      return isBlack ? 1 : 0;
    case '1/2-1/2':
      return 0.5;
    case '0-0':
      return 0;
    default:
      return 0;
  }
}

/** Running score after all finished games up to and including `throughRound`. */
export function runningScore(
  games: LiveGame[],
  playerId: string,
  throughRound: number,
): number {
  let score = 0;
  for (const g of games) {
    if (g.round > throughRound) continue;
    if (g.result === 'pending') continue;
    score += pointsForPlayer(g, playerId);
  }
  return score;
}

export function gameForPlayerRound(
  games: LiveGame[],
  playerId: string,
  round: number,
): LiveGame | null {
  return (
    games.find(
      (g) =>
        g.round === round && (g.whiteId === playerId || g.blackId === playerId),
    ) ?? null
  );
}

export function formatResultLabel(result: string, isBye: boolean): string {
  if (isBye || result === 'bye') return 'Bye';
  if (result === 'pending') return 'Pending';
  return result;
}

export function resultPointsLabel(points: number): string {
  if (points === 0.5) return '½';
  if (Number.isInteger(points)) return String(points);
  return String(points);
}

export type PlayerRoundHistory = {
  round: number;
  board: number | null;
  color: 'white' | 'black' | null;
  opponentId: string | null;
  opponentName: string;
  result: string;
  isBye: boolean;
  pointsEarned: number;
  scoreAfter: number;
};

export function buildPlayerHistory(
  games: LiveGame[],
  players: LivePlayer[],
  playerId: string,
): PlayerRoundHistory[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rounds = [...new Set(games.map((g) => g.round))].sort((a, b) => a - b);
  const rows: PlayerRoundHistory[] = [];
  for (const round of rounds) {
    const game = gameForPlayerRound(games, playerId, round);
    if (!game) continue;
    const isWhite = game.whiteId === playerId;
    const opponentId = isWhite ? game.blackId : game.whiteId;
    const finished = game.result !== 'pending';
    rows.push({
      round,
      board: game.isBye ? null : game.board,
      color: game.isBye ? null : isWhite ? 'white' : 'black',
      opponentId,
      opponentName: opponentId ? (byId.get(opponentId)?.name ?? '—') : '—',
      result: game.result,
      isBye: game.isBye || game.result === 'bye',
      pointsEarned: finished ? pointsForPlayer(game, playerId) : 0,
      scoreAfter: runningScore(games, playerId, round),
    });
  }
  return rows;
}

export function computeLiveStandings(
  payload: PublicLivePayload,
  categoryId: string | null,
) {
  const { tournament, players, games } = payload;
  const mix = tournament.mixCategories;
  const toPast = (list: LiveGame[]) =>
    list
      .filter((g) => g.result !== 'pending')
      .map((g) => ({
        round: g.round,
        whiteId: g.whiteId,
        blackId: g.blackId,
        result: g.result as GameResult,
        isBye: g.isBye,
      }));
  const toEngine = (list: LivePlayer[]) =>
    list.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating ?? undefined,
      seed: p.seed ?? 0,
    }));

  if (mix && categoryId) {
    const sectionIds = new Set(
      players.filter((p) => p.categoryIds.includes(categoryId)).map((p) => p.id),
    );
    return computeSectionStandings(toEngine(players), toPast(games), sectionIds);
  }

  const catGames = categoryId ? games.filter((g) => g.categoryId === categoryId) : games;
  const catPlayers = categoryId
    ? players.filter((p) => p.categoryIds.includes(categoryId))
    : players;
  if (catPlayers.length === 0) return [];
  return computeStandings(toEngine(catPlayers), toPast(catGames));
}

export function livePublicUrl(token: string): string {
  const configured = import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined;
  if (configured) return `${configured.replace(/\/$/, '')}/live/${token}`;
  if (typeof window !== 'undefined' && !window.desktop?.isDesktop) {
    return `${window.location.origin}/live/${token}`;
  }
  return `https://chess-manager.alokas.com/live/${token}`;
}
