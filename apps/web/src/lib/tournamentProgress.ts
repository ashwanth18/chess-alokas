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

export interface TournamentCapabilities {
  stage: 'draft' | 'ready' | 'in_progress' | 'completed';
  canImport: boolean;
  importRequiresLateWarning: boolean;
  canPair: boolean;
  canEditResults: boolean;
  canMarkReady: boolean;
  showStartHint: boolean;
  allRoundsPaired: boolean;
  allResultsDone: boolean;
  /** Round that must be scored before the next pairing can run. */
  pendingResultsRound: number | null;
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

export function allResultsEntered(games: LocalGame[]): boolean {
  const active = games.filter((g) => !g.deletedAt);
  if (active.length === 0) return false;
  return active.every((g) => g.isBye || g.result === 'bye' || g.result !== 'pending');
}

/** First round (before `beforeRound`) that still has pending non-bye results, or null. */
export function firstRoundMissingResults(
  games: LocalGame[],
  beforeRound: number,
): number | null {
  for (let r = 1; r < beforeRound; r++) {
    const roundGames = games.filter((g) => !g.deletedAt && g.round === r);
    if (roundGames.length === 0) continue;
    if (roundGames.some((g) => !g.isBye && g.result === 'pending')) return r;
  }
  return null;
}

export function isAllRoundsPaired(
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
    ) === null &&
    games.some((g) => !g.deletedAt)
  );
}

/** Fully complete: all rounds paired and all non-bye results entered. */
export function isTournamentComplete(
  tournament: TournamentLike,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
): boolean {
  return (
    isAllRoundsPaired(tournament, categories, participants, games) &&
    allResultsEntered(games)
  );
}

export function hasEnoughPlayersToStart(
  categories: CategoryLike[],
  participants: LocalParticipant[],
  mixCategories = false,
): boolean {
  const active = participants.filter((p) => !p.deletedAt);
  if (mixCategories || categories.filter((c) => !c.deletedAt).length === 0) {
    return active.length >= 2;
  }
  return categories.some((cat) => {
    if (cat.deletedAt) return false;
    return active.filter((p) => p.categoryIds?.includes(cat.id)).length >= 2;
  });
}

export function effectiveTournamentStatus(
  tournament: TournamentLike,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
): 'draft' | 'ready' | 'in_progress' | 'completed' {
  if (isTournamentComplete(tournament, categories, participants, games)) {
    return 'completed';
  }
  const hasGames = games.some((g) => !g.deletedAt);
  if (hasGames || tournament.currentRound > 0) {
    return 'in_progress';
  }
  if (tournament.status === 'ready') return 'ready';
  return 'draft';
}

export function getTournamentCapabilities(
  tournament: TournamentLike,
  categories: CategoryLike[],
  participants: LocalParticipant[],
  games: LocalGame[],
): TournamentCapabilities {
  const stage = effectiveTournamentStatus(tournament, categories, participants, games);
  const mix = isMixedTournament(tournament);
  const enoughPlayers = hasEnoughPlayersToStart(categories, participants, mix);
  const nextRound = getNextPairingRound(
    tournament.rounds,
    categories,
    participants,
    games,
    mix,
  );
  const allRoundsPaired = isAllRoundsPaired(tournament, categories, participants, games);
  const allResultsDone = allResultsEntered(games);
  const pendingResultsRound =
    nextRound !== null ? firstRoundMissingResults(games, nextRound) : null;

  const completed = stage === 'completed';
  const live = stage === 'in_progress';

  return {
    stage,
    canImport: !completed,
    importRequiresLateWarning: live || allRoundsPaired,
    canPair:
      !completed &&
      enoughPlayers &&
      nextRound !== null &&
      pendingResultsRound === null,
    canEditResults: !completed && games.some((g) => !g.deletedAt),
    canMarkReady: stage === 'draft' && enoughPlayers,
    showStartHint: (stage === 'draft' || stage === 'ready') && enoughPlayers,
    allRoundsPaired,
    allResultsDone,
    pendingResultsRound,
  };
}

export function highestPairedRound(games: LocalGame[]): number {
  return games.reduce((max, g) => (g.deletedAt ? max : Math.max(max, g.round)), 0);
}
