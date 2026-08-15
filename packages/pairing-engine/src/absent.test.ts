import { describe, expect, it } from 'vitest';
import {
  isExcludedFromRound,
  withAbsentThisRound,
  withReactivatedFrom,
  withWithdrawFrom,
} from '@chess-alokas/shared';
import {
  pairSwissRound,
  computeStandings,
  planAbsentAfterPairing,
  type EnginePlayer,
  type PastGame,
} from '../src/index.js';

function players(n: number): EnginePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    rating: 2000 - i * 50,
    seed: i + 1,
  }));
}

describe('availability helpers', () => {
  it('marks a single-round absence without withdrawing', () => {
    const p = withAbsentThisRound({ excludedRounds: [], withdrawnFromRound: null }, 3);
    expect(isExcludedFromRound(p, 2)).toBe(false);
    expect(isExcludedFromRound(p, 3)).toBe(true);
    expect(isExcludedFromRound(p, 4)).toBe(false);
  });

  it('withdraw excludes this round and every later round', () => {
    const p = withWithdrawFrom({ excludedRounds: [], withdrawnFromRound: null }, 2);
    expect(isExcludedFromRound(p, 1)).toBe(false);
    expect(isExcludedFromRound(p, 2)).toBe(true);
    expect(isExcludedFromRound(p, 5)).toBe(true);
  });

  it('reactivate clears future skip but keeps past excluded rounds', () => {
    const skipped = withAbsentThisRound({ excludedRounds: [2], withdrawnFromRound: 3 }, 4);
    const back = withReactivatedFrom(skipped, 4);
    expect(back.withdrawnFromRound).toBeNull();
    expect(isExcludedFromRound(back, 2)).toBe(true);
    expect(isExcludedFromRound(back, 4)).toBe(false);
  });
});

describe('exclude before pairing', () => {
  it('pairs the remaining five of six as two games and one bye', () => {
    const pool = players(6).filter((p) => p.id !== 'p6');
    const result = pairSwissRound({ players: pool, pastGames: [], round: 1 });
    expect(result.boards.filter((b) => !b.isBye)).toHaveLength(2);
    expect(result.boards.filter((b) => b.isBye)).toHaveLength(1);
    expect(result.byePlayerId).not.toBeNull();
    const pairedIds = result.boards.flatMap((b) => [b.whiteId, b.blackId].filter(Boolean));
    expect(pairedIds).not.toContain('p6');
  });
});

describe('unpair to bye after pairing', () => {
  it('converts only that board to an opponent bye; other boards stay', () => {
    const plist = players(6);
    const r1 = pairSwissRound({ players: plist, pastGames: [], round: 1 });
    const games = r1.boards.map((b, i) => ({
      id: `g${i}`,
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      isBye: b.isBye,
      result: b.isBye ? 'bye' : 'pending',
    }));
    const target = games.find((g) => !g.isBye)!;
    const absentId = target.whiteId!;
    const opponentId = target.blackId!;
    const others = games.filter((g) => g.id !== target.id).map((g) => ({ ...g }));

    const plan = planAbsentAfterPairing(games, 1, absentId);
    expect(plan).toEqual({
      kind: 'unpair_to_bye',
      gameId: target.id,
      opponentId,
    });
    expect(others).toHaveLength(2);
    expect(others.every((g) => g.whiteId !== absentId && g.blackId !== absentId)).toBe(true);
  });

  it('uses a forfeit on the existing board once any result is entered', () => {
    const games = [
      {
        id: 'g1',
        round: 1,
        whiteId: 'p1',
        blackId: 'p2',
        isBye: false,
        result: '1-0' as const,
      },
      {
        id: 'g2',
        round: 1,
        whiteId: 'p3',
        blackId: 'p4',
        isBye: false,
        result: 'pending' as const,
      },
    ];
    expect(planAbsentAfterPairing(games, 1, 'p3')).toEqual({
      kind: 'forfeit',
      gameId: 'g2',
      result: '0-1F',
    });
    expect(planAbsentAfterPairing(games, 1, 'p4')).toEqual({
      kind: 'forfeit',
      gameId: 'g2',
      result: '1-0F',
    });
  });

  it('removes a pairing bye when that player is marked absent before results', () => {
    const games = [
      {
        id: 'bye',
        round: 1,
        whiteId: 'p5',
        blackId: null,
        isBye: true,
        result: 'bye',
      },
    ];
    expect(planAbsentAfterPairing(games, 1, 'p5')).toEqual({
      kind: 'remove_bye',
      gameId: 'bye',
    });
  });
});

describe('late joiner score', () => {
  it('starts at 0 with no retroactive points when joining after round 1', () => {
    const original = players(4);
    const r1 = pairSwissRound({ players: original, pastGames: [], round: 1 });
    const past: PastGame[] = r1.boards.map((b) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: b.isBye ? 'bye' : '1-0',
      isBye: b.isBye,
    }));
    const late: EnginePlayer = {
      id: 'late',
      name: 'Late',
      rating: 1400,
      seed: 5,
    };
    const standings = computeStandings([...original, late], past);
    expect(standings.find((s) => s.id === 'late')?.score).toBe(0);
    const r2 = pairSwissRound({
      players: [...original, late],
      pastGames: past,
      round: 2,
    });
    const lateBoard = r2.boards.find(
      (b) => b.whiteId === 'late' || b.blackId === 'late' || (b.isBye && b.whiteId === 'late'),
    );
    expect(lateBoard).toBeDefined();
  });
});
