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

export interface CompletionBlocker {
  type: 'unpaired_round' | 'pending_results';
  message: string;
}

export type InstructionStatus = 'done' | 'current' | 'upcoming';

export interface TournamentInstruction {
  id: string;
  status: InstructionStatus;
  title: string;
  description?: string;
}

function asList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function summarizePendingResults(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
  categoryNames: Record<string, string>,
): string | undefined {
  const mix = isMixedTournament(tournament);
  const activeCategories = asList(categories).filter((c) => !c.deletedAt);
  const pending = relevantCompletionGames(tournament, categories, participants, games).filter(
    (g) => !g.isBye && g.result === 'pending',
  );
  if (pending.length === 0) return undefined;

  const label = (id: string) => categoryNames[id] ?? 'Category';

  if (!mix && activeCategories.length > 0) {
    const parts: string[] = [];
    for (const cat of activeCategories) {
      const catPending = pending.filter((g) => g.categoryId === cat.id);
      if (catPending.length === 0) continue;
      parts.push(`${label(cat.id)} (${catPending.length})`);
    }
    if (parts.length > 0) {
      return `Still pending: ${parts.join(', ')}. Switch category tabs to score each section.`;
    }
  }

  const byRound = new Map<number, number>();
  for (const g of pending) {
    byRound.set(g.round, (byRound.get(g.round) ?? 0) + 1);
  }
  const roundParts = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, count]) => `Round ${round}: ${count}`);
  return `${pending.length} game${pending.length === 1 ? '' : 's'} left — ${roundParts.join(', ')}.`;
}

/** Friendly step-by-step guide for what to do next (replaces raw completion blocker dumps). */
export function getTournamentInstructions(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
  caps: TournamentCapabilities,
  categoryNames: Record<string, string> = {},
): TournamentInstruction[] {
  const cats = asList(categories);
  const players = asList(participants);
  const activeGames = asList(games);
  const mix = isMixedTournament(tournament);
  const hasCategories = cats.filter((c) => !c.deletedAt).length > 0;
  const playerCount = players.filter((p) => !p.deletedAt).length;
  const enoughPlayers = hasEnoughPlayersToStart(cats, players, mix);
  const hasGames = activeGames.some((g) => !g.deletedAt);
  const markedReady =
    tournament.status === 'ready' ||
    hasGames ||
    tournament.currentRound > 0 ||
    caps.stage === 'in_progress';
  const nextRound = getNextPairingRound(
    tournament.rounds,
    cats,
    players,
    activeGames,
    mix,
  );
  const instructions: TournamentInstruction[] = [];

  // 1 — Import
  instructions.push({
    id: 'import',
    status: enoughPlayers ? 'done' : 'current',
    title: enoughPlayers ? `${playerCount} player${playerCount === 1 ? '' : 's'} imported` : 'Import players',
    description: enoughPlayers
      ? 'Player list is ready'
      : 'Upload a CSV on the Players tab — you need at least 2 players to start',
  });

  if (!enoughPlayers) {
    instructions.push(
      {
        id: 'ready',
        status: 'upcoming',
        title: 'Mark tournament ready',
        description: 'Confirm the player list when setup is complete',
      },
      {
        id: 'play',
        status: 'upcoming',
        title: 'Pair rounds & enter results',
        description: `Generate pairings round by round across ${tournament.rounds} rounds`,
      },
      {
        id: 'complete',
        status: 'upcoming',
        title: 'Complete tournament',
        description: 'All rounds paired and every result entered',
      },
    );
    return instructions;
  }

  // 2 — Mark ready
  instructions.push({
    id: 'ready',
    status: markedReady ? 'done' : 'current',
    title: markedReady ? 'Tournament marked ready' : 'Mark tournament ready',
    description: markedReady
      ? 'Setup complete — time to pair'
      : 'Click Mark Ready when the hall is set and the list is final',
  });

  if (!markedReady) {
    instructions.push(
      {
        id: 'play',
        status: 'upcoming',
        title: 'Pair rounds & enter results',
        description: 'Open Pairings, generate Round 1, then score each round before the next',
      },
      {
        id: 'complete',
        status: 'upcoming',
        title: 'Complete tournament',
        description: 'All rounds paired and every result entered',
      },
    );
    return instructions;
  }

  // 3 — Pair & play (one focused action at a time)
  let playStatus: InstructionStatus = 'current';
  let playTitle = 'Pair rounds & enter results';
  let playDescription = '';

  if (!hasGames) {
    playTitle = 'Generate Round 1 pairings';
    playDescription = hasCategories && !mix
      ? 'Open the Pairings tab — each category gets its own pairings'
      : 'Open the Pairings tab and click Generate Round 1';
  } else if (caps.pendingResultsRound != null && nextRound != null) {
    playTitle = `Enter Round ${caps.pendingResultsRound} results`;
    playDescription = `Score every game in Round ${caps.pendingResultsRound} before generating Round ${nextRound}.`;
    const pendingDetail = summarizePendingResults(
      tournament,
      cats,
      players,
      activeGames,
      categoryNames,
    );
    if (pendingDetail) playDescription += ` ${pendingDetail}`;
  } else if (nextRound != null) {
    playTitle = `Generate Round ${nextRound} pairings`;
    playDescription =
      nextRound === tournament.rounds
        ? 'Final round — generate pairings, then enter all results to finish'
        : `Round ${nextRound - 1} is complete — pair the next round on the Pairings tab`;
  } else if (!caps.allResultsDone) {
    playTitle = 'Enter remaining results';
    playDescription =
      summarizePendingResults(tournament, cats, players, activeGames, categoryNames) ??
      'Score the last games to finish the tournament';
  } else {
    playStatus = 'done';
    playTitle = 'All rounds played';
    playDescription = `${tournament.rounds} rounds paired and scored`;
  }

  instructions.push({
    id: 'play',
    status: playStatus,
    title: playTitle,
    description: playDescription,
  });

  // 4 — Complete
  const fullyDone = caps.allRoundsPaired && caps.allResultsDone;
  instructions.push({
    id: 'complete',
    status: fullyDone ? 'done' : 'upcoming',
    title: fullyDone ? 'Tournament complete' : 'Complete tournament',
    description: fullyDone
      ? 'Pairings and results are locked'
      : `All ${tournament.rounds} rounds must be paired and every result entered`,
  });

  return instructions;
}

