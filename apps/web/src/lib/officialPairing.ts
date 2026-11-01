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

  if (input.players.length === 0) {
    return { boards: [], byePlayerId: null };
  }
  if (input.players.length === 1) {
    const lone = input.players[0]!;
    return {
      boards: [{ board: 1, whiteId: lone.id, blackId: null, isBye: true }],
      byePlayerId: lone.id,
    };
  }
  if (input.totalRounds == null) {
    throw new Error(`Dutch pairing requires totalRounds (got round ${input.round} with none set)`);
  }

  const payload = {
    ...input,
    totalRounds: input.totalRounds,
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
