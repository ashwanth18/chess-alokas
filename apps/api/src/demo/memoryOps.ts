import type {
  Organization,
  OrganizationMemberRole,
  PlayerProfile,
  Tournament,
} from '@chess-alokas/shared';
import { DEMO_ORG_SLUG, assertDemoScope, assertRealCountsUnchanged } from './constants.js';
import type {
  DemoAccount,
  DemoCleared,
  DemoOps,
  DemoOrganization,
  DemoPlan,
  DemoScopeFacts,
  DemoWriteResult,
} from './types.js';

type TournamentRows = Map<string, { tournamentId: string }>;

/** The parts of MemoryStore this works on. They stay private to everything else. */
export interface MemoryStoreInternals {
  tournaments: Map<string, Tournament>;
  organizations: Map<string, DemoOrganization>;
  organizationMembers: Map<
    string,
    {
      organizationId: string;
      userId: string;
      role: OrganizationMemberRole;
      createdAt: string;
      email?: string | null;
      accessChangedAt?: string;
    }
  >;
  organizationInvites: Map<string, { organizationId: string }>;
  playerProfiles: Map<string, PlayerProfile>;
  participants: Map<string, { tournamentId: string; playerProfileId?: string | null }>;
  categories: TournamentRows;
  games: TournamentRows;
  tables: TournamentRows;
  gameCards: TournamentRows;
  registrations: Map<
    string,
    { tournamentId: string; receiptStoragePath?: string | null; privateFiles?: unknown }
  >;
  certificateIssues: Map<string, { tournamentId: string; storagePath?: string | null }>;
  floorAlerts: TournamentRows;
  pinMeta: Map<string, { hash: string; round: number }>;
  resultEvents: Array<{ tournamentId: string }>;
}

