/** Per-round Swiss-Manager-style exclusion (absent / withdraw). */

export type AvailabilityFields = {
  excludedRounds?: number[] | null;
  withdrawnFromRound?: number | null;
};

export function normalizeExcludedRounds(
  rounds: number[] | null | undefined,
): number[] {
  if (!rounds?.length) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of rounds) {
    if (!Number.isInteger(n) || n < 1) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function isExcludedFromRound(
  player: AvailabilityFields,
  round: number,
): boolean {
  if (round < 1) return false;
  const withdrawn = player.withdrawnFromRound;
  if (withdrawn != null && withdrawn > 0 && round >= withdrawn) return true;
  return (player.excludedRounds ?? []).includes(round);
}

export function exclusionStatus(
  player: AvailabilityFields,
  round: number,
): 'playing' | 'absent' | 'withdrawn' {
  const withdrawn = player.withdrawnFromRound;
  if (withdrawn != null && withdrawn > 0 && round >= withdrawn) return 'withdrawn';
  if ((player.excludedRounds ?? []).includes(round)) return 'absent';
  return 'playing';
}

export function withAbsentThisRound<T extends AvailabilityFields>(
  player: T,
  round: number,
): T {
  if (round < 1) return player;
  if (isExcludedFromRound(player, round)) return player;
  return {
    ...player,
    excludedRounds: normalizeExcludedRounds([...(player.excludedRounds ?? []), round]),
  };
}

export function withWithdrawFrom<T extends AvailabilityFields>(
  player: T,
  fromRound: number,
): T {
  if (fromRound < 1) return player;
  return {
    ...player,
    withdrawnFromRound: fromRound,
  };
}

/** Play from `fromRound` onward. Past skipped rounds stay skipped. */
export function withReactivatedFrom<T extends AvailabilityFields>(
  player: T,
  fromRound: number,
): T {
  const excluded = normalizeExcludedRounds(player.excludedRounds).filter(
    (r) => r < fromRound,
  );
  return {
    ...player,
    excludedRounds: excluded,
    withdrawnFromRound: null,
  };
}
