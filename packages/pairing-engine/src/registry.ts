import type { TournamentStyle } from '@chess-alokas/shared';
import { isStyleImplemented } from '@chess-alokas/shared';
import { pairDutchRound } from './dutch/pair.js';
import { pairSwissRound, type PairingInput, type PairingOutput } from './swiss.js';

export class UnsupportedPairingStyleError extends Error {
  constructor(public style: TournamentStyle) {
    super(`Pairing style "${style}" is not implemented yet`);
    this.name = 'UnsupportedPairingStyleError';
  }
}

export function pairRound(
  style: TournamentStyle,
  input: PairingInput,
): PairingOutput {
  if (!isStyleImplemented(style)) {
    throw new UnsupportedPairingStyleError(style);
  }
  if (style === 'swiss') {
    return pairSwissRound(input);
  }
  if (style === 'dutch') {
    return pairDutchRound(input);
  }
  throw new UnsupportedPairingStyleError(style);
}

export const STYLE_META: Record<
  TournamentStyle,
  { label: string; implemented: boolean }
> = {
  swiss: { label: 'Swiss', implemented: true },
  dutch: { label: 'FIDE Dutch Swiss', implemented: true },
  round_robin: { label: 'Round Robin', implemented: false },
};

export function styleLabel(style: string): string {
  if (Object.prototype.hasOwnProperty.call(STYLE_META, style)) {
    return STYLE_META[style as TournamentStyle].label;
  }
  return style;
}
