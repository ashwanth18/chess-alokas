import { describe, expect, it } from 'vitest';
import {
  pairDutchRound,
  pairRound,
  pairSwissRound,
  UnsupportedPairingStyleError,
  type EnginePlayer,
  type PastGame,
} from './index.js';
import { buildDutchPlayers } from './dutch/state.js';
import { STYLE_META } from './registry.js';

function players(n: number): EnginePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    rating: 2000 - i * 50,
    seed: i + 1,
  }));
}

function opponentOf(boards: { whiteId: string | null; blackId: string | null; isBye: boolean }[], id: string) {
  const b = boards.find((x) => x.whiteId === id || x.blackId === id);
  if (!b || b.isBye) return null;
  return b.whiteId === id ? b.blackId : b.whiteId;
}

describe('STYLE_META', () => {
  it('lists Swiss and FIDE Dutch as available, Round Robin coming soon', () => {
    expect(STYLE_META.swiss).toEqual({ label: 'Swiss', implemented: true });
    expect(STYLE_META.dutch).toEqual({ label: 'FIDE Dutch Swiss', implemented: true });
    expect(STYLE_META.round_robin).toEqual({ label: 'Round Robin', implemented: false });
  });
});

describe('pairRound registry', () => {
  it('dispatches dutch to the Dutch engine', () => {
    const out = pairRound('dutch', { players: players(4), pastGames: [], round: 1, totalRounds: 5 });
    expect(out.boards).toHaveLength(2);
  });

  it('keeps swiss on the current engine', () => {
    const input = { players: players(4), pastGames: [], round: 1 as const };
    expect(pairRound('swiss', input)).toEqual(pairSwissRound(input));
  });

  it('still rejects round_robin', () => {
    expect(() =>
      pairRound('round_robin', { players: players(4), pastGames: [], round: 1 }),
    ).toThrow(UnsupportedPairingStyleError);
  });
});

describe('Dutch player state', () => {
  it('records colours only from played games, not forfeits', () => {
    const plist = players(2);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0F', isBye: false },
    ];
    const states = buildDutchPlayers(plist, past, 2, 5);
    const p1 = states.find((s) => s.id === 'p1')!;
    const p2 = states.find((s) => s.id === 'p2')!;
    expect(p1.playedColors).toEqual([]);
    expect(p2.playedColors).toEqual([]);
    expect(p1.opponents.has('p2')).toBe(false);
    expect(p1.hadForfeitWin).toBe(true);
    expect(p2.hadForfeitWin).toBe(false);
    expect(p1.score).toBe(1);
    expect(p1.prefKind).toBe('none');
  });

  it('marks a pairing-allocated bye and a downfloat', () => {
    const plist = players(3);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p3', blackId: null, result: 'bye', isBye: true },
    ];
    const states = buildDutchPlayers(plist, past, 2, 5);
    const p3 = states.find((s) => s.id === 'p3')!;
    expect(p3.hadPab).toBe(true);
    expect(p3.floats).toEqual(['down']);
    expect(p3.score).toBe(1);
  });
});

