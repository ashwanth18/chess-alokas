import type { GameResult } from '@chess-alokas/shared';

export type RoundGameLike = {
  id: string;
  round: number;
  whiteId?: string | null;
  blackId?: string | null;
  isBye: boolean;
  result: string;
  resultLockedAt?: string | null;
  deletedAt?: string | null;
};

export type AbsentAfterPairingPlan =
  | { kind: 'unpair_to_bye'; gameId: string; opponentId: string }
  | { kind: 'remove_bye'; gameId: string }
  | { kind: 'forfeit'; gameId: string; result: Extract<GameResult, '1-0F' | '0-1F' | '0-0'> }
  | { kind: 'already_unpaired' }
  | { kind: 'blocked'; reason: string };

function isActiveRoundGame(game: RoundGameLike, round: number): boolean {
  return !game.deletedAt && game.round === round;
}

/** True when any non-bye board in the round has a result or a floor lock. */
export function roundHasPlayStarted(
  games: RoundGameLike[],
  round: number,
): boolean {
  return games.some((g) => {
    if (!isActiveRoundGame(g, round)) return false;
    if (g.resultLockedAt) return true;
    if (g.isBye) return false;
    return g.result !== 'pending';
  });
}

export function findPlayerGameForRound(
  games: RoundGameLike[],
  round: number,
  playerId: string,
): RoundGameLike | undefined {
  return games.find(
    (g) =>
      isActiveRoundGame(g, round) &&
      (g.whiteId === playerId || g.blackId === playerId),
  );
}

/**
 * After Round N is generated: unpair that one board to an opponent bye if
 * nothing has been scored yet; otherwise score a forfeit on the existing board.
 */
export function planAbsentAfterPairing(
  games: RoundGameLike[],
  round: number,
  playerId: string,
): AbsentAfterPairingPlan {
  const game = findPlayerGameForRound(games, round, playerId);
  if (!game) return { kind: 'already_unpaired' };

  const playStarted = roundHasPlayStarted(games, round);
  const thisLocked = Boolean(game.resultLockedAt);
  const thisEntered = !game.isBye && game.result !== 'pending';

  if (playStarted || thisLocked || thisEntered) {
    if (game.isBye) {
      return {
        kind: 'blocked',
        reason: 'This round already has results. The pairing bye stands.',
      };
    }
    if (game.result === '1-0F' && game.whiteId === playerId) {
      return { kind: 'forfeit', gameId: game.id, result: '0-0' };
    }
    if (game.result === '0-1F' && game.blackId === playerId) {
      return { kind: 'forfeit', gameId: game.id, result: '0-0' };
    }
    if (game.whiteId === playerId) {
      return { kind: 'forfeit', gameId: game.id, result: '0-1F' };
    }
    return { kind: 'forfeit', gameId: game.id, result: '1-0F' };
  }

  if (game.isBye) {
    return { kind: 'remove_bye', gameId: game.id };
  }

  const opponentId = game.whiteId === playerId ? game.blackId : game.whiteId;
  if (!opponentId) {
    return { kind: 'remove_bye', gameId: game.id };
  }
  return { kind: 'unpair_to_bye', gameId: game.id, opponentId };
}
