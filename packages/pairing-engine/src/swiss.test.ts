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
  assignStartRanks,
  sortRoster,
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

describe('roster order', () => {
  it('puts rated players before unrated, then A–Z among unrated', () => {
    const list = sortRoster([
      { id: 'u2', name: 'Zoe', rating: null },
      { id: 'r1', name: 'Ada', rating: 1500 },
      { id: 'u1', name: 'Amy', rating: 0 },
      { id: 'r2', name: 'Bob', rating: 1800 },
    ]);
    expect(list.map((p) => p.id)).toEqual(['r2', 'r1', 'u1', 'u2']);
    const ranks = assignStartRanks(list);
    expect(ranks.get('r2')).toBe(1);
    expect(ranks.get('u2')).toBe(4);
  });
});

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

  it('uses classic Dutch fold in round 1 (1–5, 2–6, 3–7, 4–8)', () => {
    const plist = players(8);
    const result = pairSwissRound({
      players: plist,
      pastGames: [],
      round: 1,
    });
    const byId = new Map(plist.map((p) => [p.id, p]));
    const pairs = result.boards
      .filter((b) => !b.isBye)
      .map((b) => {
        const a = byId.get(b.whiteId!)!.seed!;
        const bSeed = byId.get(b.blackId!)!.seed!;
        return [Math.min(a, bSeed), Math.max(a, bSeed)] as const;
      })
      .sort((x, y) => x[0] - y[0]);
    expect(pairs).toEqual([
      [1, 5],
      [2, 6],
      [3, 7],
      [4, 8],
    ]);
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
    // With seeds 1–7, bye goes to highest seed (7); fold 1–4, 2–5, 3–6
    expect(result.byePlayerId).toBe('p7');
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
    expect(standings[0]!.score).toBeGreaterThanOrEqual(
      standings[standings.length - 1]!.score,
    );
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
    // Equal performance → shared place (1224)
    expect(section[1]!.rank).toBe(1);
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

  it('applies Buchholz Cut-1, Sonneborn-Berger, and wins after score/Buchholz ties', () => {
    // Four players, equal scores after round-robin-ish results engineered so
    // A and B both have 1.5 with same Buchholz; SB / wins break the tie.
    const plist: EnginePlayer[] = [
      { id: 'a', name: 'A', rating: 1500, seed: 1 },
      { id: 'b', name: 'B', rating: 1500, seed: 2 },
      { id: 'c', name: 'C', rating: 1500, seed: 3 },
      { id: 'd', name: 'D', rating: 1500, seed: 4 },
    ];
    const past: PastGame[] = [
      // Round 1: A beats C, B draws D
      { round: 1, whiteId: 'a', blackId: 'c', result: '1-0', isBye: false },
      { round: 1, whiteId: 'b', blackId: 'd', result: '1/2-1/2', isBye: false },
      // Round 2: A draws B, C beats D → A=1.5 B=1 C=1 D=0.5
      { round: 2, whiteId: 'a', blackId: 'b', result: '1/2-1/2', isBye: false },
      { round: 2, whiteId: 'c', blackId: 'd', result: '1-0', isBye: false },
      // Round 3: A draws D, B beats C → A=2 B=2 C=1 D=1
      { round: 3, whiteId: 'a', blackId: 'd', result: '1/2-1/2', isBye: false },
      { round: 3, whiteId: 'b', blackId: 'c', result: '1-0', isBye: false },
    ];
    const standings = computeStandings(plist, past);
    const a = standings.find((s) => s.id === 'a')!;
    const b = standings.find((s) => s.id === 'b')!;
    expect(a.score).toBe(2);
    expect(b.score).toBe(2);
    // A: opponents C(1), B(2), D(1) → BH=4; Cut-1=4-1=3; wins=1
    // B: opponents D(1), A(2), C(1) → BH=4; Cut-1=4-1=3; wins=1
    expect(a.buchholz).toBe(4);
    expect(b.buchholz).toBe(4);
    expect(a.buchholzCut1).toBe(3);
    expect(b.buchholzCut1).toBe(3);
    // SB: A = 1*C(1) + 0.5*B(2) + 0.5*D(1) = 1+1+0.5 = 2.5
    //     B = 0.5*D(1) + 0.5*A(2) + 1*C(1) = 0.5+1+1 = 2.5
    expect(a.sonnebornBerger).toBe(2.5);
    expect(b.sonnebornBerger).toBe(2.5);
    expect(a.wins).toBe(1);
    expect(b.wins).toBe(1);
    // Progressive differs (A scored earlier) → unique ranks; A listed first
    expect(standings[0]!.id).toBe('a');
    expect(standings[1]!.id).toBe('b');
    expect(a.progressive).toBeGreaterThan(b.progressive);
  });

  it('does not add opponents or Buchholz from bye rounds', () => {
    const plist: EnginePlayer[] = [
      { id: 'a', name: 'A', rating: 1600, seed: 1 },
      { id: 'b', name: 'B', rating: 1500, seed: 2 },
      { id: 'c', name: 'C', rating: 1400, seed: 3 },
    ];
    const past: PastGame[] = [
      { round: 1, whiteId: 'a', blackId: 'b', result: '1-0', isBye: false },
      { round: 1, whiteId: 'c', blackId: null, result: 'bye', isBye: true },
    ];
    const standings = computeStandings(plist, past);
    const c = standings.find((s) => s.id === 'c')!;
    expect(c.score).toBe(1);
    expect(c.opponents).toEqual([]);
    expect(c.buchholz).toBe(0);
    expect(c.buchholzCut1).toBe(0);
    expect(c.sonnebornBerger).toBe(0);
    expect(c.wins).toBe(0);
    // Same score as C; A ranks first via higher rating after empty BH chain
    expect(standings[0]!.id).toBe('a');
  });

  it('ranks mutual-game winner ahead via direct encounter before seed', () => {
    // A and B equal on score/BH/Cut-1/SB/wins; B beat A → B ranks above A (seed would prefer A).
    const plist: EnginePlayer[] = [
      { id: 'a', name: 'A', rating: 1500, seed: 1 },
      { id: 'b', name: 'B', rating: 1500, seed: 2 },
      { id: 'c', name: 'C', rating: 1500, seed: 3 },
      { id: 'd', name: 'D', rating: 1500, seed: 4 },
    ];
    const past: PastGame[] = [
      { round: 1, whiteId: 'a', blackId: 'c', result: '1-0', isBye: false },
      { round: 1, whiteId: 'b', blackId: 'd', result: '1-0', isBye: false },
      { round: 2, whiteId: 'b', blackId: 'a', result: '1-0', isBye: false },
      { round: 2, whiteId: 'c', blackId: 'd', result: '1-0', isBye: false },
      { round: 3, whiteId: 'a', blackId: 'd', result: '1-0', isBye: false },
      { round: 3, whiteId: 'c', blackId: 'b', result: '1-0', isBye: false },
    ];
    const standings = computeStandings(plist, past);
    const a = standings.find((s) => s.id === 'a')!;
    const b = standings.find((s) => s.id === 'b')!;
    expect(a.score).toBe(2);
    expect(b.score).toBe(2);
    expect(a.buchholz).toBe(b.buchholz);
    expect(a.buchholzCut1).toBe(b.buchholzCut1);
    expect(a.sonnebornBerger).toBe(b.sonnebornBerger);
    expect(a.wins).toBe(b.wins);
    expect(standings.findIndex((s) => s.id === 'b')).toBeLessThan(
      standings.findIndex((s) => s.id === 'a'),
    );
  });

  it('ranks higher Sonneborn-Berger ahead when score and Buchholz match', () => {
    const plist: EnginePlayer[] = [
      { id: 'w', name: 'Winner', rating: 1400, seed: 2 },
      { id: 'x', name: 'Drawer', rating: 1400, seed: 1 },
      { id: 'y', name: 'Strong', rating: 1400, seed: 3 },
      { id: 'z', name: 'Weak', rating: 1400, seed: 4 },
    ];
    // W and X both finish on 2 with BH 4; W has higher SB (beat stronger Y).
    const past: PastGame[] = [
      { round: 1, whiteId: 'w', blackId: 'y', result: '1-0', isBye: false },
      { round: 1, whiteId: 'x', blackId: 'z', result: '1-0', isBye: false },
      { round: 2, whiteId: 'w', blackId: 'z', result: '1/2-1/2', isBye: false },
      { round: 2, whiteId: 'x', blackId: 'y', result: '1/2-1/2', isBye: false },
      { round: 3, whiteId: 'w', blackId: 'x', result: '1/2-1/2', isBye: false },
      { round: 3, whiteId: 'y', blackId: 'z', result: '1-0', isBye: false },
    ];
    const standings = computeStandings(plist, past);
    expect(standings[0]!.id).toBe('w');
    expect(standings[1]!.id).toBe('x');
    expect(standings[0]!.score).toBe(standings[1]!.score);
    expect(standings[0]!.buchholz).toBe(standings[1]!.buchholz);
    expect(standings[0]!.sonnebornBerger).toBeGreaterThan(standings[1]!.sonnebornBerger);
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
