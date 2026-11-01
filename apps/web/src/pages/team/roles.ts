import type { OrganizationMemberRole } from '@chess-alokas/shared';

export const ROLES: OrganizationMemberRole[] = ['owner', 'admin', 'director', 'arbiter'];

export const ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  director: 'Director',
  arbiter: 'Arbiter',
};

/** Matches what the API allows: see routes/team.ts and routes/floor.ts. */
export const ROLE_DESCRIPTIONS: Record<OrganizationMemberRole, string> = {
  owner: 'Runs everything, including who is on the team and who else is an owner.',
  admin: 'Runs tournaments and manages the team, but cannot change owners.',
  director: 'Creates and runs tournaments: players, pairings, results and certificates.',
  arbiter: 'Works the floor: table links, the scoring PIN and arbiter calls. Cannot see player records.',
};
