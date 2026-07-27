const DEFAULT_PRIZE_PLACES = 3;
const MIN_PRIZE_PLACES = 1;
const MAX_PRIZE_PLACES = 20;

export function clampPrizePlaces(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_PRIZE_PLACES;
  return Math.min(MAX_PRIZE_PLACES, Math.max(MIN_PRIZE_PLACES, Math.trunc(value)));
}

/**
 * Resolve how many top places count as prize winners.
 * Category override if set, else tournament default.
 * (Applies to mixed pairing too — standings stay per category when categories exist.)
 */
export function resolvePrizePlaces(
  tournament: { prizePlaces?: number | null; mixCategories?: boolean } | null | undefined,
  category?: { prizePlaces?: number | null } | null,
  _opts?: { mix?: boolean },
): number {
  if (category?.prizePlaces != null) {
    return clampPrizePlaces(category.prizePlaces);
  }
  return clampPrizePlaces(tournament?.prizePlaces);
}

export { DEFAULT_PRIZE_PLACES, MIN_PRIZE_PLACES, MAX_PRIZE_PLACES };
