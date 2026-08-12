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

function isCardAutoForfeit(result: string): boolean {
  return result === '1-0F' || result === '0-1F';
}

/** True when remaining cards for either side are still at/over a card limit. */
function stillAtCardLimit(
  game: Game,
  cards: GameCard[],
): boolean {
  for (const pid of [game.whiteId, game.blackId]) {
    if (!pid) continue;
    const c = countCardsForPlayer(cards, pid);
    if (c.illegalMove >= ILLEGAL_MOVE_LIMIT || c.warning >= WARNING_LIMIT) return true;
  }
  return false;
}

export type RemoveCardResult =
  | {
      ok: true;
      card: GameCard;
      game: Game;
      whiteCounts: PlayerCardCounts;
      blackCounts: PlayerCardCounts;
      unlocked: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Soft-delete a card. If the board was auto-forfeited by a card limit and counts
 * drop below the limit, clear the forfeit and unlock the result.
 */
export async function removeGameCard(
  store: Store,
  input: {
    game: Game;
    cardId: string;
    confirmedRounds: number;
  },
): Promise<RemoveCardResult> {
  const { game, cardId } = input;

  if ((input.confirmedRounds ?? 0) >= game.round) {
    return { ok: false, status: 409, error: 'This round is already confirmed closed' };
  }

  const cards = await store.listGameCards(game.id);
  const target = cards.find((c) => c.id === cardId);
  if (!target) {
    return { ok: false, status: 404, error: 'Card not found' };
  }

  const wasCardForfeit =
    Boolean(game.resultLockedAt) && isCardAutoForfeit(game.result);

  // Allow remove while pending, or while locked only if it was a card auto-forfeit.
  if (game.result !== 'pending' && !wasCardForfeit) {
    return {
      ok: false,
      status: 409,
      error: 'Cannot remove cards after the result is entered or locked',
    };
  }
  if (game.result === 'pending' && game.resultLockedAt && !wasCardForfeit) {
    return {
      ok: false,
      status: 409,
      error: 'Cannot remove cards after the result is entered or locked',
    };
  }

  const removed = await store.softDeleteGameCard(cardId);
  if (!removed) {
    return { ok: false, status: 404, error: 'Card not found' };
  }

  const remaining = await store.listGameCards(game.id);
  let updatedGame = game;
  let unlocked = false;

  if (wasCardForfeit && !stillAtCardLimit(game, remaining)) {
    const cleared = await store.updateGame(game.id, {
      result: 'pending',
      resultLockedAt: null,
      updatedAt: new Date().toISOString(),
    });
    if (cleared) {
      updatedGame = cleared;
      unlocked = true;
    }
  }

  return {
    ok: true,
    card: removed,
    game: updatedGame,
    whiteCounts: game.whiteId
      ? countCardsForPlayer(remaining, game.whiteId)
      : emptyCardCounts(),
    blackCounts: game.blackId
      ? countCardsForPlayer(remaining, game.blackId)
      : emptyCardCounts(),
    unlocked,
  };
}
