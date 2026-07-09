import type { LocalGame, LocalParticipant } from '../db/local';

export interface CategoryLike {
  id: string;
  deletedAt?: string | null;
}

export interface TournamentLike {
  rounds: number;
  status: string;
  currentRound: number;
  mixCategories?: boolean;
}

const MIXED_POOL_ID = '__mixed__';

export function isMixedTournament(tournament: TournamentLike): boolean {
  return tournament.mixCategories === true;
}

export { MIXED_POOL_ID };

/** Smallest round (1..max) that still needs pairings. */
export function getNextPairingRound(
  maxRounds: number,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
  mixCategories = false,
): number | null {
  for (let round = 1; round <= maxRounds; round++) {
    if (mixCategories || categories.length === 0) {
      const hasRound = games.some((g) => !g.deletedAt && g.round === round);
      if (!hasRound) return round;
      continue;
    }

    for (const cat of categories) {
      if (cat.deletedAt) continue;
      const count = participants.filter(
        (p) => !p.deletedAt && p.categoryIds?.includes(cat.id),
      ).length;
      if (count < 2) continue;
      const hasRound = games.some(
        (g) => !g.deletedAt && g.categoryId === cat.id && g.round === round,
      );
      if (!hasRound) return round;
    }
  }
  return null;
}

export function isTournamentComplete(
  tournament: TournamentLike,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
): boolean {
  return (
    getNextPairingRound(
      tournament.rounds,
      categories,
      participants,
      games,
      isMixedTournament(tournament),
    ) === null
  );
}

export function effectiveTournamentStatus(
  tournament: TournamentLike,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
): string {
  if (isTournamentComplete(tournament, categories, participants, games)) {
    return 'completed';
  }
  const hasGames = games.some((g) => !g.deletedAt);
  if (hasGames || tournament.currentRound > 0) {
    return 'in_progress';
  }
  return tournament.status;
}

export function highestPairedRound(games: LocalGame[]): number {
  return games.reduce((max, g) => (g.deletedAt ? max : Math.max(max, g.round)), 0);
}
