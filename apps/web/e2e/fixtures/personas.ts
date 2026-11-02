import { USER_ID } from './data';

/** Who is signed in, as the API tells it. Invented names only, like the rest of the fixtures. */
export type Persona = {
  organizations: unknown[];
  accountRole: 'participant' | 'organizer' | 'both' | null;
  profiles: unknown[];
};

const AT = '2026-01-01T00:00:00.000Z';

const organization = (id: number, memberRole: string) => ({
  id: `44444444-4444-4444-8444-44444444444${id}`,
  name: id === 1 ? 'Imaginary Bay Chess Academy' : 'Fianchetto Heights Chess Club',
  slug: `imaginary-org-${id}`,
  verificationStatus: 'verified',
  planTier: 'pro',
  eventCreditsRemaining: 0,
  canPublishGlobal: true,
  canAcceptPaidRegistrations: false,
  createdAt: AT,
  updatedAt: AT,
  memberRole,
});

const profile = {
  id: '55555555-5555-4555-8555-555555555551',
  accountUserId: USER_ID,
  isPrimary: true,
  relationship: 'self',
  fullName: 'Parent Rook',
  alokasRating: 1000,
  createdAt: AT,
  updatedAt: AT,
};

export const PERSONAS = {
  /** No organization, ordinary account. */
  player: { organizations: [], accountRole: 'participant', profiles: [profile] },
  /** Runs an organization and has never added a player. */
  organizer: { organizations: [organization(1, 'owner')], accountRole: 'both', profiles: [] },
  /** Left their organization, so only the account role says they organize. */
  roleOnly: { organizations: [], accountRole: 'organizer', profiles: [] },
  /** Runs an organization and has a player profile. */
  both: { organizations: [organization(1, 'owner')], accountRole: 'both', profiles: [profile] },
  /** Member of one organization, as an arbiter. */
  arbiter: { organizations: [organization(1, 'arbiter')], accountRole: 'both', profiles: [] },
  /** An arbiter in one place and a director in another isn't arbiter-only. */
  arbiterAndDirector: {
    organizations: [organization(1, 'arbiter'), organization(2, 'director')],
    accountRole: 'both',
    profiles: [],
  },
} satisfies Record<string, Persona>;

export const emptyDashboard = (profiles: unknown[]) => ({
  profiles,
  selectedProfile: profiles[0] ?? null,
  liveMatches: [],
  stats: { tournamentsCount: 0, gamesPlayed: 0, wins: 0, draws: 0, losses: 0, totalPoints: 0 },
  tournaments: [],
  certificates: [],
});
