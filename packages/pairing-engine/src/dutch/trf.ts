import type { PairingBoard, PairingInput, PastGame, PlayerId } from '../swiss.js';
import { isPlayedResult } from './state.js';

const BBP_VERSION = '6.0.0';

export type TrfColor = 'w' | 'b' | '-';
export type TrfResult = '1' | '0' | '=' | '+' | '-' | 'H' | 'F' | 'Z' | 'U';

export interface TrfBuildResult {
  trf: string;
  /** TRF pairing id (1-based) → our player UUID */
  idByPairing: Map<number, PlayerId>;
  pairingById: Map<PlayerId, number>;
}

function asciiName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32) || 'Player';
}

function pointsFor(game: PastGame, playerId: PlayerId): number {
  const involved = game.whiteId === playerId || game.blackId === playerId;
  if (!involved) return 0;
  if (game.isBye) return 1;
  if (game.result === '1-0' || game.result === '1-0F') {
    return game.whiteId === playerId ? 1 : 0;
  }
  if (game.result === '0-1' || game.result === '0-1F') {
    return game.blackId === playerId ? 1 : 0;
  }
  if (game.result === '1/2-1/2') return 0.5;
  return 0;
}

function scoreOf(playerId: PlayerId, pastGames: PastGame[]): number {
  return pastGames.reduce((s, g) => s + pointsFor(g, playerId), 0);
}

function put(buf: string[], start: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    if (start + i < buf.length) buf[start + i] = value[i]!;
  }
}

/** 10-character game cell at TRF columns 92, 102, … (0-based 91). */
function gameCell(opp: number, color: TrfColor, result: TrfResult): string {
  const oppStr = opp === 0 ? '0000' : String(opp).padStart(4, ' ');
  return `${oppStr} ${color} ${result} `.padEnd(10, ' ');
}

function gameForRound(
  playerId: PlayerId,
  round: number,
  pastGames: PastGame[],
  pairingById: Map<PlayerId, number>,
): string {
  const game = pastGames.find(
    (g) =>
      g.round === round &&
      (g.whiteId === playerId || g.blackId === playerId),
  );
  if (!game) {
    return gameCell(0, '-', '-');
  }
  if (game.isBye) {
    return gameCell(0, '-', '+');
  }
  const isWhite = game.whiteId === playerId;
  const oppId = isWhite ? game.blackId : game.whiteId;
  const opp = oppId ? pairingById.get(oppId) ?? 0 : 0;
  const color: TrfColor = isWhite ? 'w' : 'b';

  if (game.result === 'pending') {
    return gameCell(opp, color, '-');
  }
  if (game.result === '1/2-1/2') return gameCell(opp, color, '=');
  if (game.result === '1-0') return gameCell(opp, color, isWhite ? '1' : '0');
  if (game.result === '0-1') return gameCell(opp, color, isWhite ? '0' : '1');
  if (game.result === '1-0F') return gameCell(opp, color, isWhite ? '+' : '-');
  if (game.result === '0-1F') return gameCell(opp, color, isWhite ? '-' : '+');
  if (game.result === '0-0') return gameCell(opp, color, '-');
  if (game.result === 'bye') return gameCell(0, '-', '+');
  return gameCell(opp, color, isPlayedResult(game.result, game.isBye) ? '1' : '-');
}

/**
 * Build a JaVaFo / bbpPairings TRF(x) for pairing `input.round`.
 * Players listed are those to pair; anyone missing a current-round cell is treated as present.
 */
export function buildTrf(input: PairingInput): TrfBuildResult {
  const sorted = [...input.players].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  const pairingById = new Map<PlayerId, number>();
  const idByPairing = new Map<number, PlayerId>();
  sorted.forEach((p, i) => {
    const id = i + 1;
    pairingById.set(p.id, id);
    idByPairing.set(id, p.id);
  });

  const playedRounds = [...new Set(input.pastGames.map((g) => g.round))]
    .filter((r) => r < input.round)
    .sort((a, b) => a - b);
  const maxPlayed = Math.max(0, input.round - 1);
  const rounds = Array.from({ length: maxPlayed }, (_, i) => i + 1);
  void playedRounds;

  if (input.totalRounds == null) {
    // Silently defaulting this to the current round would tell bbpPairings
    // this is the tournament's final round, activating last-round-only
    // rules (topscorer exceptions to colour clashes, PAB handling) too
    // early and producing a non-standard pairing with no warning.
    throw new Error(
      `Dutch pairing requires totalRounds (got round ${input.round} with none set)`,
    );
  }

  const initial = input.initialColor === 'B' ? 'black1' : 'white1';

  const lines: string[] = [
    `012 Chess Alokas`,
    `XXR ${input.totalRounds}`,
    `XXC ${initial}`,
  ];

  for (const p of sorted) {
    const pid = pairingById.get(p.id)!;
    const pts = scoreOf(p.id, input.pastGames);
    const rating = Math.max(0, Math.min(9999, Math.round(p.rating ?? 0)));
    const games = rounds.map((r) => gameForRound(p.id, r, input.pastGames, pairingById)).join('');
    const buf = Array.from({ length: 91 }, () => ' ');
    put(buf, 0, '001');
    put(buf, 4, String(pid).padStart(4, ' '));
    put(buf, 14, asciiName(p.name).padEnd(33).slice(0, 33));
    put(buf, 48, String(rating).padStart(4, ' '));
    put(buf, 80, pts.toFixed(1).padStart(4, ' '));
    put(buf, 85, String(pid).padStart(4, ' '));
    lines.push(buf.join('') + games);
  }

  return { trf: `${lines.join('\r\n')}\r\n`, idByPairing, pairingById };
}

/** Parse bbpPairings / JaVaFo `-p` output into our boards (already coloured). */
export function parseBbpPairOutput(
  text: string,
  idByPairing: Map<number, PlayerId>,
): { boards: PairingBoard[]; byePlayerId: PlayerId | null } {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('bbpPairings returned empty pairing output');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const count = Number.parseInt(lines[0] ?? '', 10);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`bbpPairings output missing pair count: ${lines[0] ?? ''}`);
  }
  const pairLines = lines.slice(1, 1 + count);
  if (pairLines.length < count) {
    throw new Error(`bbpPairings reported ${count} pairs but returned ${pairLines.length}`);
  }

  const boards: PairingBoard[] = [];
  let byePlayerId: PlayerId | null = null;
  let board = 1;
  const byes: PairingBoard[] = [];

  for (const line of pairLines) {
    const parts = line.split(/\s+/).map((n) => Number.parseInt(n, 10));
    const a = parts[0];
    const b = parts[1];
    if (!a || !Number.isFinite(a)) {
      throw new Error(`Invalid bbpPairings pair line: ${line}`);
    }
    if (!b) {
      const id = idByPairing.get(a);
      if (!id) throw new Error(`bbpPairings bye for unknown pairing id ${a}`);
      byePlayerId = id;
      byes.push({ board: 0, whiteId: id, blackId: null, isBye: true });
      continue;
    }
    const whiteId = idByPairing.get(a);
    const blackId = idByPairing.get(b);
    if (!whiteId || !blackId) {
      throw new Error(`bbpPairings pair ${a} vs ${b} maps to unknown players`);
    }
    boards.push({ board: board++, whiteId, blackId, isBye: false });
  }

  for (const bye of byes) {
    boards.push({ ...bye, board: board++ });
  }

  return { boards, byePlayerId };
}

export { BBP_VERSION };
