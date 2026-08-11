import type { GameResult } from '@chess-alokas/shared';
import {
  computeStandings,
  computeSectionStandings,
  diagnosePairings,
  pairSwissRound,
  type EnginePlayer,
  type PastGame,
  type PairingBoard,
  type Standing,
} from './swiss.js';

export type ResultMode = 'random' | 'rating_biased' | 'manual';
export type SimCategory = 'under12' | 'under18' | 'open';

export interface SimulatorConfig {
  playerCount: number;
  rounds: number;
  seed?: number;
  /** Split players into under12 / under18 by age */
  splitCategories?: boolean;
  /**
   * When splitCategories is true:
   * - false (default): pair and rank within each category separately
   * - true: one mixed pool across categories
   */
  mixCategories?: boolean;
  resultMode?: ResultMode;
}

export interface SimPlayer extends EnginePlayer {
  age: number;
  gender?: string;
  category: SimCategory;
}

export interface SimBoard extends PairingBoard {
  category: SimCategory;
}

export interface SimRound {
  round: number;
  boards: SimBoard[];
  results: Array<{ board: number; result: GameResult }>;
}

export interface SimulationState {
  players: SimPlayer[];
  pastGames: PastGame[];
  /** Past games tagged by category for separate-pool standings */
  pastGamesByCategory: Partial<Record<SimCategory, PastGame[]>>;
  roundsPlayed: SimRound[];
  currentRound: number;
  pendingBoards: SimBoard[] | null;
  config: Required<
    Pick<SimulatorConfig, 'rounds' | 'resultMode' | 'splitCategories' | 'mixCategories'>
  > & {
    seed: number;
  };
}

/** Mulberry32 PRNG for reproducible simulations */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Ava', 'Ben', 'Cara', 'Diego', 'Elena', 'Finn', 'Gia', 'Hugo', 'Ivy', 'Jules',
  'Kai', 'Lina', 'Milo', 'Nora', 'Omar', 'Pia', 'Quinn', 'Ravi', 'Sia', 'Theo',
  'Uma', 'Vera', 'Wes', 'Xena', 'Yuri', 'Zara', 'Arjun', 'Bella', 'Chen', 'Dara',
];

const LAST_NAMES = [
  'Shah', 'Nguyen', 'Patel', 'Kim', 'Garcia', 'Silva', 'Chen', 'Khan', 'Rossi',
  'Müller', 'Sato', 'Ali', 'Brown', 'Costa', 'Ivanov', 'Lee', 'Martin', 'Park',
];

export function generatePlayers(
  count: number,
  seed: number,
  splitCategories = false,
): SimPlayer[] {
  const rng = createRng(seed);
  const players: SimPlayer[] = [];

  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
    const rating = Math.floor(800 + rng() * 1200);
    let age: number;
    let category: SimCategory = 'open';

    if (splitCategories) {
      if (i < Math.ceil(count / 2)) {
        age = Math.floor(7 + rng() * 5); // 7–11
        category = 'under12';
      } else {
        age = Math.floor(12 + rng() * 6); // 12–17
        category = 'under18';
      }
    } else {
      age = Math.floor(8 + rng() * 10);
    }

    players.push({
      id: cryptoRandomId(rng, i),
      name: `${first} ${last}`,
      rating,
      seed: i + 1,
      age,
      gender: rng() > 0.5 ? 'M' : 'F',
      category,
    });
  }

  return players;
}

