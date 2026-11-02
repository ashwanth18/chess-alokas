import { describe, expect, it } from 'vitest';
import type { GameCorrection } from '@chess-alokas/shared';
import { db, type LocalGame, type LocalParticipant } from '../db/local';
import {
  canCorrectResult,
  certificatesNotice,
  conflictMessages,
  correctedGameFields,
  correctionsLeftAfterPush,
  isSupersededRejection,
  laterPairedRounds,
  oldScoreWarning,
  roundToOfferUndo,
  standingsFingerprint,
  syncPayloadForGame,
  withConflictMessage,
} from './lateCorrection';
import { canEditRoundResults, type TournamentLike } from './tournamentProgress';

function game(extra: Partial<LocalGame> = {}): LocalGame {
  return {
    id: crypto.randomUUID(),
    tournamentId: 't',
    categoryId: 'c',
    round: 1,
    board: 1,
    whiteId: 'w',
    blackId: 'b',
    result: '1-0',
    isBye: false,
    updatedAt: '2026-11-02T00:00:00.000Z',
    dirty: 0,
    ...extra,
  };
}

const tournament = (extra: Partial<TournamentLike> = {}): TournamentLike => ({
  rounds: 5,
  status: 'in_progress',
  currentRound: 4,
  confirmedRounds: 3,
  ...extra,
});

const roundOf = (round: number, result = '1-0') => game({ round, result });

describe('which results take a correction', () => {
  const games = [roundOf(1), roundOf(3), roundOf(4, 'pending')];

  it('offers it on a confirmed round', () => {
    expect(canCorrectResult(tournament(), roundOf(3), games)).toBe(true);
  });
  it('offers it on a round before one already paired, even if never confirmed', () => {
    const t = tournament({ confirmedRounds: 0 });
    expect(canCorrectResult(t, roundOf(3), games)).toBe(true);
  });
  it('on a completed tournament', () => {
    const t = tournament({ status: 'completed', confirmedRounds: 5, currentRound: 5 });
    expect(canCorrectResult(t, roundOf(5), [roundOf(5)])).toBe(true);
  });
  it('leaves the round being played as an ordinary edit', () => {
    const entered = roundOf(4, '0-1');
    expect(canCorrectResult(tournament(), entered, [...games, entered])).toBe(false);
    expect(canEditRoundResults(tournament(), 4)).toBe(true);
  });
  it('never on a bye, a game with no result, or a removed game', () => {
    expect(canCorrectResult(tournament(), game({ round: 3, isBye: true, result: 'bye' }), games)).toBe(false);
    expect(canCorrectResult(tournament(), game({ round: 3, result: 'pending' }), games)).toBe(false);
    expect(canCorrectResult(tournament(), game({ round: 3, deletedAt: 'x' }), games)).toBe(false);
  });
});

describe('the warning about later rounds', () => {
  it('says it plainly for one round', () => {
    expect(oldScoreWarning([4])).toBe('Round 4 was paired using the old score.');
  });
  it('says it for several', () => {
    expect(oldScoreWarning([3, 4, 5])).toBe('Rounds 3 to 5 were paired using the old score.');
  });
  it('says nothing with no later round', () => {
    expect(oldScoreWarning([])).toBeNull();
  });
  it('counts only rounds still on the boards', () => {
    const games = [roundOf(3), roundOf(4, 'pending'), game({ round: 5, deletedAt: 'x' })];
    expect(laterPairedRounds(games, 3)).toEqual([4]);
    expect(laterPairedRounds(games, 4)).toEqual([]);
  });
});

describe('when undoing and pairing again is offered', () => {
  it('for the newest round with nothing in it', () => {
    expect(roundToOfferUndo(tournament(), [roundOf(3), roundOf(4, 'pending')], 3)).toBe(4);
  });
  it('a bye does not count as a result', () => {
    const bye = game({ round: 4, isBye: true, result: 'bye', blackId: null });
    expect(roundToOfferUndo(tournament(), [roundOf(3), roundOf(4, 'pending'), bye], 3)).toBe(4);
  });
  it('not once any result is in', () => {
    expect(roundToOfferUndo(tournament(), [roundOf(3), roundOf(4, 'pending'), roundOf(4, '1-0')], 3)).toBeNull();
  });
  it('not on a floor-locked game, whatever it shows', () => {
    const locked = game({ round: 4, result: 'pending', resultLockedAt: 'x' });
    expect(roundToOfferUndo(tournament(), [roundOf(3), locked], 3)).toBeNull();
  });
  it('never for a round in the past: only the newest', () => {
    const games = [roundOf(2), roundOf(3), roundOf(4), roundOf(5, 'pending')];
    const t = tournament({ confirmedRounds: 4, currentRound: 5 });
    expect(roundToOfferUndo(t, games, 2)).toBe(5);
    const noneFree = [roundOf(2), roundOf(3), roundOf(4)];
    expect(roundToOfferUndo(tournament({ confirmedRounds: 4 }), noneFree, 2)).toBeNull();
  });
  it('not with no later round, and not when the newest is confirmed', () => {
    expect(roundToOfferUndo(tournament(), [roundOf(3)], 3)).toBeNull();
    const confirmed = tournament({ confirmedRounds: 4 });
    expect(roundToOfferUndo(confirmed, [roundOf(3), roundOf(4, 'pending')], 3)).toBeNull();
  });
});