export function createMemoryDemoOps(store: MemoryStoreInternals): DemoOps {
  const accounts = new Map<string, DemoAccount>();

  const flagged = () => [...store.organizations.values()].filter((o) => o.isDemo === true);

  const isDemoTournament = (t: Tournament): boolean => {
    if (t.organizationId) return Boolean(store.organizations.get(t.organizationId)?.isDemo);
    return Boolean(t.ownerId && accounts.has(t.ownerId));
  };

  const facts = (): DemoScopeFacts => {
    const orgs = flagged();
    const orgIds = new Set(orgs.map((o) => o.id));
    const foreign = new Set<string>();
    for (const m of store.organizationMembers.values()) {
      if (orgIds.has(m.organizationId) && !accounts.has(m.userId)) foreign.add(m.userId);
    }
    for (const o of orgs) {
      if (o.createdBy && !accounts.has(o.createdBy)) foreign.add(o.createdBy);
    }
    const demoProfiles = new Set(
      [...store.playerProfiles.values()]
        .filter((p) => accounts.has(p.accountUserId))
        .map((p) => p.id),
    );
    let links = 0;
    for (const part of store.participants.values()) {
      if (!part.playerProfileId || !demoProfiles.has(part.playerProfileId)) continue;
      const t = store.tournaments.get(part.tournamentId);
      if (t && !isDemoTournament(t)) links += 1;
    }
    return {
      flaggedOrganizations: orgs.map((o) => ({ id: o.id, slug: o.slug })),
      unflaggedSlugHolder: [...store.organizations.values()].some(
        (o) => !o.isDemo && o.slug.toLowerCase() === DEMO_ORG_SLUG,
      ),
      foreignMembers: foreign.size,
      foreignProfileLinks: links,
    };
  };

  const realCounts = (): Record<string, number> => {
    const realTournamentIds = new Set(
      [...store.tournaments.values()].filter((t) => !isDemoTournament(t)).map((t) => t.id),
    );
    const inReal = (map: Map<string, { tournamentId: string }>) =>
      [...map.values()].filter((row) => realTournamentIds.has(row.tournamentId)).length;
    return {
      organizations: [...store.organizations.values()].filter((o) => !o.isDemo).length,
      tournaments: realTournamentIds.size,
      participants: inReal(store.participants),
      games: inReal(store.games),
      registrations: inReal(store.registrations),
      playerProfiles: [...store.playerProfiles.values()].filter((p) => !accounts.has(p.accountUserId))
        .length,
    };
  };

  function clear(removeTenant: boolean, nowIso: string): DemoCleared {
    const scope = facts();
    assertDemoScope(scope);
    const orgId = scope.flaggedOrganizations[0]?.id ?? null;

    const tournaments = [...store.tournaments.values()].filter(isDemoTournament);
    const ids = new Set(tournaments.map((t) => t.id));
    const receiptPaths: string[] = [];
    const certificatePaths: string[] = [];

    for (const [key, reg] of store.registrations) {
      if (!ids.has(reg.tournamentId)) continue;
      if (reg.receiptStoragePath) receiptPaths.push(reg.receiptStoragePath);
      if (Array.isArray(reg.privateFiles)) {
        for (const file of reg.privateFiles as Array<{ storagePath?: string }>) {
          if (file.storagePath) receiptPaths.push(file.storagePath);
        }
      }
      store.registrations.delete(key);
    }
    for (const [key, issue] of store.certificateIssues) {
      if (!ids.has(issue.tournamentId)) continue;
      if (issue.storagePath) certificatePaths.push(issue.storagePath);
      store.certificateIssues.delete(key);
    }
    for (const map of [
      store.categories,
      store.participants,
      store.games,
      store.tables,
      store.gameCards,
      store.floorAlerts,
    ] as TournamentRows[]) {
      for (const [key, row] of map) {
        if (ids.has(row.tournamentId)) map.delete(key);
      }
    }
    store.resultEvents = store.resultEvents.filter((e) => !ids.has(e.tournamentId));
    for (const id of ids) store.pinMeta.delete(id);

    for (const t of tournaments) {
      store.tournaments.delete(t.id);
      if (removeTenant) continue;
      store.tournaments.set(t.id, {
        id: t.id,
        name: t.name,
        style: t.style,
        rounds: t.rounds,
        status: 'draft',
        currentRound: 0,
        ownerId: t.ownerId ?? null,
        organizationId: t.organizationId ?? null,
        updatedAt: nowIso,
        deletedAt: t.deletedAt ?? nowIso,
      } as Tournament);
    }

    let profilesRemoved = 0;
    for (const [key, profile] of store.playerProfiles) {
      if (accounts.has(profile.accountUserId)) {
        store.playerProfiles.delete(key);
        profilesRemoved += 1;
      }
    }

    if (orgId) {
      for (const [key, invite] of store.organizationInvites) {
        if (invite.organizationId === orgId) store.organizationInvites.delete(key);
      }
      for (const [key, m] of store.organizationMembers) {
        if (m.organizationId === orgId) store.organizationMembers.delete(key);
      }
      if (removeTenant) store.organizations.delete(orgId);
    }

    return {
      tournamentsRemoved: tournaments.filter((t) => !t.deletedAt).length,
      profilesRemoved,
      receiptPaths,
      certificatePaths,
    };
  }

  function write(plan: DemoPlan, nowIso: string): void {
    const existing = store.organizations.get(plan.organization.id);
    const org: Organization & { isDemo: boolean } = {
      ...plan.organization,
      isDemo: true,
      // The listing switch is the founder's choice, so a reset leaves it as it was.
      canPublishGlobal: existing ? existing.canPublishGlobal : plan.organization.canPublishGlobal,
    };
    store.organizations.set(org.id, org);
    for (const m of plan.members) {
      store.organizationMembers.set(`${org.id}:${m.userId}`, {
        organizationId: org.id,
        userId: m.userId,
        role: m.role,
        createdAt: nowIso,
        email: m.email.toLowerCase(),
        accessChangedAt: nowIso,
      });
    }
    for (const p of plan.profiles) store.playerProfiles.set(p.id, p);
    for (const t of plan.tournaments) {
      store.tournaments.set(t.tournament.id, t.tournament);
      if (t.tournament.arbiterPinHash && t.tournament.arbiterPinRound != null) {
        store.pinMeta.set(t.tournament.id, {
          hash: t.tournament.arbiterPinHash,
          round: t.tournament.arbiterPinRound,
        });
      }
      for (const row of t.categories) store.categories.set(row.id, row);
      for (const row of t.participants) store.participants.set(row.id, row);
      for (const row of t.games) store.games.set(row.id, row);
      store.resultEvents.push(...t.resultEvents);
      for (const row of t.cards) store.gameCards.set(row.id, row);
      for (const row of t.tables) store.tables.set(row.id, row);
      for (const row of t.alerts) store.floorAlerts.set(row.id, row);
      for (const row of t.registrations) store.registrations.set(row.id, row);
      for (const row of t.certificates) store.certificateIssues.set(row.id, row);
    }
  }

  return {
    async isAccount(userId) {
      return accounts.has(userId);
    },

    async listAccounts() {
      return [...accounts.values()];
    },

    async registerAccount(account) {
      accounts.set(account.userId, account);
    },

    async forgetAccounts() {
      accounts.clear();
    },

    async setCredentialsUnlocked() {
      // There is no sign-in row in memory to protect.
    },

    async getOrganization() {
      return flagged()[0] ?? null;
    },

    async setPubliclyListed(listed) {
      const org = flagged().find((o) => o.slug === DEMO_ORG_SLUG);
      if (!org) return false;
      store.organizations.set(org.id, { ...org, canPublishGlobal: listed });
      return true;
    },

    async scopeFacts() {
      return facts();
    },

    async capabilities() {
      return { formBuilder: true, credentialLock: false };
    },

    async realCounts() {
      return realCounts();
    },

    async apply(plan, options): Promise<DemoWriteResult> {
      const nowIso = new Date().toISOString();
      const before = realCounts();
      if (options?.dryRun) {
        assertDemoScope(facts());
        return {
          cleared: { tournamentsRemoved: 0, profilesRemoved: 0, receiptPaths: [], certificatePaths: [] },
          skippedColumns: [],
          realCounts: before,
          rolledBack: true,
        };
      }
      const cleared = clear(false, nowIso);
      write(plan, nowIso);
      const after = realCounts();
      assertRealCountsUnchanged(before, after);
      return { cleared, skippedColumns: [], realCounts: after, rolledBack: false };
    },

    async removeAll() {
      const before = realCounts();
      const cleared = clear(true, new Date().toISOString());
      assertRealCountsUnchanged(before, realCounts());
      return cleared;
    },
  };
}
