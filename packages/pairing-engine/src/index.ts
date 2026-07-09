export {
  pairSwissRound,
  buildPlayerStates,
  computeStandings,
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
} from './swiss.js';

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
  type SimulationState,
  type ResultMode,
} from './simulator.js';
