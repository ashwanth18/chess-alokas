import { describe, expect, it } from 'vitest';
import {
  pairSwissRound,
  computeStandings,
  diagnosePairings,
  createSimulation,
  runAllRounds,
  getSimulationDiagnostics,
  UnsupportedPairingStyleError,
  pairRound,
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

describe('pairSwissRound', () => {
  it('pairs even number of players without byes', () => {
    const result = pairSwissRound({
      players: players(8),
      pastGames: [],
      round: 1,
    });
    expect(result.boards.filter((b) => !b.isBye)).toHaveLength(4);
    expect(result.byePlayerId).toBeNull();
  });

  it('assigns a bye when odd number of players', () => {
    const result = pairSwissRound({
      players: players(7),
      pastGames: [],
      round: 1,
    });
    expect(result.byePlayerId).not.toBeNull();
    expect(result.boards.some((b) => b.isBye)).toBe(true);
    const paired = result.boards.filter((b) => !b.isBye);
    expect(paired).toHaveLength(3);
  });

  it('avoids rematches across rounds', () => {
    const plist = players(6);
    const r1 = pairSwissRound({ players: plist, pastGames: [], round: 1 });
    const past: PastGame[] = r1.boards.map((b) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: b.isBye ? 'bye' : '1-0',
      isBye: b.isBye,
    }));
    const r2 = pairSwissRound({ players: plist, pastGames: past, round: 2 });
    const past2: PastGame[] = [
      ...past,
      ...r2.boards.map((b) => ({
        round: 2,
        whiteId: b.whiteId,
        blackId: b.blackId,
        result: (b.isBye ? 'bye' : '1/2-1/2') as PastGame['result'],
        isBye: b.isBye,
      })),
    ];
    const diag = diagnosePairings(plist, past2);
    expect(diag.rematchCount).toBe(0);
  });

  it('updates standings after results', () => {
    const plist = players(4);
    const r1 = pairSwissRound({ players: plist, pastGames: [], round: 1 });
    const past: PastGame[] = r1.boards.map((b, i) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: b.isBye ? 'bye' : i === 0 ? '1-0' : '0-1',
      isBye: b.isBye,
    }));
    const standings = computeStandings(plist, past);
    expect(standings[0].score).toBeGreaterThanOrEqual(standings[standings.length - 1].score);
    expect(standings.every((s) => s.rank >= 1)).toBe(true);
  });

  it('does not give consecutive byes when avoidable', () => {
    const plist = players(5);
    const r1 = pairSwissRound({ players: plist, pastGames: [], round: 1 });
    const bye1 = r1.byePlayerId;
    const past: PastGame[] = r1.boards.map((b) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: b.isBye ? 'bye' : '1/2-1/2',
      isBye: b.isBye,
    }));
    const r2 = pairSwissRound({ players: plist, pastGames: past, round: 2 });
    expect(r2.byePlayerId).not.toBe(bye1);
  });
});

describe('pairRound registry', () => {
  it('supports swiss', () => {
    const out = pairRound('swiss', {
      players: players(4),
      pastGames: [],
      round: 1,
    });
    expect(out.boards.length).toBeGreaterThan(0);
  });

  it('rejects round_robin', () => {
    expect(() =>
      pairRound('round_robin', {
        players: players(4),
        pastGames: [],
        round: 1,
      }),
    ).toThrow(UnsupportedPairingStyleError);
  });
});

describe('simulator', () => {
  it('runs a full tournament without rematches', () => {
    const sim = createSimulation({
      playerCount: 12,
      rounds: 5,
      seed: 42,
      resultMode: 'rating_biased',
    });
    const done = runAllRounds(sim);
    expect(done.roundsPlayed).toHaveLength(5);
    const diag = getSimulationDiagnostics(done);
    expect(diag.rematchCount).toBe(0);
  });

  it('is reproducible with the same seed', () => {
    const a = runAllRounds(
      createSimulation({ playerCount: 8, rounds: 3, seed: 99 }),
    );
    const b = runAllRounds(
      createSimulation({ playerCount: 8, rounds: 3, seed: 99 }),
    );
    expect(a.players.map((p) => p.name)).toEqual(b.players.map((p) => p.name));
    expect(a.pastGames.map((g) => g.result)).toEqual(
      b.pastGames.map((g) => g.result),
    );
  });
});
