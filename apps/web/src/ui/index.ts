/** The Pairing Sheet component set. Guide: docs/design/COMPONENTS.md. Must never import Dexie. */
export { PlayerName, type PlayerNameProps } from './PlayerName';
export { displayName, findLookalikes, formatDisambiguator, nameParts } from './names';
export { formatPoints, resultSpoken, resultText, type ResultCode } from './results';
export { describeAsOf, describeSync, formatClock, type SyncFacts } from './sync';
export {
  AsOf,
  Button,
  buttonClass,
  Field,
  Marker,
  Piece,
  Result,
  Sheet,
  StatusLine,
  type ButtonSize,
  type ButtonVariant,
  type PieceColor,
} from './primitives';
export {
  PairingTable,
  type PairingBoard,
  type PairingPlayer,
  type PairingSection,
  type PairingTableProps,
} from './PairingTable';
export * from './icons';
