import type { PlayerRelationship } from './types.js';

/**
 * Recorded with each consent, so a record says which notice the person saw. Change it whenever the
 * Privacy Policy changes in a way that matters to a consent. A test keeps it equal to the page's date.
 */
export const PRIVACY_NOTICE_VERSION = '2026-11-02';

/**
 * Not enforced today: the forms show a notice and the API takes every request. These and
 * guardianConsentRequired stay for the stricter rules in docs/PLAN.md, "Later: stricter privacy".
 */
export const GUARDIAN_CONSENT_ERROR_CODE = 'guardian_consent_required';
export const ROSTER_CONSENT_ERROR_CODE = 'roster_consent_required';

export interface PlayerAgeFacts {
  /** Absent for a form with no saved profile behind it. */
  relationship?: PlayerRelationship | null;
  age?: number | null;
  yearOfBirth?: number | null;
  dateOfBirth?: string | null;
}

/** True, false, or null when nothing says how old the player is. Self-reported, never verified. */
export function isUnder18(facts: PlayerAgeFacts, now: Date = new Date()): boolean | null {
  const dob = facts.dateOfBirth ? new Date(facts.dateOfBirth) : null;
  if (dob && !Number.isNaN(dob.getTime())) {
    const eighteenth = new Date(dob);
    eighteenth.setFullYear(dob.getFullYear() + 18);
    return now < eighteenth;
  }
  const known = [];
  if (facts.age != null) known.push(facts.age < 18);
  // A year alone can't tell whether this year's birthday has passed, so someone turning 18 this
  // year counts as under 18. The cost of being wrong is one extra checkbox.
  if (facts.yearOfBirth != null) known.push(now.getFullYear() - facts.yearOfBirth <= 18);
  if (known.length === 0) return null;
  return known.some(Boolean);
}

/**
 * Whether a parent or guardian's consent would be needed before saving this player. Web uses it
 * to decide which profiles show the notice. The API does not refuse on it.
 * - A child profile always needs it.
 * - A person's own profile needs it only if it says they are under 18: sign-up creates one with
 *   only a name, and asking every adult would make the question meaningless.
 * - Anything else needs it unless the age shows an adult, so leaving the age out can't avoid it.
 */
export function guardianConsentRequired(facts: PlayerAgeFacts, now: Date = new Date()): boolean {
  if (facts.relationship === 'child') return true;
  const under18 = isUnder18(facts, now);
  if (facts.relationship === 'self') return under18 === true;
  return under18 !== false;
}

/** Replaces the name on a registration no result depends on, after its submitter deletes their account. */
export const DELETED_PLAYER_NAME = 'Deleted player';
