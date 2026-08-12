export type FideRatingType = 'standard' | 'rapid' | 'blitz';

export type FidePlayerRow = {
  fideId: number;
  name: string;
  federation: string | null;
  birthYear: number | null;
  title: string | null;
  sex: string | null;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  inactive: boolean;
};

export type FideLookupPlayerIn = {
  id: string;
  name: string;
  country?: string | null;
  yearOfBirth?: number | null;
  fideId?: number | null;
};

export type FideMatchStatus = 'exact' | 'unique' | 'ambiguous' | 'not_found';

export type FideLookupResult = {
  participantId: string;
  status: FideMatchStatus;
  selectedFideId: number | null;
  candidates: FidePlayerRow[];
};
