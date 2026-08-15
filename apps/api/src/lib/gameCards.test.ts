import { describe, expect, it } from 'vitest';
import type { Game } from '@chess-alokas/shared';
import { MemoryStore } from '../db.js';
import {
  absenceBlockedByCards,
  cardLimitLossResult,
  issueGameCard,
  removeGameCard,
} from './gameCards.js';

const WHITE = '11111111-1111-4111-8111-111111111111';
const BLACK = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';

function pendingGame(): Game {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tournamentId: TOURNAMENT,
    categoryId: CATEGORY,
    round: 1,
    board: 1,
    whiteId: WHITE,
    blackId: BLACK,
    result: 'pending',
    isBye: false,
    updatedAt: new Date().toISOString(),
  };
}

describe('cardLimitLossResult', () => {
  it('is a played win for the opponent, not a no-show', () => {
    const game = pendingGame();
    expect(cardLimitLossResult(game, WHITE)).toBe('0-1');
    expect(cardLimitLossResult(game, BLACK)).toBe('1-0');
  });
});

describe('absenceBlockedByCards', () => {
  it('allows absence scoring when the board has no cards', () => {
    expect(absenceBlockedByCards('1-0F', [])).toBeNull();
  });

  it('blocks no-show results after the game has started', () => {
    const msg = absenceBlockedByCards('0-1F', [
      {
        id: '66666666-6666-4666-8666-666666666666',
        gameId: pendingGame().id,
        tournamentId: TOURNAMENT,
        playerId: WHITE,
        cardType: 'warning',
        actorRole: 'floor',
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(msg).toMatch(/game started/i);
  });
});

describe('issueGameCard / removeGameCard', () => {
  it('locks a played 1-0 when black hits two illegal moves', async () => {
    const store = new MemoryStore();
    const game = pendingGame();
    await store.createGame(game);

    const first = await issueGameCard(store, {
      game,
      playerId: BLACK,
      cardType: 'illegal_move',
      actorRole: 'floor',
      actorName: 'Arbiter',
      confirmedRounds: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.forfeited).toBe(false);
    expect(first.game.result).toBe('pending');

    const second = await issueGameCard(store, {
      game: first.game,
      playerId: BLACK,
      cardType: 'illegal_move',
      actorRole: 'floor',
      actorName: 'Arbiter',
      confirmedRounds: 0,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.forfeited).toBe(true);
    expect(second.game.result).toBe('1-0');
    expect(second.game.resultLockedAt).toBeTruthy();
    expect(second.forfeitReason).toMatch(/2 illegal moves/);
  });

  it('unlocks back to pending when the limit card is removed', async () => {
    const store = new MemoryStore();
    const game = pendingGame();
    await store.createGame(game);

    const first = await issueGameCard(store, {
      game,
      playerId: WHITE,
      cardType: 'illegal_move',
      actorRole: 'director',
      actorName: 'Director',
      confirmedRounds: 0,
    });
    if (!first.ok) throw new Error(first.error);
    const second = await issueGameCard(store, {
      game: first.game,
      playerId: WHITE,
      cardType: 'illegal_move',
      actorRole: 'director',
      actorName: 'Director',
      confirmedRounds: 0,
    });
    if (!second.ok) throw new Error(second.error);
    expect(second.game.result).toBe('0-1');

    const removed = await removeGameCard(store, {
      game: second.game,
      cardId: second.card.id,
      confirmedRounds: 0,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.unlocked).toBe(true);
    expect(removed.game.result).toBe('pending');
    expect(removed.game.resultLockedAt).toBeNull();
  });

  it('does not clear a director no-show when a warning is removed', async () => {
    const store = new MemoryStore();
    const game = pendingGame();
    await store.createGame(game);

    const warned = await issueGameCard(store, {
      game,
      playerId: BLACK,
      cardType: 'warning',
      actorRole: 'floor',
      actorName: 'Arbiter',
      confirmedRounds: 0,
    });
    if (!warned.ok) throw new Error(warned.error);

    const scored = await store.recordGameResult(game.id, {
      result: '1-0F',
      actorRole: 'director',
      actorName: 'Director',
      lock: true,
    });
    expect(scored?.result).toBe('1-0F');

    const removed = await removeGameCard(store, {
      game: scored!,
      cardId: warned.card.id,
      confirmedRounds: 0,
    });
    expect(removed.ok).toBe(false);
    if (removed.ok) return;
    expect(removed.status).toBe(409);
    const still = await store.getGame(game.id);
    expect(still?.result).toBe('1-0F');
  });
});
