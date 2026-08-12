export {
  pairSwissRound,
  buildPlayerStates,
  computeStandings,
  computeSectionStandings,
  computeEndRankMap,
  diagnosePairings,
  colorPreference,
  colorImbalance,
  type EnginePlayer,
  type PastGame,
  type PairingBoard,
  type PairingInput,
  type PairingOutput,
  type PlayerState,
  type PlayerId,
  type Standing,
  type StandingRowMetrics,
  type StandingsOptions,
  firstRoundMissingResults,
} from './swiss.js';

export {
  compareRosterOrder,
  sortRoster,
  assignStartRanks,
  withStartRanks,
  computeStartRankMap,
} from './roster.js';

export {
  pairRound,
  STYLE_META,
  UnsupportedPairingStyleError,
} from './registry.js';

export {
  createSimulation,
  generatePlayers,
  pairNextRound,
  applyPendingResults,
  runAllRounds,
  getSimulationStandings,
  getSimulationDiagnostics,
  filterPlayersByCategory,
  createRng,
  simulateResult,
  expectedScore,
  type SimulatorConfig,
  type SimPlayer,
  type SimRound,
  type SimBoard,
  type SimCategory,
  type SimulationState,
  type StandingRow,
  type ResultMode,
} from './simulator.js';
