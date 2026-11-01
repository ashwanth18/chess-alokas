import type { LocalGame, LocalParticipant } from '../db/local';

export type PlayerDraft = {
  name: string;
  yearOfBirth: string;
  gender: string;
  rating: string;
  fideId: string;
  school: string;
  club: string;
  email: string;
  categoryIds: string[];
};

export function draftFromPlayer(p?: LocalParticipant | null): PlayerDraft {
  return {
    name: p?.name ?? '',
    yearOfBirth: p?.yearOfBirth != null ? String(p.yearOfBirth) : '',
    gender: p?.gender ?? '',
    rating: p?.rating != null && p.rating > 0 ? String(p.rating) : '',
    fideId: p?.fideId != null && p.fideId > 0 ? String(p.fideId) : '',
    school: p?.school ?? '',
    club: p?.club ?? '',
    email: p?.email ?? '',
    categoryIds: p?.categoryIds ?? [],
  };
}

export function validatePlayerDraft(d: PlayerDraft, now = new Date()): string | null {
  if (!d.name.trim()) return 'Player name is required.';
  if (d.yearOfBirth.trim()) {
    const y = Number(d.yearOfBirth);
    if (!Number.isInteger(y) || y < 1920 || y > now.getFullYear()) {
      return `Year of birth must be between 1920 and ${now.getFullYear()}.`;
    }
  }
  if (d.rating.trim() && !(Number(d.rating) > 0)) return 'Rating must be a positive number.';
  if (d.fideId.trim() && !/^\d+$/.test(d.fideId.trim())) return 'FIDE ID must be digits only.';
  if (d.email.trim() && !/^\S+@\S+\.\S+$/.test(d.email.trim())) return 'Enter a valid email.';
  return null;
}

/** Fields written to Dexie; the caller adds id, tournamentId, updatedAt and dirty. */
export function draftToFields(d: PlayerDraft, previousAge = 0, now = new Date()) {
  const yob = d.yearOfBirth.trim() ? Number(d.yearOfBirth) : null;
  return {
    name: d.name.trim(),
    yearOfBirth: yob,
    age: yob != null ? Math.max(0, now.getFullYear() - yob) : previousAge,
    gender: d.gender.trim() || null,
    rating: d.rating.trim() ? Number(d.rating) : null,
    fideId: d.fideId.trim() ? Number(d.fideId) : null,
    school: d.school.trim() || null,
    club: d.club.trim() || null,
    email: d.email.trim() || null,
    categoryIds: d.categoryIds,
  };
}

/**
 * A player who appears on any board cannot be removed: it would orphan the opponent's game and
 * change tiebreaks. Withdraw keeps the history. Returns the round to mention, or null if free.
 */
export function roundBlockingDelete(
  playerId: string,
  games: Pick<LocalGame, 'round' | 'whiteId' | 'blackId' | 'deletedAt'>[],
): number | null {
  let first: number | null = null;
  for (const g of games) {
    if (g.deletedAt) continue;
    if (g.whiteId === playerId || g.blackId === playerId) {
      if (first == null || g.round < first) first = g.round;
    }
  }
  return first;
}
