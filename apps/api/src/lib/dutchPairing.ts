import {
  pairRound,
  UnsupportedPairingStyleError,
  type PairingInput,
  type PairingOutput,
} from '@chess-alokas/pairing-engine';
import {
  BbpPairingsError,
  pairDutchWithBbp,
} from '@chess-alokas/pairing-engine/bbp';
import type { TournamentStyle } from '@chess-alokas/shared';

export async function pairRoundOfficial(
  style: TournamentStyle,
  input: PairingInput,
): Promise<PairingOutput> {
  if (style === 'dutch') {
    try {
      return await pairDutchWithBbp(input);
    } catch (err) {
      if (err instanceof BbpPairingsError) throw err;
      throw err;
    }
  }
  return pairRound(style, input);
}

export { BbpPairingsError, UnsupportedPairingStyleError };