describe('queueing a correction', () => {
  const at = '2026-11-02T10:00:00.000Z';
  const input = { id: 'c1', result: '0-1' as const, reason: '  Wrong side  ', actorName: 'Dee', at };

  it('changes the result here, marks the row to sync, and queues the change', () => {
    const fields = correctedGameFields(game({ resultOverrideCount: 1 }), input);
    expect(fields).toMatchObject({
      result: '0-1',
      resultEnteredByRole: 'director',
      resultEnteredByName: 'Dee',
      resultOverrideCount: 2,
      updatedAt: at,
      dirty: 1,
    });
    expect(fields.pendingCorrections).toEqual([
      { id: 'c1', previousResult: '1-0', result: '0-1', reason: 'Wrong side', actorName: 'Dee', at },
    ]);
  });

  it('a second one before the first is sent chains on, losing neither', () => {
    const first = correctedGameFields(game(), input);
    const second = correctedGameFields(
      { ...game(), ...first },
      { ...input, id: 'c2', result: '1/2-1/2', reason: 'Second look' },
    );
    expect(second.pendingCorrections?.map((c) => [c.previousResult, c.result, c.reason])).toEqual([
      ['1-0', '0-1', 'Wrong side'],
      ['0-1', '1/2-1/2', 'Second look'],
    ]);
  });

  it('goes up under the name the server reads, and an ordinary row is left alone', () => {
    const queue = correctedGameFields(game(), input).pendingCorrections!;
    const sent = syncPayloadForGame({ id: 'g', result: '0-1', pendingCorrections: queue });
    expect(sent).toEqual({ id: 'g', result: '0-1', corrections: queue });
    expect(syncPayloadForGame({ id: 'g', result: '0-1', pendingCorrections: undefined })).toEqual({
      id: 'g',
      result: '0-1',
    });
    expect(syncPayloadForGame({ id: 'g', pendingCorrections: [] })).toEqual({ id: 'g' });
  });

  const queued = (id: string): GameCorrection => ({
    id,
    previousResult: '1-0',
    result: '0-1',
    reason: 'x',
    at,
  });

  it('clears what was accepted', () => {
    expect(correctionsLeftAfterPush([queued('a')], [queued('a')])).toBeUndefined();
  });
  it('keeps one made while the push was on its way', () => {
    expect(correctionsLeftAfterPush([queued('a'), queued('b')], [queued('a')])?.map((c) => c.id)).toEqual(['b']);
  });
  it('has nothing to do for a row without a queue', () => {
    expect(correctionsLeftAfterPush(undefined, undefined)).toBeUndefined();
  });

  it('needs no change to the local database', () => {
    expect(db.verno * 10).toBeLessThanOrEqual(90);
    const indexes = db.table('games').schema.indexes.map((i) => i.name);
    expect(indexes.sort()).toEqual(['categoryId', 'dirty', 'round', 'tournamentId']);
    expect(db.name).toBe('chess-alokas');
  });
});

describe('telling the director about certificates', () => {
  const players: LocalParticipant[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    tournamentId: 't',
    name: id.toUpperCase(),
    age: 10,
    seed: i + 1,
    customFields: {},
    categoryIds: ['c1'],
    updatedAt: '',
    dirty: 0,
  }));
  const pair = (whiteId: string, blackId: string, result: string, categoryId = 'c1') =>
    game({ whiteId, blackId, result, categoryId });
  const t = { ...tournament(), mixCategories: true };

  it('standings that really move change the fingerprint', () => {
    const before = standingsFingerprint(t, [], players, [pair('a', 'b', '1-0'), pair('c', 'd', '1-0')]);
    const after = standingsFingerprint(t, [], players, [pair('a', 'b', '0-1'), pair('c', 'd', '1-0')]);
    expect(after).not.toBe(before);
  });
  it('the same results give the same fingerprint', () => {
    const games = [pair('a', 'b', '1-0')];
    expect(standingsFingerprint(t, [], players, games)).toBe(standingsFingerprint(t, [], players, [...games]));
  });
  it('compares each category on its own', () => {
    const separate = { ...tournament(), mixCategories: false };
    const categories = [{ id: 'c1' }];
    const before = standingsFingerprint(separate, categories, players, [pair('a', 'b', '1-0')]);
    const after = standingsFingerprint(separate, categories, players, [pair('a', 'b', '0-1')]);
    expect(after).not.toBe(before);
  });
  it('ignores removed games', () => {
    const before = standingsFingerprint(t, [], players, [pair('a', 'b', '1-0')]);
    const removed = { ...pair('c', 'd', '1-0'), deletedAt: 'x' };
    expect(standingsFingerprint(t, [], players, [pair('a', 'b', '1-0'), removed])).toBe(before);
  });
  it('says nothing when none were issued', () => {
    expect(certificatesNotice(0)).toBeNull();
    expect(certificatesNotice(1)).toBe('Standings changed. 1 certificate was issued before this.');
    expect(certificatesNotice(12)).toBe('Standings changed. 12 certificates were issued before this.');
  });
});

describe('when the server\'s copy stands', () => {
  it('a lost correction or a removed game is replaced from the pull', () => {
    expect(isSupersededRejection('correction_conflict')).toBe(true);
    expect(isSupersededRejection('game_removed')).toBe(true);
  });
  it('the refusal is kept until dismissed, once each', () => {
    const one = withConflictMessage(undefined, 'Round 2, table 2 is now 0-1.');
    const two = withConflictMessage(one, 'Round 3, table 1 is now 1-0.');
    expect(conflictMessages(withConflictMessage(two, 'Round 2, table 2 is now 0-1.'))).toEqual([
      'Round 2, table 2 is now 0-1.',
      'Round 3, table 1 is now 1-0.',
    ]);
    expect(conflictMessages(undefined)).toEqual([]);
    expect(conflictMessages('not json')).toEqual([]);
  });
  it('a refusal the director can fix stays queued', () => {
    expect(isSupersededRejection('forbidden')).toBe(false);
    expect(isSupersededRejection('invalid')).toBe(false);
    expect(isSupersededRejection('round_confirmed')).toBe(false);
  });
});
