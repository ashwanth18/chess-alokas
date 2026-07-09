import type { TournamentStyle } from '@chess-alokas/shared';
import { isStyleImplemented } from '@chess-alokas/shared';
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
  throw new UnsupportedPairingStyleError(style);
}

export const STYLE_META: Record<
  TournamentStyle,
  { label: string; implemented: boolean }
> = {
  swiss: { label: 'FIDE Swiss', implemented: true },
  round_robin: { label: 'Round Robin', implemented: false },
};
