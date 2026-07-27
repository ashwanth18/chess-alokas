import { describe, expect, it } from 'vitest';
import {
  pairSwissRound,
  computeStandings,
  computeSectionStandings,
  diagnosePairings,
  firstRoundMissingResults,
  createSimulation,
  runAllRounds,
  getSimulationDiagnostics,
  getSimulationStandings,
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

  it('re-ranks within a section after mixed-field standings', () => {
    const plist = players(4);
    const past: PastGame[] = [
      {
        round: 1,
        whiteId: 'p1',
        blackId: 'p2',
        result: '1-0',
        isBye: false,
      },
      {
        round: 1,
        whiteId: 'p3',
        blackId: 'p4',
        result: '1-0',
        isBye: false,
      },
    ];
    const section = computeSectionStandings(plist, past, new Set(['p2', 'p4']));
    expect(section).toHaveLength(2);
    expect(section.map((s) => s.id)).toEqual(['p2', 'p4']);
    expect(section[0]!.rank).toBe(1);
    expect(section[1]!.rank).toBe(2);
    // Buchholz still reflects the full-field opponent (p1 / p3 scored 1).
    expect(section[0]!.buchholz).toBe(1);
    expect(section[1]!.buchholz).toBe(1);
  });

  it('scores forfeit and double-absent results', () => {
    const plist = players(4);
    const [a, b, c, d] = plist;
    const past: PastGame[] = [
      {
        round: 1,
        whiteId: a!.id,
        blackId: b!.id,
        result: '1-0F',
        isBye: false,
      },
      {
        round: 1,
        whiteId: c!.id,
        blackId: d!.id,
        result: '0-0',
        isBye: false,
      },
    ];
    const standings = computeStandings(plist, past);
    const byId = Object.fromEntries(standings.map((s) => [s.id, s.score]));
    expect(byId[a!.id]).toBe(1);
    expect(byId[b!.id]).toBe(0);
    expect(byId[c!.id]).toBe(0);
    expect(byId[d!.id]).toBe(0);
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

describe('firstRoundMissingResults', () => {
  it('returns round with pending results before pairing next round', () => {
    const plist = players(4);
    const r1 = pairSwissRound({ players: plist, pastGames: [], round: 1 });
    const pending: PastGame[] = r1.boards.map((b) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: 'pending',
      isBye: b.isBye,
    }));
    expect(firstRoundMissingResults(pending, 2)).toBe(1);
    expect(firstRoundMissingResults(pending, 1)).toBeNull();
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

  it('pairs U12 and U18 separately when split and not mixed', () => {
    const done = runAllRounds(
      createSimulation({
        playerCount: 12,
        rounds: 3,
        seed: 7,
        splitCategories: true,
        mixCategories: false,
      }),
    );
    for (const game of done.pastGames) {
      if (game.isBye) continue;
      const white = done.players.find((p) => p.id === game.whiteId);
      const black = done.players.find((p) => p.id === game.blackId);
      expect(white?.category).toBe(black?.category);
    }
    const u12 = getSimulationStandings(done, 'under12');
    const u18 = getSimulationStandings(done, 'under18');
    expect(u12.every((s) => s.category === 'under12')).toBe(true);
    expect(u18.every((s) => s.category === 'under18')).toBe(true);
  });

  it('allows cross-category games when mixCategories is true', () => {
    const done = runAllRounds(
      createSimulation({
        playerCount: 12,
        rounds: 3,
        seed: 11,
        splitCategories: true,
        mixCategories: true,
      }),
    );
    const cross = done.pastGames.some((g) => {
      if (g.isBye || !g.whiteId || !g.blackId) return false;
      const white = done.players.find((p) => p.id === g.whiteId);
      const black = done.players.find((p) => p.id === g.blackId);
      return white && black && white.category !== black.category;
    });
    expect(cross).toBe(true);
  });
});
