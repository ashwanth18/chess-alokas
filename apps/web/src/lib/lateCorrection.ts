import { computeStandings } from '@chess-alokas/pairing-engine';
import {
  isCorrectableResult,
  type GameCorrection,
  type GameResult,
  type TiebreakKey,
} from '@chess-alokas/shared';
import type { LocalGame, LocalParticipant } from '../db/local';
import {
  highestPairedRound,
  isMixedTournament,
  resolvedConfirmedRounds,
  type CategoryLike,
  type TournamentLike,
} from './tournamentProgress';

export const MAX_CORRECTION_REASON = 200;

/** The queue of corrections on one game. Stored on the row, not indexed, so Dexie's schema is unchanged. */
export type PendingCorrections = GameCorrection[] | undefined;

/**
 * A result that needs a reason to change: its round is confirmed, or a later round was paired from it.
 * Anything else is still an ordinary edit at the desk.
 */
export function canCorrectResult(
  tournament: TournamentLike,
  game: Pick<LocalGame, 'round' | 'result' | 'isBye' | 'deletedAt'>,
  games: LocalGame[] | null | undefined,
): boolean {
  if (game.deletedAt || game.isBye || !isCorrectableResult(game.result)) return false;
  return game.round <= resolvedConfirmedRounds(tournament) || game.round < highestPairedRound(games);
}

/** Rounds on the boards that were paired after this one, in order. */
export function laterPairedRounds(games: LocalGame[] | null | undefined, round: number): number[] {
  const rounds = new Set<number>();
  for (const g of games ?? []) if (!g.deletedAt && g.round > round) rounds.add(g.round);
  return [...rounds].sort((a, b) => a - b);
}

export function oldScoreWarning(rounds: number[]): string | null {
  if (rounds.length === 0) return null;
  if (rounds.length === 1) return `Round ${rounds[0]} was paired using the old score.`;
  return `Rounds ${rounds[0]} to ${rounds.at(-1)} were paired using the old score.`;
}

/**
 * The round that may be undone and paired again after correcting `round`, or null. Only the newest,
 * and only with no result in it. The server checks again, and also refuses a round with cards.
 */
export function roundToOfferUndo(
  tournament: TournamentLike,
  games: LocalGame[] | null | undefined,
  round: number,
): number | null {
  const newest = highestPairedRound(games);
  if (newest <= round || newest <= resolvedConfirmedRounds(tournament)) return null;
  const played = (games ?? []).some(
    (g) =>
      !g.deletedAt &&
      g.round === newest &&
      !g.isBye &&
      (g.result !== 'pending' || Boolean(g.resultLockedAt)),
  );
  return played ? null : newest;
}

/** The fields to write on a game when correcting it. Corrections made in a row queue up in order. */
export function correctedGameFields(
  game: Pick<LocalGame, 'result' | 'resultOverrideCount' | 'pendingCorrections'>,
  input: { id: string; result: GameResult; reason: string; actorName: string; at: string },
): Pick<
  LocalGame,
  | 'result'
  | 'resultEnteredByName'
  | 'resultEnteredByRole'
  | 'resultOverrideCount'
  | 'pendingCorrections'
  | 'updatedAt'
  | 'dirty'
> {
  const correction: GameCorrection = {
    id: input.id,
    previousResult: game.result as GameResult,
    result: input.result,
    reason: input.reason.trim(),
    actorName: input.actorName,
    at: input.at,
  };
  return {
    result: input.result,
    resultEnteredByName: input.actorName,
    resultEnteredByRole: 'director',
    resultOverrideCount: (game.resultOverrideCount ?? 0) + 1,
    pendingCorrections: [...(game.pendingCorrections ?? []), correction],
    updatedAt: input.at,
    dirty: 1,
  };
}

/** What a pushed game row sends for its queue. */
export function syncPayloadForGame<T extends { pendingCorrections?: PendingCorrections }>(
  record: T,
): Omit<T, 'pendingCorrections'> & { corrections?: GameCorrection[] } {
  const { pendingCorrections, ...rest } = record;
  return pendingCorrections?.length ? { ...rest, corrections: pendingCorrections } : rest;
}

/** The corrections still to send once `pushed` were accepted. One made during the push stays queued. */
export function correctionsLeftAfterPush(
  queue: PendingCorrections,
  pushed: PendingCorrections,
): PendingCorrections {
  const sent = new Set((pushed ?? []).map((c) => c.id));
  const left = (queue ?? []).filter((c) => !sent.has(c.id));
  return left.length > 0 ? left : undefined;
}

/**
 * Who stands where, in a form that can be compared: per pool, each player's rank and score. Two equal
 * strings mean nothing on a certificate could have changed.
 */
export function standingsFingerprint(
  tournament: TournamentLike & {
    tiebreakOrder?: readonly string[] | null;
    sharedPlaces?: boolean;
  },
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): string {
  const options = {
    tiebreakOrder: (tournament.tiebreakOrder as TiebreakKey[] | null | undefined) ?? null,
    sharedPlaces: tournament.sharedPlaces ?? true,
  };
  const players = (participants ?? [])
    .filter((p) => !p.deletedAt)
    .map((p) => ({ id: p.id, name: p.name, rating: p.rating ?? undefined, seed: p.seed }));
  const played = (games ?? []).filter((g) => !g.deletedAt && g.result !== 'pending');
  const toPast = (list: LocalGame[]) =>
    list.map((g) => ({
      round: g.round,
      whiteId: g.whiteId ?? null,
      blackId: g.blackId ?? null,
      result: g.result as GameResult,
      isBye: g.isBye,
    }));
  const line = (pool: typeof players, poolGames: LocalGame[]) =>
    computeStandings(pool, toPast(poolGames), options)
      .map((s) => [s.id, s.rank, s.score])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));

  const categoriesInUse = (categories ?? []).filter((c) => !c.deletedAt);
  if (isMixedTournament(tournament) || categoriesInUse.length === 0) {
    return JSON.stringify(line(players, played));
  }
  return JSON.stringify(
    categoriesInUse.map((c) => [
      c.id,
      line(
        players.filter((p) =>
          (participants ?? []).some((full) => full.id === p.id && full.categoryIds?.includes(c.id)),
        ),
        played.filter((g) => g.categoryId === c.id),
      ),
    ]),
  );
}

/** Dexie meta key: this tournament's standings changed, and certificates haven't been checked yet. */
export function certificateCheckKey(tournamentId: string): string {
  return `certificateCheck:${tournamentId}`;
}

export function certificatesNotice(issued: number): string | null {
  if (issued <= 0) return null;
  return issued === 1
    ? 'Standings changed. 1 certificate was issued before this.'
    : `Standings changed. ${issued} certificates were issued before this.`;
}

/** Dexie meta key: corrections the server refused here, kept until the director dismisses them. */
export function correctionConflictKey(tournamentId: string): string {
  return `correctionConflict:${tournamentId}`;
}

/**
 * Adds a refusal to the stored list. A sync that comes back clean clears the general "not saved"
 * banner within seconds, and this one matters too much to be gone before anyone looks up.
 */
export function withConflictMessage(stored: string | undefined, message: string): string {
  const list = conflictMessages(stored);
  return JSON.stringify(list.includes(message) ? list : [...list, message]);
}

export function conflictMessages(stored: string | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** Rejection codes that mean the server's copy stands: the row is replaced from the next pull. */
export function isSupersededRejection(code: string): boolean {
  return code === 'correction_conflict' || code === 'game_removed';
}
