import type { PairingBoard, PairingInput, PairingOutput } from '../swiss.js';
import { pairScoreBrackets } from './bracket.js';
import { allocateColours } from './colour.js';
import { buildDutchPlayers, canReceivePab } from './state.js';
import type { DutchContext, DutchPair, DutchPlayer } from './types.js';

function higherOf(a: DutchPlayer, b: DutchPlayer): DutchPlayer {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.tpn !== b.tpn) return a.tpn < b.tpn ? a : b;
  return a.name.localeCompare(b.name) <= 0 ? a : b;
}

/** C.04.2.D.9 published board order; pairing-allocated bye last. */
export function publishBoards(
  pairs: DutchPair[],
  bye: DutchPlayer | null,
  ctx: DutchContext,
): PairingBoard[] {
  const coloured = pairs.map((p) => {
    const { white, black } = allocateColours(p.a, p.b, ctx);
    const higher = higherOf(p.a, p.b);
    return {
      white,
      black,
      higherScore: higher.score,
      scoreSum: p.a.score + p.b.score,
      higherTpn: higher.tpn,
    };
  });

  coloured.sort((x, y) => {
    if (y.higherScore !== x.higherScore) return y.higherScore - x.higherScore;
    if (y.scoreSum !== x.scoreSum) return y.scoreSum - x.scoreSum;
    return x.higherTpn - y.higherTpn;
  });

  const boards: PairingBoard[] = coloured.map((c, i) => ({
    board: i + 1,
    whiteId: c.white.id,
    blackId: c.black.id,
    isBye: false,
  }));

  if (bye) {
    boards.push({
      board: boards.length + 1,
      whiteId: bye.id,
      blackId: null,
      isBye: true,
    });
  }

  return boards;
}

export function pairDutchRound(input: PairingInput): PairingOutput {
  const players = buildDutchPlayers(
    input.players,
    input.pastGames,
    input.round,
    input.totalRounds,
  );
  if (players.length === 0) {
    return { boards: [], byePlayerId: null };
  }

  const ctx: DutchContext = {
    initialColor: input.initialColor ?? 'W',
    totalRounds: input.totalRounds ?? null,
    pairingRound: input.round,
    allowRematch: false,
    matchMemo: new Map(),
  };

  let { pairs, bye } = pairScoreBrackets(players, ctx);

  if (bye && !canReceivePab(bye)) {
    const rematchCtx: DutchContext = { ...ctx, allowRematch: true, matchMemo: new Map() };
    ({ pairs, bye } = pairScoreBrackets(players, rematchCtx));
  }

  const pairedIds = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]));
  if (bye) pairedIds.add(bye.id);
  const missing = players.filter((p) => !pairedIds.has(p.id));
  if (missing.length > 0) {
    const rematchCtx: DutchContext = { ...ctx, allowRematch: true, matchMemo: new Map() };
    ({ pairs, bye } = pairScoreBrackets(players, rematchCtx));
  }

  const boards = publishBoards(pairs, bye, ctx);
  return { boards, byePlayerId: bye?.id ?? null };
}
