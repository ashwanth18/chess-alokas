import {
  ILLEGAL_MOVE_LIMIT,
  WARNING_LIMIT,
  cardLimit,
  countCardsForPlayer,
  emptyCardCounts,
  type Game,
  type GameCard,
  type GameCardType,
  type PlayerCardCounts,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';

export type IssueCardInput = {
  game: Game;
  playerId: string;
  cardType: GameCardType;
  note?: string | null;
  actorRole: 'floor' | 'director';
  actorName?: string | null;
  actorUserId?: string | null;
  /** Confirmed rounds on the tournament — cards blocked when round already confirmed. */
  confirmedRounds: number;
};

export type IssueCardResult =
  | {
      ok: true;
      card: GameCard;
      game: Game;
      whiteCounts: PlayerCardCounts;
      blackCounts: PlayerCardCounts;
      forfeited: boolean;
      forfeitReason: string | null;
    }
  | { ok: false; status: number; error: string };

export function forfeitResultForOffender(
  game: Game,
  offenderId: string,
): '1-0F' | '0-1F' | null {
  if (game.whiteId === offenderId) return '0-1F';
  if (game.blackId === offenderId) return '1-0F';
  return null;
}

export function forfeitReasonForCard(cardType: GameCardType, count: number): string {
  if (cardType === 'illegal_move') {
    return `${count} illegal move${count === 1 ? '' : 's'} (limit ${ILLEGAL_MOVE_LIMIT})`;
  }
  return `${count} warning${count === 1 ? '' : 's'} (limit ${WARNING_LIMIT})`;
}

export async function issueGameCard(
  store: Store,
  input: IssueCardInput,
): Promise<IssueCardResult> {
  const { game, playerId, cardType } = input;

  if (game.isBye || game.result === 'bye') {
    return { ok: false, status: 409, error: 'Bye boards cannot receive cards' };
  }
  if ((input.confirmedRounds ?? 0) >= game.round) {
    return { ok: false, status: 409, error: 'This round is already confirmed closed' };
  }
  if (game.resultLockedAt || game.result !== 'pending') {
    return { ok: false, status: 409, error: 'Result already locked for this board' };
  }
  if (playerId !== game.whiteId && playerId !== game.blackId) {
    return { ok: false, status: 400, error: 'Player is not on this board' };
  }

  const existing = await store.listGameCards(game.id);
  const before = countCardsForPlayer(existing, playerId);
  const beforeCount =
    cardType === 'illegal_move' ? before.illegalMove : before.warning;
  if (beforeCount >= cardLimit(cardType)) {
    return { ok: false, status: 409, error: 'Card limit already reached for this player' };
  }

  const now = new Date().toISOString();
  const card = await store.createGameCard({
    id: crypto.randomUUID(),
    gameId: game.id,
    tournamentId: game.tournamentId,
    playerId,
    cardType,
    note: input.note?.trim() || null,
    actorRole: input.actorRole,
    actorName: input.actorName?.trim() || null,
    actorUserId: input.actorUserId ?? null,
    createdAt: now,
  });

  const all = [...existing, card];
  const whiteCounts = game.whiteId
    ? countCardsForPlayer(all, game.whiteId)
    : emptyCardCounts();
  const blackCounts = game.blackId
    ? countCardsForPlayer(all, game.blackId)
    : emptyCardCounts();
  const after = countCardsForPlayer(all, playerId);
  const afterCount = cardType === 'illegal_move' ? after.illegalMove : after.warning;
  const limit = cardLimit(cardType);

  let updatedGame = game;
  let forfeited = false;
  let forfeitReason: string | null = null;

  if (afterCount >= limit) {
    const forfeit = forfeitResultForOffender(game, playerId);
    if (!forfeit) {
      return { ok: false, status: 500, error: 'Could not determine forfeit side' };
    }
    forfeitReason = forfeitReasonForCard(cardType, afterCount);
    const note = [forfeitReason, input.note?.trim()].filter(Boolean).join(' — ');
    const saved = await store.recordGameResult(game.id, {
      result: forfeit,
      actorRole: input.actorRole,
      actorName: input.actorName,
      actorUserId: input.actorUserId,
      note,
      lock: true,
    });
    if (!saved) {
      return { ok: false, status: 500, error: 'Failed to apply forfeit' };
    }
    updatedGame = saved;
    forfeited = true;
  }

  return {
    ok: true,
    card,
    game: updatedGame,
    whiteCounts,
    blackCounts,
    forfeited,
    forfeitReason,
  };
}

export async function countsForGame(store: Store, game: Game): Promise<{
  whiteCounts: PlayerCardCounts;
  blackCounts: PlayerCardCounts;
  cards: GameCard[];
}> {
  const cards = await store.listGameCards(game.id);
  return {
    cards,
    whiteCounts: game.whiteId
      ? countCardsForPlayer(cards, game.whiteId)
      : emptyCardCounts(),
    blackCounts: game.blackId
      ? countCardsForPlayer(cards, game.blackId)
      : emptyCardCounts(),
  };
}
