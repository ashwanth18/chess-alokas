import type { GameResult } from '@chess-alokas/shared';
import {
  computeStandings,
  diagnosePairings,
  pairSwissRound,
  type EnginePlayer,
  type PastGame,
  type PairingBoard,
} from './swiss.js';

export type ResultMode = 'random' | 'rating_biased' | 'manual';

export interface SimulatorConfig {
  playerCount: number;
  rounds: number;
  seed?: number;
  /** Split into under12 / under18 by age for category demos */
  splitCategories?: boolean;
  resultMode?: ResultMode;
}

export interface SimPlayer extends EnginePlayer {
  age: number;
  gender?: string;
  category: 'under12' | 'under18' | 'open';
}

export interface SimRound {
  round: number;
  boards: PairingBoard[];
  results: Array<{ board: number; result: GameResult }>;
}

export interface SimulationState {
  players: SimPlayer[];
  pastGames: PastGame[];
  roundsPlayed: SimRound[];
  currentRound: number;
  pendingBoards: PairingBoard[] | null;
  config: Required<Pick<SimulatorConfig, 'rounds' | 'resultMode'>> & {
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
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
    const rating = Math.floor(800 + rng() * 1200);
    let age: number;
    let category: SimPlayer['category'] = 'open';

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
  // Deterministic UUID-like id from seed
  const hex = () =>
    Math.floor(rng() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(1, 4)}-a${hex().slice(1, 4)}-${hex()}${index.toString(16).padStart(4, '0')}`;
}

export function createSimulation(config: SimulatorConfig): SimulationState {
  const seed = config.seed ?? Date.now() % 1_000_000;
  const players = generatePlayers(
    config.playerCount,
    seed,
    config.splitCategories ?? false,
  );
  return {
    players,
    pastGames: [],
    roundsPlayed: [],
    currentRound: 0,
    pendingBoards: null,
    config: {
      rounds: config.rounds,
      resultMode: config.resultMode ?? 'rating_biased',
      seed,
    },
  };
}

export function pairNextRound(state: SimulationState): SimulationState {
  if (state.pendingBoards) {
    throw new Error('Resolve pending results before pairing the next round');
  }
  if (state.currentRound >= state.config.rounds) {
    throw new Error('All rounds already paired');
  }

  const round = state.currentRound + 1;
  const { boards } = pairSwissRound({
    players: state.players,
    pastGames: state.pastGames,
    round,
  });

  return {
    ...state,
    currentRound: round,
    pendingBoards: boards,
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

  // rating_biased
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
    newGames.push({
      round: state.currentRound,
      whiteId: board.whiteId,
      blackId: board.blackId,
      result,
      isBye: board.isBye,
    });
  }

  return {
    ...state,
    pastGames: [...state.pastGames, ...newGames],
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

export function getSimulationStandings(state: SimulationState) {
  return computeStandings(state.players, state.pastGames);
}

export function getSimulationDiagnostics(state: SimulationState) {
  return diagnosePairings(state.players, state.pastGames);
}

/** Run a category-scoped simulation subset */
export function filterPlayersByCategory(
  players: SimPlayer[],
  category: 'under12' | 'under18' | 'open',
): SimPlayer[] {
  if (category === 'open') return players;
  return players.filter((p) => p.category === category);
}
