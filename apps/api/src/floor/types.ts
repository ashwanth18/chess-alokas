import type { ArbiterScorableResult, TournamentTable } from '@chess-alokas/shared';

export type FloorTableView = {
  slug: string;
  tableNumber: number;
  tournamentName: string;
  tournamentId: string;
  pinRound: number | null;
  round: number | null;
  whiteName: string | null;
  blackName: string | null;
  status: 'needs_pin' | 'pending' | 'locked' | 'bye' | 'no_game' | 'confirmed_closed';
  result: string | null;
  sessionOk: boolean;
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