function cryptoRandomId(rng: () => number, index: number): string {
  const hex = () =>
    Math.floor(rng() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(1, 4)}-a${hex().slice(1, 4)}-${hex()}${index.toString(16).padStart(4, '0')}`;
}

function usesSeparatePools(config: SimulationState['config']): boolean {
  return config.splitCategories && !config.mixCategories;
}

export function createSimulation(config: SimulatorConfig): SimulationState {
  const seed = config.seed ?? Date.now() % 1_000_000;
  const splitCategories = config.splitCategories ?? false;
  const mixCategories = config.mixCategories ?? false;
  const players = generatePlayers(config.playerCount, seed, splitCategories);
  return {
    players,
    pastGames: [],
    pastGamesByCategory: {},
    roundsPlayed: [],
    currentRound: 0,
    pendingBoards: null,
    config: {
      rounds: config.rounds,
      resultMode: config.resultMode ?? 'rating_biased',
      seed,
      splitCategories,
      mixCategories,
    },
  };
}

function pairPool(
  players: SimPlayer[],
  pastGames: PastGame[],
  round: number,
  category: SimCategory,
  boardOffset: number,
): SimBoard[] {
  if (players.length < 2) return [];
  const { boards } = pairSwissRound({ players, pastGames, round });
  return boards.map((b) => ({
    ...b,
    board: b.board + boardOffset,
    category,
  }));
}

export function pairNextRound(state: SimulationState): SimulationState {
  if (state.pendingBoards) {
    throw new Error('Resolve pending results before pairing the next round');
  }
  if (state.currentRound >= state.config.rounds) {
    throw new Error('All rounds already paired');
  }

  const round = state.currentRound + 1;
  let pendingBoards: SimBoard[];

  if (usesSeparatePools(state.config)) {
    const categories: SimCategory[] = ['under12', 'under18'];
    const boards: SimBoard[] = [];
    let offset = 0;
    for (const cat of categories) {
      const pool = filterPlayersByCategory(state.players, cat);
      const past = state.pastGamesByCategory[cat] ?? [];
      const catBoards = pairPool(pool, past, round, cat, offset);
      boards.push(...catBoards);
      offset += catBoards.length;
    }
    pendingBoards = boards;
  } else {
    const { boards } = pairSwissRound({
      players: state.players,
      pastGames: state.pastGames,
      round,
    });
    pendingBoards = boards.map((b) => ({
      ...b,
      category: 'open' as SimCategory,
    }));
  }

  return {
    ...state,
    currentRound: round,
    pendingBoards,
  };
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function simulateResult(
  white: EnginePlayer,
  black: EnginePlayer | null,
  mode: ResultMode,
  rng: () => number,
): GameResult {
  if (!black) return 'bye';
  if (mode === 'manual') return 'pending';

  const wr = white.rating ?? 1500;
  const br = black.rating ?? 1500;

  if (mode === 'random') {
    const r = rng();
    if (r < 0.2) return '1/2-1/2';
    return r < 0.6 ? '1-0' : '0-1';
  }

  const pWhite = expectedScore(wr, br);
  const r = rng();
  const drawChance = 0.15;
  if (r < drawChance) return '1/2-1/2';
  const decisive = (r - drawChance) / (1 - drawChance);
  return decisive < pWhite ? '1-0' : '0-1';
}

export function applyPendingResults(
  state: SimulationState,
  overrides?: Array<{ board: number; result: GameResult }>,
): SimulationState {
  if (!state.pendingBoards) {
    throw new Error('No pending boards to apply results to');
  }

  const rng = createRng(state.config.seed + state.currentRound * 997);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const overrideMap = new Map((overrides ?? []).map((o) => [o.board, o.result]));

  const results: Array<{ board: number; result: GameResult }> = [];
  const newGames: PastGame[] = [];
  const byCategory: Partial<Record<SimCategory, PastGame[]>> = {
    ...Object.fromEntries(
      Object.entries(state.pastGamesByCategory).map(([k, v]) => [k, [...(v ?? [])]]),
    ),
  };

  for (const board of state.pendingBoards) {
    let result = overrideMap.get(board.board);
    if (!result) {
      const white = board.whiteId ? byId.get(board.whiteId) : undefined;
      const black = board.blackId ? byId.get(board.blackId) : null;
      if (board.isBye || !white) {
        result = 'bye';
      } else {
        result = simulateResult(white, black ?? null, state.config.resultMode, rng);
      }
    }

    results.push({ board: board.board, result });
    const game: PastGame = {
      round: state.currentRound,
      whiteId: board.whiteId,
      blackId: board.blackId,
      result,
      isBye: board.isBye,
    };
    newGames.push(game);
    const cat = board.category;
    byCategory[cat] = [...(byCategory[cat] ?? []), game];
  }

  return {
    ...state,
    pastGames: [...state.pastGames, ...newGames],
    pastGamesByCategory: byCategory,
    roundsPlayed: [
      ...state.roundsPlayed,
      { round: state.currentRound, boards: state.pendingBoards, results },
    ],
    pendingBoards: null,
  };
}

export function runAllRounds(state: SimulationState): SimulationState {
  let current = state;
  while (current.currentRound < current.config.rounds) {
    current = pairNextRound(current);
    current = applyPendingResults(current);
  }
  return current;
}

export type StandingRow = Standing & { category: SimCategory };

export function getSimulationStandings(
  state: SimulationState,
  category?: SimCategory,
): StandingRow[] {
  // Separate pools: each category has its own games.
  if (usesSeparatePools(state.config)) {
    const cats: SimCategory[] =
      category && category !== 'open' ? [category] : ['under12', 'under18'];
    const rows: StandingRow[] = [];
    for (const cat of cats) {
      const players = filterPlayersByCategory(state.players, cat);
      const past = state.pastGamesByCategory[cat] ?? [];
      const standings = computeStandings(players, past);
      rows.push(...standings.map((s) => ({ ...s, category: cat })));
    }
    return rows;
  }

  // Mixed pairing (or open): one field — optionally re-rank within a section.
  if (state.config.splitCategories && state.config.mixCategories) {
    const cats: SimCategory[] =
      category && category !== 'open' ? [category] : ['under12', 'under18'];
    const rows: StandingRow[] = [];
    for (const cat of cats) {
      const section = filterPlayersByCategory(state.players, cat);
      const ids = new Set(section.map((p) => p.id));
      const standings = computeSectionStandings(state.players, state.pastGames, ids);
      rows.push(...standings.map((s) => ({ ...s, category: cat })));
    }
    return rows;
  }

  return computeStandings(state.players, state.pastGames).map((s) => {
    const player = state.players.find((p) => p.id === s.id);
    return { ...s, category: player?.category ?? 'open' };
  });
}

export function getSimulationDiagnostics(state: SimulationState) {
  if (usesSeparatePools(state.config)) {
    // Diagnose each pool separately, then sum rematches
    let rematchCount = 0;
    const byeCounts: Record<string, number> = {};
    const colorImbalances: Array<{ id: string; name: string; imbalance: number }> = [];
    for (const cat of ['under12', 'under18'] as SimCategory[]) {
      const players = filterPlayersByCategory(state.players, cat);
      const past = state.pastGamesByCategory[cat] ?? [];
      const d = diagnosePairings(players, past);
      rematchCount += d.rematchCount;
      Object.assign(byeCounts, d.byeCounts);
      colorImbalances.push(...d.colorImbalances);
    }
    return { rematchCount, byeCounts, colorImbalances };
  }
  return diagnosePairings(state.players, state.pastGames);
}

/** Run a category-scoped simulation subset */
export function filterPlayersByCategory(
  players: SimPlayer[],
  category: SimCategory,
): SimPlayer[] {
  if (category === 'open') return players;
  return players.filter((p) => p.category === category);
}
