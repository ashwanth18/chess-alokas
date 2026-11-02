import type { Game, GameCard, Tournament } from '@chess-alokas/shared';

export interface RoundUndoInput {
  actorUserId?: string | null;
  actorName?: string | null;
  /** Why the round is being undone. Goes in the log with the round number. */
  reason?: string | null;
}

export interface RoundUndoOutcome {
  tournament: Tournament;
  removedGameIds: string[];
}

function refused(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 409 });
}

/**
 * Whether a round can be undone: only the newest one, and only if nothing has happened in it. A
 * result or a card means play has started, and a game in progress is never changed silently.
 * Throws a 409 with a message for the director, and returns that round's games otherwise.
 *
 * `games` must hold every live game from `round` upward, so a later round is noticed.
 */
export function roundGamesToUndo(
  tournament: Tournament,
  games: Game[],
  cards: Pick<GameCard, 'gameId'>[],
  round: number,
): Game[] {
  if (round < 2) throw refused('Only a round after Round 1 can be undone.');
  if ((tournament.confirmedRounds ?? 0) >= round) throw refused(`Round ${round} is confirmed.`);
  const later = games.reduce((max, g) => Math.max(max, g.round), 0);
  if (later > round) throw refused(`Only the newest round can be undone. Round ${later} is paired.`);

  const roundGames = games.filter((g) => g.round === round);
  if (roundGames.length === 0) throw refused(`Round ${round} is not paired.`);
  const played = roundGames.filter(
    (g) => !g.isBye && (g.result !== 'pending' || Boolean(g.resultLockedAt)),
  );
  if (played.length > 0) throw refused(`Round ${round} has results, so it can't be undone.`);
  const ids = new Set(roundGames.map((g) => g.id));
  if (cards.some((c) => ids.has(c.gameId))) {
    throw refused(`Round ${round} has cards, so it can't be undone.`);
  }
  return roundGames;
}

/** The note on each game's log row when its round is undone. */
export function roundUndoNote(round: number, reason?: string | null): string {
  const why = reason?.trim();
  return why ? `Round ${round} undone: ${why}` : `Round ${round} undone`;
}
