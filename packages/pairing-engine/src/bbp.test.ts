import { describe, expect, it } from 'vitest';
import { buildTrf, parseBbpPairOutput } from './dutch/trf.js';
import { bbpPairingsAvailable, pairDutchWithBbp } from './dutch/bbp.js';
import type { EnginePlayer, PastGame } from './index.js';

function players(n: number): EnginePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    rating: 2000 - i * 50,
    seed: i + 1,
  }));
}

describe('TRF', () => {
  it('assigns pairing ids in seed order and includes XXR/XXC', () => {
    const { trf, pairingById } = buildTrf({
      players: players(4),
      pastGames: [],
      round: 1,
      totalRounds: 5,
    });
    expect(pairingById.get('p1')).toBe(1);
    expect(trf).toMatch(/XXR 5/);
    expect(trf).toMatch(/XXC white1/);
    expect(trf).toMatch(/001\s+1/);
    expect(trf).toMatch(/001\s+4/);
    const playerLine = trf.split(/\r?\n/).find((l) => l.startsWith('001') && l.includes('Player 1'));
    expect(playerLine?.length).toBe(91);
  });

  it('emits 10-character game cells so later rounds stay aligned', () => {
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p3', blackId: 'p4', result: '1-0', isBye: false },
    ];
    const { trf } = buildTrf({
      players: players(4),
      pastGames: past,
      round: 2,
      totalRounds: 5,
    });
    const line = trf.split(/\r?\n/).find((l) => l.startsWith('001') && l.includes('Player 1'))!;
    expect(line.length).toBe(101);
    expect(line.slice(91, 101)).toMatch(/^\s*2 w 1\s+$/);
  });

  it('encodes a pairing-allocated bye as 0000 - +', () => {
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p3', blackId: null, result: 'bye', isBye: true },
    ];
    const { trf } = buildTrf({
      players: players(3),
      pastGames: past,
      round: 2,
      totalRounds: 5,
    });
    expect(trf).toMatch(/0000 - \+/);
  });

  it('parses JaVaFo-style pair output including a bye', () => {
    const ids = new Map<number, string>([
      [1, 'p1'],
      [2, 'p2'],
      [3, 'p3'],
    ]);
    const out = parseBbpPairOutput('2\n1 2\n3 0\n', ids);
    expect(out.boards).toHaveLength(2);
    expect(out.boards[0]).toMatchObject({ whiteId: 'p1', blackId: 'p2', isBye: false });
    expect(out.byePlayerId).toBe('p3');
    expect(out.boards[1]?.isBye).toBe(true);
  });
});

describe('bbpPairings v6', () => {
  it.skipIf(!bbpPairingsAvailable())('pairs round 1 of 8 as Dutch fold 1-5, 2-6, …', async () => {
    const out = await pairDutchWithBbp({
      players: players(8),
      pastGames: [],
      round: 1,
      totalRounds: 5,
      initialColor: 'W',
    });
    const pairs = out.boards
      .filter((b) => !b.isBye)
      .map((b) => [b.whiteId, b.blackId] as const);
    expect(pairs).toHaveLength(4);
    const asSets = pairs.map(([a, b]) => new Set([a, b]));
    expect(asSets.some((s) => s.has('p1') && s.has('p5'))).toBe(true);
    expect(asSets.some((s) => s.has('p2') && s.has('p6'))).toBe(true);
    expect(asSets.some((s) => s.has('p3') && s.has('p7'))).toBe(true);
    expect(asSets.some((s) => s.has('p4') && s.has('p8'))).toBe(true);
  });

  it.skipIf(!bbpPairingsAvailable())('keeps the ARCC 3-point group together in round 4', async () => {
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p7', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p8', blackId: 'p2', result: '0-1', isBye: false },
      { round: 1, whiteId: 'p3', blackId: 'p9', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p10', blackId: 'p4', result: '0-1', isBye: false },
      { round: 1, whiteId: 'p5', blackId: 'p11', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p12', blackId: 'p6', result: '0-1', isBye: false },
      { round: 2, whiteId: 'p8', blackId: 'p1', result: '0-1', isBye: false },
      { round: 2, whiteId: 'p2', blackId: 'p9', result: '1-0', isBye: false },
      { round: 2, whiteId: 'p10', blackId: 'p3', result: '0-1', isBye: false },
      { round: 2, whiteId: 'p4', blackId: 'p11', result: '1-0', isBye: false },
      { round: 2, whiteId: 'p12', blackId: 'p5', result: '0-1', isBye: false },
      { round: 2, whiteId: 'p6', blackId: 'p7', result: '1-0', isBye: false },
      { round: 3, whiteId: 'p1', blackId: 'p9', result: '1-0', isBye: false },
      { round: 3, whiteId: 'p10', blackId: 'p2', result: '0-1', isBye: false },
      { round: 3, whiteId: 'p3', blackId: 'p11', result: '1-0', isBye: false },
      { round: 3, whiteId: 'p12', blackId: 'p4', result: '0-1', isBye: false },
      { round: 3, whiteId: 'p5', blackId: 'p7', result: '1-0', isBye: false },
      { round: 3, whiteId: 'p8', blackId: 'p6', result: '0-1', isBye: false },
    ];
    const out = await pairDutchWithBbp({
      players: players(12),
      pastGames: past,
      round: 4,
      totalRounds: 5,
    });
    const threePointers = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    for (const id of threePointers) {
      const board = out.boards.find((b) => b.whiteId === id || b.blackId === id);
      expect(board && !board.isBye, `${id} should be paired`).toBe(true);
      const opp = board!.whiteId === id ? board!.blackId : board!.whiteId;
      expect(threePointers.has(opp!)).toBe(true);
    }
  });
});
