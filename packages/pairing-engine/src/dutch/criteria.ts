import { allocateColours } from './colour.js';
import { canReceivePab, havePlayed, previousFloat } from './state.js';
import type { DutchContext, DutchPair, DutchPlayer, Quality } from './types.js';

export function absoluteColourClash(a: DutchPlayer, b: DutchPlayer): boolean {
  if (a.topscorer || b.topscorer) return false;
  return a.prefKind === 'absolute' && b.prefKind === 'absolute' && a.pref !== null && a.pref === b.pref;
}

export function legalOpponents(a: DutchPlayer, b: DutchPlayer, ctx: DutchContext): boolean {
  if (a.id === b.id) return false;
  if (!ctx.allowRematch && havePlayed(a, b)) return false;
  if (absoluteColourClash(a, b)) return false;
  return true;
}

function sameColourThreeInARow(player: DutchPlayer, getsWhite: boolean): boolean {
  if (player.playedColors.length < 2) return false;
  const last = player.playedColors[player.playedColors.length - 1];
  const prev = player.playedColors[player.playedColors.length - 2];
  const next = getsWhite ? 'W' : 'B';
  return last === prev && last === next;
}

function colourDiffAfter(player: DutchPlayer, getsWhite: boolean): number {
  return player.colorDiff + (getsWhite ? 1 : -1);
}

/**
 * Quality vector C5–C21 (2026 numbering). Lower is better.
 * C8 lookahead is filled by the caller (slot index 3).
 */
export function evaluateQuality(
  pairs: DutchPair[],
  downfloaters: DutchPlayer[],
  ctx: DutchContext,
  opts?: {
    pab?: DutchPlayer | null;
    lookaheadPenalty?: number;
    mdps?: DutchPlayer[];
  },
): Quality {
  const pab = opts?.pab ?? null;
  const mdps = opts?.mdps ?? [];
  const mdpIds = new Set(mdps.map((p) => p.id));

  const c5 = pab ? pab.score : -1;
  const c6 = downfloaters.length;
  const c7 = [...downfloaters].map((p) => p.score).sort((a, b) => b - a);
  const c8 = opts?.lookaheadPenalty ?? 0;
  const c9 = pab ? pab.unplayedCount : -1;

  let c10 = 0;
  let c11 = 0;
  let c12 = 0;
  let c13 = 0;
  const c14DownPrev: DutchPlayer[] = [];
  const c16DownTwo: DutchPlayer[] = [];
  const c18Diffs: number[] = [];
  const c19Diffs: number[] = [];
  const c20Diffs: number[] = [];
  const c21Diffs: number[] = [];
  let c15 = 0;
  let c17 = 0;

  for (const pair of pairs) {
    const { white } = allocateColours(pair.a, pair.b, ctx);
    for (const player of [pair.a, pair.b]) {
      const getsWhite = player.id === white.id;
      const granted = getsWhite ? 'W' : 'B';
      if (player.pref && player.pref !== granted) {
        c12 += 1;
        if (player.prefKind === 'strong') c13 += 1;
      }
      const isTopOrOpp =
        player.topscorer ||
        (player === pair.a ? pair.b.topscorer : pair.a.topscorer);
      if (isTopOrOpp) {
        const diff = colourDiffAfter(player, getsWhite);
        if (diff > 2 || diff < -2) c10 += 1;
        if (sameColourThreeInARow(player, getsWhite)) c11 += 1;
      }
    }
    const isMdpPair = mdpIds.has(pair.a.id) || mdpIds.has(pair.b.id);
    if (isMdpPair && pair.a.score !== pair.b.score) {
      const mdp = mdpIds.has(pair.a.id) && pair.a.score > pair.b.score ? pair.a : pair.b;
      const opp = mdp === pair.a ? pair.b : pair.a;
      const diff = Math.abs(mdp.score - opp.score);
      if (previousFloat(mdp, 1) === 'down') c18Diffs.push(diff);
      if (previousFloat(opp, 1) === 'up') {
        c15 += 1;
        c19Diffs.push(diff);
      }
      if (previousFloat(mdp, 2) === 'down') c20Diffs.push(diff);
      if (previousFloat(opp, 2) === 'up') {
        c17 += 1;
        c21Diffs.push(diff);
      }
    }
  }

  for (const p of downfloaters) {
    if (!mdpIds.has(p.id) && previousFloat(p, 1) === 'down') c14DownPrev.push(p);
    if (!mdpIds.has(p.id) && previousFloat(p, 2) === 'down') c16DownTwo.push(p);
  }

  const pad = (xs: number[], len = 8) => {
    const out = [...xs].sort((a, b) => b - a);
    while (out.length < len) out.push(-1);
    return out.slice(0, len);
  };

  return [
    c5,
    c6,
    ...pad(c7, 8),
    c8,
    c9,
    c10,
    c11,
    c12,
    c13,
    c14DownPrev.length,
    c15,
    c16DownTwo.length,
    c17,
    ...pad(c18Diffs, 6),
    ...pad(c19Diffs, 6),
    ...pad(c20Diffs, 6),
    ...pad(c21Diffs, 6),
  ];
}

export function compareQuality(a: Quality, b: Quality): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function pairsViolateAbsolute(
  pairs: DutchPair[],
  ctx: DutchContext,
): boolean {
  for (const p of pairs) {
    if (!legalOpponents(p.a, p.b, ctx)) return true;
  }
  return false;
}
