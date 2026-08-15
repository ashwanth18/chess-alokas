import type { CertificateRow } from './types.js';

export interface StandingLike {
  id: string;
  name: string;
  rank: number;
  score: number;
  rating?: number;
}

export interface ParticipantLike {
  id: string;
  name: string;
  age?: number;
  gender?: string | null;
  rating?: number | null;
  club?: string | null;
  email?: string | null;
  categoryIds?: string[];
}

export interface CategoryLike {
  id: string;
  name: string;
  prizePlaces?: number | null;
}

export function participantToRow(
  p: ParticipantLike,
  extras: Record<string, string | number | null | undefined> = {},
): CertificateRow {
  return {
    name: p.name,
    age: p.age ?? '',
    gender: p.gender ?? '',
    rating: p.rating ?? '',
    club: p.club ?? '',
    email: p.email ?? '',
    serial: extras.serial ?? '',
    ...extras,
  };
}

export function winnersFromStandings(
  standings: StandingLike[],
  topN: number,
): StandingLike[] {
  return standings.filter((s) => s.rank <= topN).sort((a, b) => a.rank - b.rank);
}

export function winnerToRow(
  s: StandingLike,
  extras: Record<string, string | number | null | undefined> = {},
): CertificateRow {
  return {
    name: s.name,
    rank: s.rank,
    score: s.score,
    rating: s.rating ?? '',
    place: ordinal(s.rank),
    serial: extras.serial ?? '',
    ...extras,
  };
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Collect unique column keys from rows for the designer palette. */
export function collectColumns(rows: CertificateRow[]): string[] {
  const keys = new Set<string>();
  if (rows.length > 0) keys.add('serial');
  for (const row of rows) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}
