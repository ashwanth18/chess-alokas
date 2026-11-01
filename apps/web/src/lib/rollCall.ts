import { isExcludedFromRound, withReactivatedFrom } from '@chess-alokas/shared';
import type { LocalParticipant } from '../db/local';

export type CheckInPatch = {
  customFields: Record<string, unknown>;
  excludedRounds?: number[];
  withdrawnFromRound?: number | null;
};

/**
 * Checking a player in means they are here, so it also clears a Round 1 absence, as long as
 * Round 1 has not been paired. Applies to a single tick and to Check In All alike.
 */
export function checkInPatch(
  player: LocalParticipant,
  checked: boolean,
  round1Paired: boolean,
): CheckInPatch {
  const patch: CheckInPatch = {
    customFields: { ...(player.customFields ?? {}), checkedIn: checked },
  };
  if (checked && !round1Paired && isExcludedFromRound(player, 1)) {
    const next = withReactivatedFrom(player, 1);
    patch.excludedRounds = next.excludedRounds ?? [];
    patch.withdrawnFromRound = next.withdrawnFromRound ?? null;
  }
  return patch;
}

/** Text for the confirm before marking every unchecked player absent. */
export function bulkAbsentConfirmMessage(uncheckedCount: number, totalCount: number): string {
  const everyone =
    uncheckedCount >= totalCount
      ? '\n\nNobody is checked in yet, so this marks the WHOLE field absent.'
      : '';
  return `Mark ${uncheckedCount} of ${totalCount} players absent for Round 1?${everyone}\n\nThey will not be paired. Ticking a player in later brings them back.`;
}