describe('pairDutchRound', () => {
  it('uses the Dutch fold in round 1 (1–5, 2–6, …) with odd TPN getting White', () => {
    const out = pairDutchRound({
      players: players(8),
      pastGames: [],
      round: 1,
      totalRounds: 5,
    });
    expect(out.boards.map((b) => [b.whiteId, b.blackId])).toEqual([
      ['p1', 'p5'],
      ['p6', 'p2'],
      ['p3', 'p7'],
      ['p8', 'p4'],
    ]);
  });

  it('keeps a 3-point group together (ARCC R4 regression)', () => {
    const plist = players(12);
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
    const dutch = pairDutchRound({
      players: plist,
      pastGames: past,
      round: 4,
      totalRounds: 5,
    });
    const threePointers = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    for (const id of threePointers) {
      const opp = opponentOf(dutch.boards, id);
      expect(opp, `${id} should stay in the 3-point group`).toBeTruthy();
      expect(threePointers.has(opp!)).toBe(true);
    }

    const swiss = pairSwissRound({ players: plist, pastGames: past, round: 4 });
    const swissOpp = opponentOf(swiss.boards, 'p1');
    expect(swissOpp).toBeTruthy();
  });

  it('does not rematch while a new opponent exists (C.1)', () => {
    const plist = players(4);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p3', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p2', blackId: 'p4', result: '1-0', isBye: false },
    ];
    const out = pairDutchRound({ players: plist, pastGames: past, round: 2, totalRounds: 5 });
    const opp1 = opponentOf(out.boards, 'p1');
    expect(opp1).not.toBe('p3');
  });

  it('does not repeat a pairing-allocated bye (C.2)', () => {
    const plist = players(5);
    const r1 = pairDutchRound({ players: plist, pastGames: [], round: 1, totalRounds: 5 });
    expect(r1.byePlayerId).toBeTruthy();
    const past: PastGame[] = r1.boards.map((b) => ({
      round: 1,
      whiteId: b.whiteId,
      blackId: b.blackId,
      result: b.isBye ? 'bye' : '1/2-1/2',
      isBye: b.isBye,
    }));
    const r2 = pairDutchRound({ players: plist, pastGames: past, round: 2, totalRounds: 5 });
    expect(r2.byePlayerId).toBeTruthy();
    expect(r2.byePlayerId).not.toBe(r1.byePlayerId);
  });

  it('does not give a bye after a forfeit win (C.2)', () => {
    const plist = players(5);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p3', blackId: 'p4', result: '1-0F', isBye: false },
      { round: 1, whiteId: 'p5', blackId: null, result: 'bye', isBye: true },
    ];
    const out = pairDutchRound({ players: plist, pastGames: past, round: 2, totalRounds: 5 });
    expect(out.byePlayerId).not.toBe('p3');
    expect(out.byePlayerId).not.toBe('p5');
  });

  it('does not pair two non-topscorers with the same absolute colour preference (C.3)', () => {
    const plist = players(6);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p4', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p2', blackId: 'p5', result: '1-0', isBye: false },
      { round: 1, whiteId: 'p3', blackId: 'p6', result: '1-0', isBye: false },
      { round: 2, whiteId: 'p1', blackId: 'p5', result: '1-0', isBye: false },
      { round: 2, whiteId: 'p2', blackId: 'p6', result: '1-0', isBye: false },
      { round: 2, whiteId: 'p3', blackId: 'p4', result: '1-0', isBye: false },
    ];
    const states = buildDutchPlayers(plist, past, 3, 7);
    expect(states.filter((s) => s.prefKind === 'absolute' && s.pref === 'B').map((s) => s.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    const out = pairDutchRound({ players: plist, pastGames: past, round: 3, totalRounds: 7 });
    expect(opponentOf(out.boards, 'p1')).not.toBe('p2');
    expect(opponentOf(out.boards, 'p1')).not.toBe('p3');
    expect(opponentOf(out.boards, 'p2')).not.toBe('p3');
  });

  it('allows a rematch after an unplayed forfeit (C.04.2.3.5)', () => {
    const plist = players(2);
    const past: PastGame[] = [
      { round: 1, whiteId: 'p1', blackId: 'p2', result: '1-0F', isBye: false },
    ];
    const out = pairDutchRound({ players: plist, pastGames: past, round: 2, totalRounds: 5 });
    expect(out.boards).toHaveLength(1);
    expect(out.boards[0]?.isBye).toBe(false);
    const ids = [out.boards[0]?.whiteId, out.boards[0]?.blackId].sort();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('pairs a 33-player 5-round field without rematches or a repeat bye', () => {
    const plist = players(33);
    const past: PastGame[] = [];
    const byeSeen = new Set<string>();
    const played = new Map<string, Set<string>>();
    const started = Date.now();

    for (let r = 1; r <= 5; r++) {
      const out = pairDutchRound({
        players: plist,
        pastGames: past,
        round: r,
        totalRounds: 5,
      });
      const ids = new Set<string>();
      for (const b of out.boards) {
        if (b.isBye) {
          expect(b.whiteId).toBeTruthy();
          expect(byeSeen.has(b.whiteId!)).toBe(false);
          byeSeen.add(b.whiteId!);
          ids.add(b.whiteId!);
          continue;
        }
        const a = b.whiteId!;
        const bb = b.blackId!;
        expect(played.get(a)?.has(bb) ?? false).toBe(false);
        if (!played.has(a)) played.set(a, new Set());
        if (!played.has(bb)) played.set(bb, new Set());
        played.get(a)!.add(bb);
        played.get(bb)!.add(a);
        ids.add(a);
        ids.add(bb);
      }
      expect(ids.size).toBe(33);
      past.push(
        ...out.boards.map((b) => ({
          round: r,
          whiteId: b.whiteId,
          blackId: b.blackId,
          result: (b.isBye
            ? 'bye'
            : plist.find((p) => p.id === b.whiteId)!.rating! >
                plist.find((p) => p.id === b.blackId)!.rating!
              ? '1-0'
              : '0-1') as PastGame['result'],
          isBye: b.isBye,
        })),
      );
    }
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('assigns the last-bracket bye to an eligible player', () => {
    const out = pairDutchRound({
      players: players(5),
      pastGames: [],
      round: 1,
      totalRounds: 5,
    });
    expect(out.byePlayerId).toBeTruthy();
    expect(out.boards.filter((b) => b.isBye)).toHaveLength(1);
    expect(out.boards[out.boards.length - 1]?.isBye).toBe(true);
  });
});
