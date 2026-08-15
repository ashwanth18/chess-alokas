import { pairRound, type PairingInput, type PairingOutput } from '@chess-alokas/pairing-engine';
import type { TournamentStyle } from '@chess-alokas/shared';
import { apiDutchPair } from '../api/client';

/**
 * Swiss stays in-process. FIDE Dutch boards come from bbpPairings v6
 * (desktop extraResources, else the authenticated API).
 */
export async function pairRoundForUi(
  style: TournamentStyle,
  input: PairingInput,
): Promise<PairingOutput> {
  if (style !== 'dutch') {
    return pairRound(style, input);
  }

  const payload = {
    ...input,
    totalRounds: input.totalRounds ?? input.round,
  };

  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  if (desktop?.pairDutch) {
    try {
      return await desktop.pairDutch(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const useApi =
        desktop.platform === 'darwin' ||
        /not installed|Mac binary|unavailable/i.test(msg);
      if (!useApi) {
        throw err instanceof Error ? err : new Error(msg);
      }
    }
  }

  const res = await apiDutchPair(payload);
  if (!res.ok || !res.data) {
    throw new Error(res.error || 'FIDE Dutch pairing failed (bbpPairings unavailable)');
  }
  return { boards: res.data.boards, byePlayerId: res.data.byePlayerId };
}
