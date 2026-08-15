import type { PlayerId } from '../swiss.js';

export type Color = 'W' | 'B';
export type ColorPrefKind = 'absolute' | 'strong' | 'mild' | 'none';
export type FloatDir = 'up' | 'down';

export interface DutchPlayer {
  id: PlayerId;
  name: string;
  rating: number;
  tpn: number;
  score: number;
  opponents: Set<PlayerId>;
  playedColors: Color[];
  colorDiff: number;
  pref: Color | null;
  prefKind: ColorPrefKind;
  hadPab: boolean;
  hadForfeitWin: boolean;
  unplayedCount: number;
  /** One entry per completed round; null = no float that round. */
  floats: Array<FloatDir | null>;
  topscorer: boolean;
}

export interface DutchPair {
  a: DutchPlayer;
  b: DutchPlayer;
}

export interface DutchContext {
  initialColor: Color;
  totalRounds: number | null;
  pairingRound: number;
  allowRematch: boolean;
  matchMemo?: Map<string, boolean>;
}

/** Lower is better; compared lexicographically. */
export type Quality = number[];

export interface BracketCandidate {
  pairs: DutchPair[];
  downfloaters: DutchPlayer[];
  quality: Quality;
}
