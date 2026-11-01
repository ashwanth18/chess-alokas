import {
  canRunTournaments,
  defaultTournamentOrganization,
  type Organization,
  type OrganizationMemberRole,
} from '@chess-alokas/shared';

export { defaultTournamentOrganization };

/** The API decides; this only stops the form offering what it would refuse. */
export function creatableOrganizations<T extends { memberRole: OrganizationMemberRole }>(
  orgs: T[],
): T[] {
  return orgs.filter((o) => canRunTournaments(o.memberRole));
}

type PlanFields = Pick<
  Organization,
  | 'planTier'
  | 'verificationStatus'
  | 'maxTournamentsQuota'
  | 'maxPlayersPerTournament'
  | 'eventCreditsRemaining'
  | 'trialEndsAt'
>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Why the API would refuse a new tournament here whatever the count, or null. */
export function organizationCreateBlock(org: PlanFields, now = new Date()): string | null {
  if (org.verificationStatus === 'suspended' || org.verificationStatus === 'rejected') {
    return 'This organization is suspended or rejected and cannot create tournaments.';
  }
  if (org.planTier === 'trial' && org.trialEndsAt && Date.parse(org.trialEndsAt) < now.getTime()) {
    return 'This organization’s Sandbox Trial has ended. Request verification to create more tournaments.';
  }
  return null;
}

/** Matches playerLimitFor and the trial quota in apps/api/src/db.ts. */
export function planLimitsSummary(org: PlanFields, now = new Date()): string {
  const blocked = organizationCreateBlock(org, now);
  if (blocked) return blocked;
  if (org.planTier === 'trial') {
    const tournaments = org.maxTournamentsQuota;
    const players = org.maxPlayersPerTournament;
    const limits = [
      tournaments != null ? plural(tournaments, 'active tournament') : 'unlimited tournaments',
      players != null ? `up to ${plural(players, 'player')} each` : 'no player limit',
    ];
    return `Sandbox Trial: ${limits.join(', ')}.`;
  }
  if (org.planTier === 'event_pass') {
    const players = Math.min(org.maxPlayersPerTournament ?? 150, 150);
    return `Event Pass: up to ${plural(players, 'player')} per tournament, ${plural(org.eventCreditsRemaining ?? 0, 'event credit')} left.`;
  }
  return `${org.planTier === 'enterprise' ? 'Enterprise' : 'Pro'} plan: no tournament or player limit.`;
}
