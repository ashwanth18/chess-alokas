import type { Color, DutchContext, DutchPair, DutchPlayer } from './types.js';

export interface ColouredPair {
  white: DutchPlayer;
  black: DutchPlayer;
}

function prefStrength(p: DutchPlayer): number {
  if (p.prefKind === 'absolute') return 3;
  if (p.prefKind === 'strong') return 2;
  if (p.prefKind === 'mild') return 1;
  return 0;
}

function lastOppositeIndex(a: DutchPlayer, b: DutchPlayer): number {
  const n = Math.min(a.playedColors.length, b.playedColors.length);
  for (let i = 1; i <= n; i++) {
    const ca = a.playedColors[a.playedColors.length - i];
    const cb = b.playedColors[b.playedColors.length - i];
    if (ca && cb && ca !== cb) return i;
  }
  return Number.POSITIVE_INFINITY;
}

function higherRanked(a: DutchPlayer, b: DutchPlayer): DutchPlayer {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.tpn !== b.tpn) return a.tpn < b.tpn ? a : b;
  return a.name.localeCompare(b.name) <= 0 ? a : b;
}

/**
 * C.04.3 Article 5 — allocate colours after opponents are fixed.
 */
export function allocateColours(a: DutchPlayer, b: DutchPlayer, ctx: DutchContext): ColouredPair {
  const grant = (white: DutchPlayer, black: DutchPlayer): ColouredPair => ({ white, black });

  if (a.pref && b.pref && a.pref !== b.pref) {
    return a.pref === 'W' ? grant(a, b) : grant(b, a);
  }

  const sa = prefStrength(a);
  const sb = prefStrength(b);
  if (sa !== sb) {
    const stronger = sa > sb ? a : b;
    if (stronger.pref === 'W') return stronger === a ? grant(a, b) : grant(b, a);
    if (stronger.pref === 'B') return stronger === a ? grant(b, a) : grant(a, b);
  }

  if (sa === sb && sa === 3 && a.pref === b.pref) {
    if (Math.abs(a.colorDiff) !== Math.abs(b.colorDiff)) {
      const wider = Math.abs(a.colorDiff) > Math.abs(b.colorDiff) ? a : b;
      if (wider.pref === 'W') return wider === a ? grant(a, b) : grant(b, a);
      if (wider.pref === 'B') return wider === a ? grant(b, a) : grant(a, b);
    }
  }

  const ia = lastOppositeIndex(a, b);
  if (Number.isFinite(ia)) {
    const ca = a.playedColors[a.playedColors.length - ia];
    if (ca === 'W') return grant(b, a);
    if (ca === 'B') return grant(a, b);
  }

  const higher = higherRanked(a, b);
  if (higher.pref === 'W') return higher === a ? grant(a, b) : grant(b, a);
  if (higher.pref === 'B') return higher === a ? grant(b, a) : grant(a, b);

  const initial: Color = ctx.initialColor;
  const opposite: Color = initial === 'W' ? 'B' : 'W';
  const colour = higher.tpn % 2 === 1 ? initial : opposite;
  if (colour === 'W') return higher === a ? grant(a, b) : grant(b, a);
  return higher === a ? grant(b, a) : grant(a, b);
}

export function colourPairs(pairs: DutchPair[], ctx: DutchContext): ColouredPair[] {
  return pairs.map((p) => allocateColours(p.a, p.b, ctx));
}