export function getCompletionBlockers(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
  categoryNames: Record<string, string> = {},
): CompletionBlocker[] {
  const blockers: CompletionBlocker[] = [];
  const mix = isMixedTournament(tournament);
  const players = asList(participants);
  const active = asList(games).filter((g) => !g.deletedAt);
  const activeCategories = asList(categories).filter((c) => !c.deletedAt);
  const label = (id: string) => categoryNames[id] ?? 'Category';

  if (mix || activeCategories.length === 0) {
    for (let r = 1; r <= tournament.rounds; r++) {
      if (!active.some((g) => g.round === r)) {
        blockers.push({
          type: 'unpaired_round',
          message: `Round ${r} has not been paired yet.`,
        });
      }
    }
  } else {
    for (const cat of activeCategories) {
      const count = players.filter(
        (p) => !p.deletedAt && p.categoryIds?.includes(cat.id),
      ).length;
      if (count < 2) continue;
      for (let r = 1; r <= tournament.rounds; r++) {
        if (!active.some((g) => g.round === r && g.categoryId === cat.id)) {
          blockers.push({
            type: 'unpaired_round',
            message: `${label(cat.id)}: Round ${r} has not been paired yet.`,
          });
        }
      }
    }
  }

  const pending = relevantCompletionGames(tournament, categories, participants, games).filter(
    (g) => !g.isBye && g.result === 'pending',
  );
  if (pending.length > 0) {
    if (!mix && activeCategories.length > 0) {
      for (const cat of activeCategories) {
        const catPending = pending.filter((g) => g.categoryId === cat.id);
        if (catPending.length === 0) continue;
        const byRound = new Map<number, number>();
        for (const g of catPending) {
          byRound.set(g.round, (byRound.get(g.round) ?? 0) + 1);
        }
        for (const [round, count] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
          blockers.push({
            type: 'pending_results',
            message: `${label(cat.id)} Round ${round}: ${count} game(s) still need a result.`,
          });
        }
      }
    } else {
      const byRound = new Map<number, number>();
      for (const g of pending) {
        byRound.set(g.round, (byRound.get(g.round) ?? 0) + 1);
      }
      for (const [round, count] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
        blockers.push({
          type: 'pending_results',
          message: `Round ${round}: ${count} game(s) still need a result.`,
        });
      }
    }
  }

  return blockers;
}

export function pendingResultsCountForCategory(
  games: LocalGame[] | null | undefined,
  categoryId: string,
): number {
  return asList(games).filter(
    (g) => !g.deletedAt && g.categoryId === categoryId && !g.isBye && g.result === 'pending',
  ).length;
}

/** Games that count toward pairing completion and result entry (excludes deleted categories and single-player pools). */
export function relevantCompletionGames(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): LocalGame[] {
  const mix = isMixedTournament(tournament);
  const cats = asList(categories);
  const players = asList(participants);
  const activeCategories = cats.filter((c) => !c.deletedAt);
  return asList(games).filter((g) => {
    if (g.deletedAt) return false;
    if (mix || activeCategories.length === 0) return true;
    const cat = activeCategories.find((c) => c.id === g.categoryId);
    if (!cat) return false;
    const count = players.filter(
      (p) => !p.deletedAt && p.categoryIds?.includes(cat.id),
    ).length;
    return count >= 2;
  });
}

const MIXED_POOL_ID = '__mixed__';

export function isMixedTournament(tournament: TournamentLike): boolean {
  return tournament.mixCategories === true;
}

