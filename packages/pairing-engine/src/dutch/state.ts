import type { GameResult } from '@chess-alokas/shared';
import { compareRosterOrder } from '../roster.js';
import type { EnginePlayer, PastGame, PlayerId } from '../swiss.js';
import type { Color, ColorPrefKind, DutchPlayer, FloatDir } from './types.js';

const PLAYED_RESULTS: ReadonlySet<GameResult> = new Set(['1-0', '0-1', '1/2-1/2']);

export function isPlayedResult(result: GameResult, isBye: boolean): boolean {
  return !isBye && PLAYED_RESULTS.has(result);
}

export function sortByPairingOrder(players: DutchPlayer[]): DutchPlayer[] {
  return [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tpn !== b.tpn) return a.tpn - b.tpn;
    return a.name.localeCompare(b.name);
  });
}

function colorPreferenceFromHistory(colors: Color[]): {
  pref: Color | null;
  prefKind: ColorPrefKind;
  colorDiff: number;
} {
  const whites = colors.filter((c) => c === 'W').length;
  const blacks = colors.filter((c) => c === 'B').length;
  const colorDiff = whites - blacks;
  if (colors.length === 0) {
    return { pref: null, prefKind: 'none', colorDiff };
  }

  const last = colors[colors.length - 1]!;
  const last2 = colors.length >= 2 ? colors[colors.length - 2] : undefined;
  const twoInARow = last2 !== undefined && last2 === last;

  if (colorDiff > 1 || (twoInARow && last === 'W')) {
    return { pref: 'B', prefKind: 'absolute', colorDiff };
  }
  if (colorDiff < -1 || (twoInARow && last === 'B')) {
    return { pref: 'W', prefKind: 'absolute', colorDiff };
  }
  if (colorDiff === 1) {
    return { pref: 'B', prefKind: 'strong', colorDiff };
  }
  if (colorDiff === -1) {
    return { pref: 'W', prefKind: 'strong', colorDiff };
  }
  return { pref: last === 'W' ? 'B' : 'W', prefKind: 'mild', colorDiff };
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

function isForfeitWin(game: PastGame, playerId: PlayerId): boolean {
  if (game.isBye) return false;
  if (game.result === '1-0F' && game.whiteId === playerId) return true;
  if (game.result === '0-1F' && game.blackId === playerId) return true;
  return false;
}

export function buildDutchPlayers(
  players: EnginePlayer[],
  pastGames: PastGame[],
  pairingRound: number,
  totalRounds?: number,
): DutchPlayer[] {
  const sorted = [...players].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (a.seed != null && b.seed != null && sa !== sb) return sa - sb;
    return compareRosterOrder(
      { id: a.id, name: a.name, rating: a.rating },
      { id: b.id, name: b.name, rating: b.rating },
    );
  });

  const byId = new Map<PlayerId, DutchPlayer>();
  sorted.forEach((p, index) => {
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      rating: p.rating ?? 0,
      tpn: p.seed ?? index + 1,
      score: 0,
      opponents: new Set(),
      playedColors: [],
      colorDiff: 0,
      pref: null,
      prefKind: 'none',
      hadPab: false,
      hadForfeitWin: false,
      unplayedCount: 0,
      floats: [],
      topscorer: false,
    });
  });

  const rounds = [...new Set(pastGames.map((g) => g.round))].sort((a, b) => a - b);

  for (const round of rounds) {
    const games = pastGames.filter((g) => g.round === round);
    const scoreBefore = new Map<PlayerId, number>();
    for (const st of byId.values()) scoreBefore.set(st.id, st.score);

    const floatThisRound = new Map<PlayerId, FloatDir | null>();
    for (const st of byId.values()) floatThisRound.set(st.id, null);

    for (const game of games) {
      if (game.isBye) {
        const byeId = game.whiteId ?? game.blackId;
        if (!byeId) continue;
        const st = byId.get(byeId);
        if (!st) continue;
        st.score += 1;
        st.hadPab = true;
        st.unplayedCount += 1;
        floatThisRound.set(byeId, 'down');
        continue;
      }

      const white = game.whiteId ? byId.get(game.whiteId) : undefined;
      const black = game.blackId ? byId.get(game.blackId) : undefined;
      if (!white || !black) continue;

      // C.04.2.3.5: unplayed pairings (forfeit / double-forfeit) may meet again.
      // C.1 only forbids playing more than once — so only played games block rematch.
      if (isPlayedResult(game.result, false)) {
        white.opponents.add(black.id);
        black.opponents.add(white.id);
        white.playedColors.push('W');
        black.playedColors.push('B');
      } else {
        white.unplayedCount += 1;
        black.unplayedCount += 1;
      }

      if (isForfeitWin(game, white.id)) white.hadForfeitWin = true;
      if (isForfeitWin(game, black.id)) black.hadForfeitWin = true;

      white.score += pointsFor(game, white.id);
      black.score += pointsFor(game, black.id);

      const sw = scoreBefore.get(white.id) ?? 0;
      const sb = scoreBefore.get(black.id) ?? 0;
      if (sw !== sb) {
        if (sw > sb) {
          floatThisRound.set(white.id, 'down');
          floatThisRound.set(black.id, 'up');
        } else {
          floatThisRound.set(black.id, 'down');
          floatThisRound.set(white.id, 'up');
        }
      } else if (isForfeitWin(game, white.id)) {
        floatThisRound.set(white.id, 'down');
      } else if (isForfeitWin(game, black.id)) {
        floatThisRound.set(black.id, 'down');
      }
    }

    for (const st of byId.values()) {
      st.floats.push(floatThisRound.get(st.id) ?? null);
    }
  }

  const maxPossible =
    totalRounds != null && pairingRound === totalRounds
      ? Math.max(0, totalRounds - 1)
      : null;

  for (const st of byId.values()) {
    const pref = colorPreferenceFromHistory(st.playedColors);
    st.colorDiff = pref.colorDiff;
    st.pref = pref.pref;
    st.prefKind = pref.prefKind;
    st.topscorer = maxPossible != null && st.score > maxPossible * 0.5;
  }

  return [...byId.values()];
}

export function canReceivePab(player: DutchPlayer): boolean {
  return !player.hadPab && !player.hadForfeitWin;
}

export function havePlayed(a: DutchPlayer, b: DutchPlayer): boolean {
  return a.opponents.has(b.id);
}

export function previousFloat(player: DutchPlayer, offset: 1 | 2): FloatDir | null {
  const idx = player.floats.length - offset;
  if (idx < 0) return null;
  return player.floats[idx] ?? null;
}
