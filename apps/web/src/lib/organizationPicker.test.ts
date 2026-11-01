import { describe, expect, it } from 'vitest';
import type { OrganizationMemberRole } from '@chess-alokas/shared';
import {
  creatableOrganizations,
  defaultTournamentOrganization,
  organizationCreateBlock,
  planLimitsSummary,
} from './organizationPicker';

const org = (id: string, memberRole: OrganizationMemberRole) => ({ id, memberRole });
const plan = (extra: Partial<Parameters<typeof planLimitsSummary>[0]> = {}) => ({
  planTier: 'trial' as const,
  verificationStatus: 'pending_review' as const,
  maxTournamentsQuota: 1,
  maxPlayersPerTournament: 24,
  eventCreditsRemaining: 0,
  trialEndsAt: null,
  ...extra,
});

describe('choosing an organization', () => {
  it('offers only organizations where the role can create tournaments', () => {
    const orgs = [org('a', 'arbiter'), org('b', 'director'), org('c', 'owner'), org('d', 'admin')];
    expect(creatableOrganizations(orgs).map((o) => o.id)).toEqual(['b', 'c', 'd']);
  });

  it('defaults to the highest role, then the first listed', () => {
    expect(defaultTournamentOrganization([org('a', 'director'), org('b', 'owner')])?.id).toBe('b');
    expect(defaultTournamentOrganization([org('a', 'admin'), org('b', 'admin')])?.id).toBe('a');
    expect(defaultTournamentOrganization([org('a', 'arbiter')])).toBeNull();
    expect(defaultTournamentOrganization([])).toBeNull();
  });
});

describe('plan limits', () => {
  it('describes each plan', () => {
    expect(planLimitsSummary(plan())).toBe('Sandbox Trial: 1 active tournament, up to 24 players each.');
    expect(
      planLimitsSummary(plan({ planTier: 'event_pass', maxPlayersPerTournament: null, eventCreditsRemaining: 2 })),
    ).toBe('Event Pass: up to 150 players per tournament, 2 event credits left.');
    expect(planLimitsSummary(plan({ planTier: 'pro' }))).toBe('Pro plan: no tournament or player limit.');
  });

  it('says when an organization cannot create at all', () => {
    expect(organizationCreateBlock(plan())).toBeNull();
    expect(organizationCreateBlock(plan({ verificationStatus: 'suspended' }))).toMatch(/suspended/);
    const now = new Date('2026-11-01T00:00:00Z');
    expect(organizationCreateBlock(plan({ trialEndsAt: '2026-10-01T00:00:00Z' }), now)).toMatch(/ended/);
    expect(organizationCreateBlock(plan({ trialEndsAt: '2026-12-01T00:00:00Z' }), now)).toBeNull();
    expect(planLimitsSummary(plan({ verificationStatus: 'rejected' }))).toMatch(/cannot create/);
  });
});