export { MIXED_POOL_ID };

/** Smallest round (1..max) that still needs pairings. */
export function getNextPairingRound(
  maxRounds: number,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
  mixCategories = false,
): number | null {
  const cats = asList(categories);
  const players = asList(participants);
  const activeGames = asList(games);

  for (let round = 1; round <= maxRounds; round++) {
    if (mixCategories || cats.length === 0) {
      const hasRound = activeGames.some((g) => !g.deletedAt && g.round === round);
      if (!hasRound) return round;
      continue;
    }

    for (const cat of cats) {
      if (cat.deletedAt) continue;
      const count = players.filter(
        (p) => !p.deletedAt && p.categoryIds?.includes(cat.id),
      ).length;
      if (count < 2) continue;
      const hasRound = activeGames.some(
        (g) => !g.deletedAt && g.categoryId === cat.id && g.round === round,
      );
      if (!hasRound) return round;
    }
  }
  return null;
}

export function allResultsEntered(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): boolean {
  const active = relevantCompletionGames(tournament, categories, participants, games);
  if (active.length === 0) return false;
  return active.every((g) => g.isBye || g.result === 'bye' || g.result !== 'pending');
}

/** First round (before `beforeRound`) that still has pending non-bye results, or null. */
export function firstRoundMissingResults(
  games: LocalGame[] | null | undefined,
  beforeRound: number,
): number | null {
  const activeGames = asList(games);
  for (let r = 1; r < beforeRound; r++) {
    const roundGames = activeGames.filter((g) => !g.deletedAt && g.round === r);
    if (roundGames.length === 0) continue;
    if (roundGames.some((g) => !g.isBye && g.result === 'pending')) return r;
  }
  return null;
}

export function isAllRoundsPaired(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): boolean {
  return (
    getNextPairingRound(
      tournament.rounds,
      categories,
      participants,
      games,
      isMixedTournament(tournament),
    ) === null &&
    relevantCompletionGames(tournament, categories, participants, games).length > 0
  );
}

/** Fully complete: all rounds paired and all non-bye results entered. */
export function isTournamentComplete(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): boolean {
  return (
    isAllRoundsPaired(tournament, categories, participants, games) &&
    allResultsEntered(tournament, categories, participants, games)
  );
}

export function hasEnoughPlayersToStart(
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  mixCategories = false,
): boolean {
  const cats = asList(categories);
  const active = asList(participants).filter((p) => !p.deletedAt);
  if (mixCategories || cats.filter((c) => !c.deletedAt).length === 0) {
    return active.length >= 2;
  }
  return cats.some((cat) => {
    if (cat.deletedAt) return false;
    return active.filter((p) => p.categoryIds?.includes(cat.id)).length >= 2;
  });
}

export function effectiveTournamentStatus(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): 'draft' | 'ready' | 'in_progress' | 'completed' {
  if (isTournamentComplete(tournament, categories, participants, games)) {
    return 'completed';
  }
  const hasGames = asList(games).some((g) => !g.deletedAt);
  if (hasGames || tournament.currentRound > 0) {
    return 'in_progress';
  }
  if (tournament.status === 'ready') return 'ready';
  return 'draft';
}

export function getTournamentCapabilities(
  tournament: TournamentLike,
  categories: CategoryLike[] | null | undefined,
  participants: LocalParticipant[] | null | undefined,
  games: LocalGame[] | null | undefined,
): TournamentCapabilities {
  const cats = asList(categories);
  const players = asList(participants);
  const activeGames = asList(games);
  const stage = effectiveTournamentStatus(tournament, cats, players, activeGames);
  const mix = isMixedTournament(tournament);
  const enoughPlayers = hasEnoughPlayersToStart(cats, players, mix);
  const nextRound = getNextPairingRound(
    tournament.rounds,
    cats,
    players,
    activeGames,
    mix,
  );
  const allRoundsPaired = isAllRoundsPaired(tournament, cats, players, activeGames);
  const allResultsDone = allResultsEntered(tournament, cats, players, activeGames);
  // Only games that belong to active pairing pools can block the next round.
  // Orphan rows (legacy __mixed__, deleted categories, single-player pools) must
  // not freeze Generate Round N after the UI shows every board as scored.
  const completionGames = relevantCompletionGames(tournament, cats, players, activeGames);
  const pendingResultsRound =
    nextRound !== null ? firstRoundMissingResults(completionGames, nextRound) : null;

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
    canEditResults: !completed && activeGames.some((g) => !g.deletedAt),
    canMarkReady: stage === 'draft' && enoughPlayers,
    showStartHint: (stage === 'draft' || stage === 'ready') && enoughPlayers,
    allRoundsPaired,
    allResultsDone,
    pendingResultsRound,
  };
}

export function highestPairedRound(games: LocalGame[] | null | undefined): number {
  return asList(games).reduce((max, g) => (g.deletedAt ? max : Math.max(max, g.round)), 0);
}
