import type {
  ArbiterScorableResult,
  PlayerCardCounts,
  TournamentTable,
} from '@chess-alokas/shared';

export type FloorTableView = {
  slug: string;
  tableNumber: number;
  tournamentName: string;
  tournamentId: string;
  pinRound: number | null;
  round: number | null;
  gameId: string | null;
  whiteId: string | null;
  blackId: string | null;
  whiteName: string | null;
  blackName: string | null;
  status: 'needs_pin' | 'pending' | 'locked' | 'bye' | 'no_game' | 'confirmed_closed';
  result: string | null;
  sessionOk: boolean;
  whiteCards: PlayerCardCounts;
  blackCards: PlayerCardCounts;
  forfeitReason: string | null;
};

export type EnsureTablesResult = {
  tables: TournamentTable[];
  tableCount: number;
  arbiterPin: string;
  arbiterPinRound: number;
};

export type SubmitFloorResultBody = {
  result: ArbiterScorableResult;
  confirm: true;
};
