import postgres, { type Sql } from 'postgres';
import {
  Tournament,
  TournamentTable,
  Category,
  Participant,
  Game,
  GameCard,
  GameCardType,
  SyncPushItem,
  FilterGroup,
  TournamentStyle,
  TournamentStatus,
  GameResult,
  Organization,
  OrganizationMemberRole,
  OrganizationVerificationStatus,
  OrganizationPlanTier,
  AdminOrganizationRow,
  PlayerProfile,
  PlayerRelationship,
  PlayerCareerDashboard,
  PlayerLiveMatchCard,
  PlayerTournamentHistoryItem,
  PlayerCertificateItem,
  CertificateIssue,
  CertificateIssueType,
  TournamentRegistration,
  RegistrationFormConfig,
  RegistrationPaymentStatus,
  RegistrationPlayerSnapshot,
  RegistrationStatus,
  PublicEventSummary,
  FloorAlert,
  DEFAULT_REGISTRATION_FORM_CONFIG,
  assignCategories,
  haversineDistanceKm,
  certificateYear,
  DEFAULT_CERT_SERIAL_PAD,
  DEFAULT_CERT_SERIAL_PREFIX,
  formatCertificateSerial,
  normalizeExcludedRounds,
} from '@chess-alokas/shared';
import { generateTableSlug } from './floor/pin.js';
import {
  runSyncPush,
  type GameWriteApply,
  type SyncBackend,
  type SyncPushOptions,
  type SyncPushResult,
  type SyncResultEvent,
} from './lib/syncEngine.js';

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export interface UpdateTournamentOptions {
  /** Charge this organization one Event Pass credit, unless the event already used one. */
  chargeEventCreditTo?: string;
}

export interface EmailSendReservation {
  kind: 'test' | 'bulk';
  scopeKey: string;
  count: number;
  limit: number;
  tournamentId?: string | null;
  userId?: string | null;
}

export interface EmailSendQuota {
  allowed: boolean;
  used: number;
  limit: number;
}

export interface SyncPullResult {
  tournaments: Tournament[];
  categories: Category[];
  participants: Participant[];
  games: Game[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface Store {
  // Tournaments
  listTournaments(ownerId?: string | null): Promise<Tournament[]>;
  getTournament(id: string): Promise<Tournament | null>;
  getTournamentByPublicToken(token: string): Promise<Tournament | null>;
  createTournament(t: Tournament): Promise<Tournament>;
  updateTournament(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
    options?: UpdateTournamentOptions,
  ): Promise<Tournament | null>;
  isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean>;

  // Categories
  listCategories(tournamentId: string, includeDeleted?: boolean): Promise<Category[]>;
  getCategory(id: string): Promise<Category | null>;
  createCategory(c: Category): Promise<Category>;
  updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<Category | null>;

  // Participants
  listParticipants(tournamentId: string, includeDeleted?: boolean): Promise<Participant[]>;
  getParticipant(id: string): Promise<Participant | null>;
  createParticipant(p: Participant): Promise<Participant>;
  upsertParticipants(participants: Participant[]): Promise<Participant[]>;
  softDeleteParticipantsByTournament(tournamentId: string): Promise<void>;

  // Games
  listGames(tournamentId: string, filters?: { round?: number; categoryId?: string }): Promise<Game[]>;
  getGame(id: string): Promise<Game | null>;
  createGame(g: Game): Promise<Game>;
  updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null>;
  /**
   * Set a game result with attribution + audit event.
   * Director overrides bump resultOverrideCount when previous result was entered.
   */
  recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
      /** Throw a 409 unless the game is still pending and unlocked (floor entry). */
      onlyIfOpen?: boolean;
    },
  ): Promise<Game | null>;
  softDeleteGamesForRound(tournamentId: string, round: number, categoryId: string): Promise<void>;

  // Floor arbiter tables
  getTableBySlug(slug: string): Promise<TournamentTable | null>;
  listTables(tournamentId: string): Promise<TournamentTable[]>;
  ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]>;
  setArbiterPin(tournamentId: string, pinHash: string, pinRound: number): Promise<Tournament | null>;
  getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }>;
  findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null>;

  /** Atomically reserve the next N certificate serials for this tournament. */
  allocateCertificateSerials(tournamentId: string, count: number): Promise<string[]>;

  // Discipline cards (yellow/red)
  listGameCards(gameId: string, includeDeleted?: boolean): Promise<GameCard[]>;
  listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]>;
  createGameCard(card: GameCard): Promise<GameCard>;
  softDeleteGameCard(id: string): Promise<GameCard | null>;

  // Sync
  pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult>;
  pushSync(
    items: SyncPushItem[],
    ownerId?: string | null,
    options?: SyncPushOptions,
  ): Promise<SyncPushResult>;

  // Organizations (B2B multi-tenant)
  listUserOrganizations(
    userId: string,
  ): Promise<Array<Organization & { memberRole: OrganizationMemberRole }>>;
  getOrganization(id: string): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  isOrganizationMember(
    organizationId: string,
    userId: string,
    roles?: OrganizationMemberRole[],
  ): Promise<boolean>;
  createOrganization(org: Organization, ownerUserId: string): Promise<Organization>;
  updateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'name'
        | 'slug'
        | 'logoUrl'
        | 'description'
        | 'website'
        | 'contactEmail'
        | 'contactPhone'
        | 'city'
        | 'state'
        | 'country'
        | 'paymentInstructions'
        | 'paymentQrStoragePath'
      >
    >,
  ): Promise<Organization | null>;
  listAllOrganizationsForAdmin(): Promise<AdminOrganizationRow[]>;
  adminUpdateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'verificationStatus'
        | 'planTier'
        | 'trialEndsAt'
        | 'maxTournamentsQuota'
        | 'maxPlayersPerTournament'
        | 'eventCreditsRemaining'
        | 'canPublishGlobal'
        | 'canAcceptPaidRegistrations'
        | 'verifiedAt'
        | 'verifiedBy'
      >
    >,
  ): Promise<Organization | null>;

  // Player Profiles (B2C global participant & family profiles)
  listPlayerProfiles(accountUserId: string): Promise<PlayerProfile[]>;
  getPlayerProfile(id: string): Promise<PlayerProfile | null>;
  createPlayerProfile(profile: PlayerProfile): Promise<PlayerProfile>;
  updatePlayerProfile(
    id: string,
    accountUserId: string,
    patch: Partial<Omit<PlayerProfile, 'id' | 'accountUserId' | 'createdAt'>>,
  ): Promise<PlayerProfile | null>;
  deletePlayerProfile(id: string, accountUserId: string): Promise<boolean>;
  claimPastParticipations(
    accountUserId: string,
    profileId: string,
    confirmedEmail: string,
  ): Promise<{ claimedCount: number; participantIds: string[] }>;
  getPlayerCareerDashboard(
    accountUserId: string,
    profileId?: string | null,
    confirmedEmail?: string | null,
  ): Promise<PlayerCareerDashboard>;

  // Tournament Discovery & Registrations (Phase 2)
  getTournamentBySlugOrId(slugOrId: string): Promise<Tournament | null>;
  listPublishedEvents(filters?: {
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
  }): Promise<PublicEventSummary[]>;
  listTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]>;
  listUserRegistrations(userId: string): Promise<TournamentRegistration[]>;
  createTournamentRegistration(reg: TournamentRegistration): Promise<TournamentRegistration>;
  reviewTournamentRegistration(
    tournamentId: string,
    regId: string,
    input: {
      action: 'approve' | 'reject' | 'waitlist';
      reviewerNote?: string | null;
      categoryIds?: string[];
      /** The organizer checked payment some other way, e.g. cash at the desk. */
      confirmPaymentWithoutReceipt?: boolean;
    },
  ): Promise<{ registration: TournamentRegistration; participant: Participant | null }>;

  /** Counts sends against a rolling 24-hour cap. Reserves them only when allowed. */
  reserveEmailSends(input: EmailSendReservation): Promise<EmailSendQuota>;

  // Floor Chief Arbiter Alerts (Phase 3)
  createFloorAlert(alert: FloorAlert): Promise<FloorAlert>;
  listFloorAlerts(tournamentId: string, activeOnly?: boolean): Promise<FloorAlert[]>;
  resolveFloorAlert(id: string): Promise<FloorAlert | null>;
}

// ---------------------------------------------------------------------------
// In-memory store (offline / dev – active when DATABASE_URL is absent)
// ---------------------------------------------------------------------------

function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Accounts with no organization get the same limits as a Sandbox Trial. */
const NO_ORG_MAX_TOURNAMENTS = 1;
const NO_ORG_MAX_PLAYERS = 24;

/** The plan caps an Event Pass at 150 players, whatever an older row has stored. */
const EVENT_PASS_MAX_PLAYERS = 150;
/** Each organization carries its own trial quota, so free ones have to be limited. */
const MAX_TRIAL_ORGS_PER_USER = 1;
const MAX_ORGS_PER_USER = 5;
const MANAGER_ROLES: OrganizationMemberRole[] = ['owner', 'admin', 'director'];
/** Sync pull re-reads a short window, so a transaction that commits late isn't missed. */
const SYNC_PULL_OVERLAP_MS = 60_000;

function syncPullCursor(since: string): string {
  return new Date(Date.parse(since) - SYNC_PULL_OVERLAP_MS).toISOString();
}

function playerLimitFor(
  org: Organization | null,
  t: { ownerId?: string | null },
): number | null {
  if (!org) return t.ownerId ? NO_ORG_MAX_PLAYERS : null;
  if (org.planTier === 'trial') return org.maxPlayersPerTournament ?? null;
  if (org.planTier === 'event_pass') {
    return Math.min(org.maxPlayersPerTournament ?? EVENT_PASS_MAX_PLAYERS, EVENT_PASS_MAX_PLAYERS);
  }
  return null;
}

function assertOrganizationCap(createdByUser: Array<{ planTier: string }>): void {
  if (createdByUser.length >= MAX_ORGS_PER_USER) {
    throw Object.assign(
      new Error(`An account can create at most ${MAX_ORGS_PER_USER} organizations.`),
      { statusCode: 403 },
    );
  }
  if (createdByUser.filter((o) => o.planTier === 'trial').length >= MAX_TRIAL_ORGS_PER_USER) {
    throw Object.assign(
      new Error(
        'This account already has a Sandbox Trial organization. Ask for it to be verified before creating another.',
      ),
      { statusCode: 403 },
    );
  }
}

const REVIEW_TRANSITIONS: Record<
  'approve' | 'reject' | 'waitlist',
  { from: RegistrationStatus[]; verb: string }
> = {
  approve: { from: ['pending', 'waitlisted', 'rejected'], verb: 'approved' },
  reject: { from: ['pending', 'waitlisted', 'approved'], verb: 'rejected' },
  waitlist: { from: ['pending', 'approved', 'rejected'], verb: 'waitlisted' },
};

function assertReviewTransition(
  current: RegistrationStatus,
  action: 'approve' | 'reject' | 'waitlist',
): void {
  const rule = REVIEW_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw Object.assign(new Error(`A ${current} registration cannot be ${rule.verb}.`), {
      statusCode: 409,
    });
  }
}

/**
 * Approval marks payment verified only on evidence: a receipt, or the organizer saying
 * they checked it another way. Throws before anything is written.
 */
function paymentStatusOnApprove(
  reg: TournamentRegistration,
  confirmedWithoutReceipt: boolean | undefined,
): RegistrationPaymentStatus {
  const paid = reg.amountCents > 0 || reg.paymentStatus !== 'not_required';
  if (!paid) return 'not_required';
  if (
    reg.paymentStatus === 'verified' ||
    reg.receiptDataUrl ||
    reg.receiptStoragePath ||
    confirmedWithoutReceipt
  ) {
    return 'verified';
  }
  throw Object.assign(
    new Error(
      'This paid registration has no receipt. Confirm that payment was received another way, or ask the player for a receipt.',
    ),
    { statusCode: 409, code: 'PAYMENT_UNVERIFIED' },
  );
}

function confirmedGamesConflict(): Error {
  return Object.assign(
    new Error(
      'This player has games in a confirmed round. Withdraw them from later rounds instead.',
    ),
    { statusCode: 409 },
  );
}

function tournamentFullConflict(max: number): Error {
  return Object.assign(
    new Error(`This tournament is full (${max} players). Waitlist the player or raise the limit.`),
    { statusCode: 409 },
  );
}

function resultNotOpenConflict(): Error {
  return Object.assign(new Error('Result already locked for this table'), { statusCode: 409 });
}

function noEventCredits(): Error {
  return Object.assign(
    new Error('No Event Pass credits left. Contact us to add a credit before publishing this event.'),
    { statusCode: 403 },
  );
}

function assertNoOrgTournamentLimit(ownedCount: number): void {
  if (ownedCount >= NO_ORG_MAX_TOURNAMENTS) {
    throw Object.assign(
      new Error(
        `Sandbox Trial quota reached: maximum ${NO_ORG_MAX_TOURNAMENTS} active tournament(s). Create an organization and request verification to run more.`,
      ),
      { statusCode: 403 },
    );
  }
}

function assertOrgMayCreateTournaments(org: Organization): void {
  if (org.verificationStatus === 'suspended' || org.verificationStatus === 'rejected') {
    throw Object.assign(
      new Error('Organization is suspended or rejected and cannot create tournaments.'),
      { statusCode: 403 },
    );
  }
  if (
    org.planTier === 'trial' &&
    org.trialEndsAt &&
    new Date(org.trialEndsAt).getTime() < Date.now()
  ) {
    throw Object.assign(
      new Error('Your Sandbox Trial has ended. Request verification to create more tournaments.'),
      { statusCode: 403 },
    );
  }
}

/** Records when each row was last written, playing the part of server_updated_at. */
class StampedMap<V> extends Map<string, V> {
  readonly stamps = new Map<string, string>();

  override set(key: string, value: V): this {
    this.stamps.set(key, new Date().toISOString());
    return super.set(key, value);
  }

  changedSince(key: string, cursor: string): boolean {
    return (this.stamps.get(key) ?? '') > cursor;
  }

  restore(snapshot: Map<string, V>): void {
    super.clear();
    for (const [k, v] of snapshot) super.set(k, v);
  }
}

export class MemoryStore implements Store {
  private tournaments = new StampedMap<Tournament>();
  private categories = new StampedMap<Category>();
  private participants = new StampedMap<Participant>();
  private games = new StampedMap<Game>();
  private emailSends: Array<{
    scopeKey: string;
    kind: 'test' | 'bulk';
    count: number;
    at: number;
  }> = [];
  private tables = new Map<string, TournamentTable>();
  private gameCards = new Map<string, GameCard>();
  private pinMeta = new Map<string, { hash: string; round: number }>();
  private organizations = new Map<string, Organization>();
  private organizationMembers = new Map<
    string,
    { organizationId: string; userId: string; role: OrganizationMemberRole; createdAt: string }
  >();
  private playerProfiles = new Map<string, PlayerProfile>();
  private certificateIssues = new Map<string, CertificateIssue>();
  private registrations = new Map<string, TournamentRegistration>();
  private floorAlerts = new Map<string, FloorAlert>();
  private resultEvents: Array<{
    id: string;
    gameId: string;
    tournamentId: string;
    result: Game['result'];
    previousResult: Game['result'] | null;
    actorRole: 'floor' | 'director';
    actorName: string | null;
    actorUserId: string | null;
    note: string | null;
    createdAt: string;
  }> = [];

  /** Register a certificate issue in memory so getPlayerCareerDashboard can surface it in offline/unit tests. */
  registerCertificateIssue(issue: CertificateIssue): void {
    this.certificateIssues.set(issue.id, issue);
  }

  private async resolveTournamentOrganization(t: {
    organizationId?: string | null;
    ownerId?: string | null;
  }): Promise<Organization | null> {
    if (t.organizationId) {
      return this.organizations.get(t.organizationId) ?? null;
    }
    if (t.ownerId) {
      const userOrgs = await this.listUserOrganizations(t.ownerId);
      return userOrgs.find((o) => MANAGER_ROLES.includes(o.memberRole)) ?? null;
    }
    return null;
  }

  private async assertTournamentCreationQuota(t: Tournament): Promise<Organization | null> {
    const org = await this.resolveTournamentOrganization(t);
    if (!org) {
      if (t.ownerId) {
        const owned = [...this.tournaments.values()].filter(
          (row) => !row.deletedAt && row.id !== t.id && row.ownerId === t.ownerId,
        ).length;
        assertNoOrgTournamentLimit(owned);
      }
      return null;
    }
    assertOrgMayCreateTournaments(org);
    if (org.planTier === 'trial' && org.maxTournamentsQuota != null) {
      const activeCount = [...this.tournaments.values()].filter(
        (row) =>
          !row.deletedAt &&
          row.id !== t.id &&
          (row.organizationId === org.id || (!row.organizationId && row.ownerId && row.ownerId === org.createdBy)),
      ).length;
      if (activeCount >= org.maxTournamentsQuota) {
        throw Object.assign(
          new Error(
            `Sandbox Trial quota reached: maximum ${org.maxTournamentsQuota} active tournament(s) allowed in trial mode.`,
          ),
          { statusCode: 403 },
        );
      }
    }
    return org;
  }

  private async assertParticipantQuota(
    tournamentId: string,
    incomingParticipants: Array<{ id: string; deletedAt?: string | null }>,
  ): Promise<void> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return;
    // A soft-deleted tournament is checked too: it can be revived later.
    const org = await this.resolveTournamentOrganization(t);
    const playerLimit = playerLimitFor(org, t);
    if (playerLimit != null) {
      const activeIds = new Set(
        [...this.participants.values()]
          .filter((p) => p.tournamentId === tournamentId && !p.deletedAt)
          .map((p) => p.id),
      );
      for (const inc of incomingParticipants) {
        if (inc.deletedAt) activeIds.delete(inc.id);
        else activeIds.add(inc.id);
      }
      if (activeIds.size > playerLimit) {
        throw Object.assign(
          new Error(
            `Sandbox Trial quota reached: maximum ${playerLimit} players per tournament allowed on this plan.`,
          ),
          { statusCode: 403 },
        );
      }
    }
  }

  // ---- Tournaments ----

  async listTournaments(ownerId?: string | null): Promise<Tournament[]> {
    if (!ownerId) {
      return [...this.tournaments.values()].filter((t) => !t.deletedAt);
    }
    const orgIds = new Set((await this.listUserOrganizations(ownerId)).map((o) => o.id));
    return [...this.tournaments.values()].filter(
      (t) =>
        !t.deletedAt &&
        (t.ownerId === ownerId || Boolean(t.organizationId && orgIds.has(t.organizationId))),
    );
  }

  async getTournament(id: string): Promise<Tournament | null> {
    return this.tournaments.get(id) ?? null;
  }

  async getTournamentByPublicToken(token: string): Promise<Tournament | null> {
    const t = [...this.tournaments.values()].find(
      (row) => row.publicToken === token && row.publicEnabled && !row.deletedAt,
    );
    return t ?? null;
  }

  async isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean> {
    const t = this.tournaments.get(tournamentId);
    if (!t || t.deletedAt) return false;
    if (t.ownerId === ownerId) return true;
    if (t.organizationId) {
      return this.isOrganizationMember(t.organizationId, ownerId, ['owner', 'admin', 'director']);
    }
    return false;
  }

  async createTournament(t: Tournament): Promise<Tournament> {
    const org = await this.assertTournamentCreationQuota(t);
    const created: Tournament = {
      ...t,
      organizationId: t.organizationId ?? org?.id ?? null,
    };
    this.tournaments.set(created.id, created);
    return created;
  }

  async updateTournament(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
    options?: UpdateTournamentOptions,
  ): Promise<Tournament | null> {
    const existing = this.tournaments.get(id);
    if (!existing) return null;
    if (patch.publicSlug) {
      const norm = patch.publicSlug.trim().toLowerCase();
      const clash = [...this.tournaments.values()].find(
        (t) => !t.deletedAt && t.id !== id && t.publicSlug?.toLowerCase() === norm,
      );
      if (clash) {
        throw Object.assign(
          new Error(`Registration slug "${patch.publicSlug}" is already taken.`),
          { statusCode: 409 },
        );
      }
    }
    let eventCreditConsumedAt = existing.eventCreditConsumedAt ?? null;
    if (options?.chargeEventCreditTo && !eventCreditConsumedAt) {
      const org = this.organizations.get(options.chargeEventCreditTo);
      if (!org || (org.eventCreditsRemaining ?? 0) <= 0) throw noEventCredits();
      this.organizations.set(org.id, {
        ...org,
        eventCreditsRemaining: org.eventCreditsRemaining - 1,
      });
      eventCreditConsumedAt = new Date().toISOString();
    }
    const updated: Tournament = { ...existing, ...patch, id, eventCreditConsumedAt };
    this.tournaments.set(id, updated);
    return updated;
  }

  // ---- Categories ----

  async listCategories(tournamentId: string, includeDeleted = false): Promise<Category[]> {
    return [...this.categories.values()].filter(
      (c) => c.tournamentId === tournamentId && (includeDeleted || !c.deletedAt),
    );
  }

  async getCategory(id: string): Promise<Category | null> {
    return this.categories.get(id) ?? null;
  }

  async createCategory(c: Category): Promise<Category> {
    this.categories.set(c.id, c);
    return c;
  }

  async updateCategory(
    id: string,
    patch: Partial<Omit<Category, 'id'>>,
  ): Promise<Category | null> {
    const existing = this.categories.get(id);
    if (!existing) return null;
    const updated: Category = { ...existing, ...patch, id };
    this.categories.set(id, updated);
    return updated;
  }

  // ---- Participants ----

  async listParticipants(tournamentId: string, includeDeleted = false): Promise<Participant[]> {
    return [...this.participants.values()].filter(
      (p) => p.tournamentId === tournamentId && (includeDeleted || !p.deletedAt),
    );
  }

  async getParticipant(id: string): Promise<Participant | null> {
    return this.participants.get(id) ?? null;
  }

  async createParticipant(p: Participant): Promise<Participant> {
    await this.assertParticipantQuota(p.tournamentId, [p]);
    this.participants.set(p.id, p);
    return p;
  }

  async upsertParticipants(participants: Participant[]): Promise<Participant[]> {
    const byTournament = new Map<string, Participant[]>();
    for (const p of participants) {
      const list = byTournament.get(p.tournamentId) ?? [];
      list.push(p);
      byTournament.set(p.tournamentId, list);
    }
    for (const [tid, list] of byTournament) {
      await this.assertParticipantQuota(tid, list);
    }
    for (const p of participants) {
      const existing = this.participants.get(p.id);
      if (
        !existing ||
        (existing.tournamentId === p.tournamentId && p.updatedAt > existing.updatedAt)
      ) {
        this.participants.set(p.id, {
          ...p,
          playerProfileId: p.playerProfileId ?? existing?.playerProfileId ?? null,
        });
      }
    }
    return participants;
  }

  async softDeleteParticipantsByTournament(tournamentId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, p] of this.participants.entries()) {
      if (p.tournamentId === tournamentId && !p.deletedAt) {
        this.participants.set(id, { ...p, deletedAt: now, updatedAt: now });
      }
    }
  }

  // ---- Games ----

  async listGames(
    tournamentId: string,
    filters?: { round?: number; categoryId?: string },
  ): Promise<Game[]> {
    return [...this.games.values()].filter((g) => {
      if (g.tournamentId !== tournamentId || g.deletedAt) return false;
      if (filters?.round !== undefined && g.round !== filters.round) return false;
      if (filters?.categoryId !== undefined && g.categoryId !== filters.categoryId) return false;
      return true;
    });
  }

  async getGame(id: string): Promise<Game | null> {
    return this.games.get(id) ?? null;
  }

  async createGame(g: Game): Promise<Game> {
    this.games.set(g.id, g);
    return g;
  }

  async updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null> {
    const existing = this.games.get(id);
    if (!existing) return null;
    const updated: Game = { ...existing, ...patch, id };
    this.games.set(id, updated);
    return updated;
  }

  async recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
      onlyIfOpen?: boolean;
    },
  ): Promise<Game | null> {
    const existing = this.games.get(id);
    if (!existing) return null;
    if (input.onlyIfOpen && (existing.result !== 'pending' || existing.resultLockedAt)) {
      throw resultNotOpenConflict();
    }
    const now = new Date().toISOString();
    const prev = existing.result;
    const wasEntered = prev !== 'pending' && prev !== 'bye';
    const overrideBump =
      input.actorRole === 'director' && wasEntered && prev !== input.result ? 1 : 0;
    const updated: Game = {
      ...existing,
      result: input.result,
      resultLockedAt: input.lock ? now : (existing.resultLockedAt ?? null),
      resultEnteredByName: input.actorName?.trim() || existing.resultEnteredByName || null,
      resultEnteredByRole: input.actorRole,
      resultOverrideCount: (existing.resultOverrideCount ?? 0) + overrideBump,
      updatedAt: now,
    };
    this.games.set(id, updated);
    this.resultEvents.push({
      id: crypto.randomUUID(),
      gameId: id,
      tournamentId: existing.tournamentId,
      result: input.result,
      previousResult: prev,
      actorRole: input.actorRole,
      actorName: input.actorName?.trim() || null,
      actorUserId: input.actorUserId ?? null,
      note: input.note?.trim() || null,
      createdAt: now,
    });
    return updated;
  }

  async softDeleteGamesForRound(
    tournamentId: string,
    round: number,
    categoryId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, g] of this.games.entries()) {
      if (
        g.tournamentId === tournamentId &&
        g.round === round &&
        g.categoryId === categoryId &&
        !g.deletedAt
      ) {
        this.games.set(id, { ...g, deletedAt: now, updatedAt: now });
      }
    }
  }

  async getTableBySlug(slug: string): Promise<TournamentTable | null> {
    return [...this.tables.values()].find((t) => t.slug === slug) ?? null;
  }

  async listTables(tournamentId: string): Promise<TournamentTable[]> {
    return [...this.tables.values()]
      .filter((t) => t.tournamentId === tournamentId)
      .sort((a, b) => a.tableNumber - b.tableNumber);
  }

  async ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]> {
    const existing = await this.listTables(tournamentId);
    const byNum = new Map(existing.map((t) => [t.tableNumber, t]));
    const now = new Date().toISOString();
    for (let n = 1; n <= count; n++) {
      if (byNum.has(n)) continue;
      const row: TournamentTable = {
        id: crypto.randomUUID(),
        tournamentId,
        tableNumber: n,
        slug: generateTableSlug(),
        createdAt: now,
      };
      this.tables.set(row.id, row);
      byNum.set(n, row);
    }
    const t = this.tournaments.get(tournamentId);
    if (t) {
      this.tournaments.set(tournamentId, {
        ...t,
        tableCount: Math.max(t.tableCount ?? 0, count),
        updatedAt: now,
      });
    }
    return this.listTables(tournamentId);
  }

  async setArbiterPin(
    tournamentId: string,
    pinHash: string,
    pinRound: number,
  ): Promise<Tournament | null> {
    const t = this.tournaments.get(tournamentId);
    if (!t) return null;
    this.pinMeta.set(tournamentId, { hash: pinHash, round: pinRound });
    const updated: Tournament = {
      ...t,
      arbiterPinRound: pinRound,
      updatedAt: new Date().toISOString(),
    };
    this.tournaments.set(tournamentId, updated);
    return updated;
  }

  async getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }> {
    const meta = this.pinMeta.get(tournamentId);
    const t = this.tournaments.get(tournamentId);
    return {
      hash: meta?.hash ?? null,
      round: meta?.round ?? t?.arbiterPinRound ?? null,
    };
  }

  async findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null> {
    const matches = [...this.games.values()].filter(
      (g) =>
        !g.deletedAt &&
        g.tournamentId === tournamentId &&
        g.board === tableNumber &&
        g.round === round,
    );
    if (matches.length !== 1) return null;
    return matches[0]!;
  }

  async allocateCertificateSerials(tournamentId: string, count: number): Promise<string[]> {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return [];
    const t = this.tournaments.get(tournamentId);
    if (!t) return [];
    const start = t.certSerialNext ?? 1;
    const prefix = t.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX;
    const pad = t.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD;
    const year = certificateYear(t.date);
    const serials = Array.from({ length: n }, (_, i) =>
      formatCertificateSerial(prefix, start + i, pad, year),
    );
    this.tournaments.set(tournamentId, { ...t, certSerialNext: start + n });
    return serials;
  }

  async listGameCards(gameId: string, includeDeleted = false): Promise<GameCard[]> {
    return [...this.gameCards.values()]
      .filter((c) => c.gameId === gameId && (includeDeleted || !c.deletedAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]> {
    let cards = [...this.gameCards.values()].filter(
      (c) => c.tournamentId === tournamentId && !c.deletedAt,
    );
    if (filters?.gameId) {
      cards = cards.filter((c) => c.gameId === filters.gameId);
    }
    if (filters?.round != null) {
      const gameIds = new Set(
        [...this.games.values()]
          .filter(
            (g) =>
              g.tournamentId === tournamentId &&
              !g.deletedAt &&
              g.round === filters.round,
          )
          .map((g) => g.id),
      );
      cards = cards.filter((c) => gameIds.has(c.gameId));
    }
    return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createGameCard(card: GameCard): Promise<GameCard> {
    this.gameCards.set(card.id, card);
    return card;
  }

  async softDeleteGameCard(id: string): Promise<GameCard | null> {
    const existing = this.gameCards.get(id);
    if (!existing || existing.deletedAt) return null;
    const updated: GameCard = {
      ...existing,
      deletedAt: new Date().toISOString(),
    };
    this.gameCards.set(id, updated);
    return updated;
  }

  // ---- Sync ----

  async pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult> {
    const cursor = syncPullCursor(since);
    const manageable = ownerId ? await this.manageableOrganizationIds(ownerId) : null;
    const visible = (t: Tournament) =>
      !ownerId ||
      t.ownerId === ownerId ||
      Boolean(t.organizationId && manageable?.has(t.organizationId));
    const visibleTournaments = [...this.tournaments.values()].filter(visible);
    const visibleIds = new Set(visibleTournaments.map((t) => t.id));
    const tournaments = visibleTournaments.filter((t) =>
      this.tournaments.changedSince(t.id, cursor),
    );
    const tournamentUpdated = new Set(tournaments.map((t) => t.id));
    const childOk = (tournamentId: string, changed: boolean) =>
      visibleIds.has(tournamentId) && (changed || tournamentUpdated.has(tournamentId));
    return {
      tournaments,
      categories: [...this.categories.values()].filter((c) =>
        childOk(c.tournamentId, this.categories.changedSince(c.id, cursor)),
      ),
      participants: [...this.participants.values()].filter((p) =>
        childOk(p.tournamentId, this.participants.changedSince(p.id, cursor)),
      ),
      games: [...this.games.values()].filter((g) =>
        childOk(g.tournamentId, this.games.changedSince(g.id, cursor)),
      ),
    };
  }

  private async manageableOrganizationIds(userId: string): Promise<Set<string>> {
    const orgs = await this.listUserOrganizations(userId);
    return new Set(orgs.filter((o) => MANAGER_ROLES.includes(o.memberRole)).map((o) => o.id));
  }

  async pushSync(
    items: SyncPushItem[],
    ownerId?: string | null,
    options?: SyncPushOptions,
  ): Promise<SyncPushResult> {
    // A failed batch leaves nothing behind, as the Postgres transaction does.
    const snapshot = {
      tournaments: new Map(this.tournaments),
      categories: new Map(this.categories),
      participants: new Map(this.participants),
      games: new Map(this.games),
      events: this.resultEvents.length,
    };
    const backend: SyncBackend = {
      loadTournaments: async (ids) => {
        const found = new Map<string, Tournament>();
        for (const id of ids) {
          const t = this.tournaments.get(id);
          if (t) found.set(id, t);
        }
        return found;
      },
      manageableOrganizationIds: (userId) => this.manageableOrganizationIds(userId),
      checkTournamentQuota: (t) => this.assertTournamentCreationQuota(t),
      playerLimit: async (t) =>
        playerLimitFor(await this.resolveTournamentOrganization(t), t),
      activeParticipantIds: async (tid) =>
        new Set(
          [...this.participants.values()]
            .filter((p) => p.tournamentId === tid && !p.deletedAt)
            .map((p) => p.id),
        ),
      categoryIds: async (tid) =>
        new Set(
          [...this.categories.values()].filter((c) => c.tournamentId === tid).map((c) => c.id),
        ),
      participantIds: async (tid) =>
        new Set(
          [...this.participants.values()].filter((p) => p.tournamentId === tid).map((p) => p.id),
        ),
      childMeta: async (entity, id) => {
        const row = entity === 'category' ? this.categories.get(id) : this.participants.get(id);
        return row ? { tournamentId: row.tournamentId, updatedAt: row.updatedAt } : null;
      },
      getGame: async (id) => this.games.get(id) ?? null,
      writeTournament: async ({ item, ownerId: owner, organizationId }) => {
        this.applySyncItem(item, { ownerId: owner, organizationId });
        return this.tournaments.get(item.id)!;
      },
      writeChild: async (_entity, item) => {
        this.applySyncItem(item);
      },
      writeGame: async (item, decision) => {
        this.applySyncItem(item, { game: decision });
      },
      insertResultEvent: async (event) => {
        this.resultEvents.push({
          id: crypto.randomUUID(),
          actorRole: 'director',
          ...event,
        });
      },
    };
    try {
      return await runSyncPush(backend, items, ownerId ?? null, options);
    } catch (err) {
      this.tournaments.restore(snapshot.tournaments);
      this.categories.restore(snapshot.categories);
      this.participants.restore(snapshot.participants);
      this.games.restore(snapshot.games);
      this.resultEvents.length = snapshot.events;
      throw err;
    }
  }

  private applySyncItem(
    item: SyncPushItem,
    context: {
      ownerId?: string | null;
      organizationId?: string | null;
      game?: GameWriteApply;
    } = {},
  ): void {
    const { entity, id, payload, updatedAt, deletedAt } = item;

    if (entity === 'tournament') {
      const t: Tournament = {
        id,
        name: String(payload['name'] ?? ''),
        date: (payload['date'] as string | null | undefined) ?? null,
        style: (payload['style'] as TournamentStyle) ?? 'swiss',
        rounds: Number(payload['rounds'] ?? 1),
        status: (payload['status'] as TournamentStatus) ?? 'draft',
        currentRound: Number(payload['currentRound'] ?? 0),
        confirmedRounds: Number(payload['confirmedRounds'] ?? 0),
        mixCategories: Boolean(payload['mixCategories'] ?? false),
        prizePlaces: Number(payload['prizePlaces'] ?? 3),
        awardScope: (payload['awardScope'] as Tournament['awardScope']) ?? 'per_category',
        tiebreakOrder: Array.isArray(payload['tiebreakOrder'])
          ? (payload['tiebreakOrder'] as Tournament['tiebreakOrder'])
          : null,
        sharedPlaces: payload['sharedPlaces'] == null ? true : Boolean(payload['sharedPlaces']),
        ownerId: context.ownerId ?? null,
        organizationId: context.organizationId ?? null,
        arbiterPinRound:
          payload['arbiterPinRound'] == null ? null : Number(payload['arbiterPinRound']),
        tableCount: Number(payload['tableCount'] ?? 0),
        publicToken: null,
        publicEnabled: false,
        certEmailSubject: (payload['certEmailSubject'] as string | null | undefined) ?? null,
        certEmailBody: (payload['certEmailBody'] as string | null | undefined) ?? null,
        certSerialPrefix:
          (payload['certSerialPrefix'] as string | null | undefined) ||
          DEFAULT_CERT_SERIAL_PREFIX,
        certSerialPad:
          payload['certSerialPad'] == null
            ? DEFAULT_CERT_SERIAL_PAD
            : Number(payload['certSerialPad']),
        certSerialNext:
          payload['certSerialNext'] == null ? 1 : Number(payload['certSerialNext']),
        clientId: (payload['clientId'] as string | undefined) ?? undefined,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      // Preserve server-owned live fields when client sync omits them.
      const prev = this.tournaments.get(id);
      if (prev) {
        t.eventCreditConsumedAt = prev.eventCreditConsumedAt ?? null;
        t.arbiterPinRound = t.arbiterPinRound ?? prev.arbiterPinRound ?? null;
        t.tableCount = Math.max(prev.tableCount ?? 0, t.tableCount ?? 0);
        t.publicToken = prev.publicToken ?? null;
        t.publicEnabled = prev.publicEnabled ?? false;
        t.certSerialNext = Math.max(prev.certSerialNext ?? 1, t.certSerialNext ?? 1);
        t.publicSlug = t.publicSlug ?? prev.publicSlug ?? null;
        t.isPublishedGlobal = t.isPublishedGlobal ?? prev.isPublishedGlobal ?? false;
        t.registrationOpen = t.registrationOpen ?? prev.registrationOpen ?? false;
        t.registrationDeadline = t.registrationDeadline ?? prev.registrationDeadline ?? null;
        t.maxParticipants = t.maxParticipants ?? prev.maxParticipants ?? null;
        t.venueName = t.venueName ?? prev.venueName ?? null;
        t.venueAddress = t.venueAddress ?? prev.venueAddress ?? null;
        t.city = t.city ?? prev.city ?? null;
        t.state = t.state ?? prev.state ?? null;
        t.country = t.country ?? prev.country ?? null;
        t.latitude = t.latitude ?? prev.latitude ?? null;
        t.longitude = t.longitude ?? prev.longitude ?? null;
        t.descriptionMd = t.descriptionMd ?? prev.descriptionMd ?? null;
        t.rulesMd = t.rulesMd ?? prev.rulesMd ?? null;
        t.timeControl = t.timeControl ?? prev.timeControl ?? null;
        t.entryFeeCents = t.entryFeeCents ?? prev.entryFeeCents ?? 0;
        t.currency = t.currency ?? prev.currency ?? 'MYR';
        t.paymentInstructions = t.paymentInstructions ?? prev.paymentInstructions ?? null;
        t.paymentQrUrl = t.paymentQrUrl ?? prev.paymentQrUrl ?? null;
        t.registrationFormSchema = t.registrationFormSchema ?? prev.registrationFormSchema ?? null;
      }
      this.tournaments.set(id, t);
    } else if (entity === 'category') {
      const c: Category = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        name: String(payload['name'] ?? ''),
        filter: (payload['filter'] as FilterGroup) ?? { logic: 'and', rules: [] },
        sortOrder: Number(payload['sortOrder'] ?? 0),
        prizePlaces:
          payload['prizePlaces'] == null ? null : Number(payload['prizePlaces']),
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      this.categories.set(id, c);
    } else if (entity === 'participant') {
      const p: Participant = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        name: String(payload['name'] ?? ''),
        age: Number(payload['age'] ?? 0),
        gender: (payload['gender'] as string | null | undefined) ?? null,
        rating: payload['rating'] != null ? Number(payload['rating']) : null,
        fideId: payload['fideId'] != null ? Number(payload['fideId']) : null,
        club: (payload['club'] as string | null | undefined) ?? null,
        school: (payload['school'] as string | null | undefined) ?? null,
        city: (payload['city'] as string | null | undefined) ?? null,
        state: (payload['state'] as string | null | undefined) ?? null,
        country: (payload['country'] as string | null | undefined) ?? null,
        yearOfBirth:
          payload['yearOfBirth'] != null ? Number(payload['yearOfBirth']) : null,
        email: (payload['email'] as string | null | undefined) || null,
        customFields: (payload['customFields'] as Record<string, unknown>) ?? {},
        categoryIds: (payload['categoryIds'] as string[]) ?? [],
        seed: payload['seed'] != null ? Number(payload['seed']) : undefined,
        excludedRounds: Array.isArray(payload['excludedRounds'])
          ? (payload['excludedRounds'] as number[])
          : [],
        withdrawnFromRound:
          payload['withdrawnFromRound'] != null
            ? Number(payload['withdrawnFromRound'])
            : null,
        // Links come only from registration approval or a confirmed-email claim.
        playerProfileId: this.participants.get(id)?.playerProfileId ?? null,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      this.participants.set(id, p);
    } else if (entity === 'game') {
      const g: Game = {
        id,
        tournamentId: String(payload['tournamentId'] ?? ''),
        categoryId: String(payload['categoryId'] ?? ''),
        round: Number(payload['round'] ?? 1),
        board: Number(payload['board'] ?? 1),
        whiteId: (payload['whiteId'] as string | null) ?? null,
        blackId: (payload['blackId'] as string | null) ?? null,
        result: (payload['result'] as GameResult) ?? 'pending',
        isBye: Boolean(payload['isBye'] ?? false),
        resultLockedAt: context.game?.resultLockedAt ?? null,
        resultEnteredByName:
          (payload['resultEnteredByName'] as string | null | undefined) ?? null,
        resultEnteredByRole:
          (payload['resultEnteredByRole'] as Game['resultEnteredByRole']) ?? null,
        resultOverrideCount: context.game?.resultOverrideCount ?? 0,
        updatedAt,
        deletedAt: deletedAt ?? undefined,
      };
      this.games.set(id, g);
    }
  }

  // ---- Organizations (B2B) ----

  async listUserOrganizations(
    userId: string,
  ): Promise<Array<Organization & { memberRole: OrganizationMemberRole }>> {
    const out: Array<Organization & { memberRole: OrganizationMemberRole }> = [];
    for (const org of this.organizations.values()) {
      const mem = this.organizationMembers.get(`${org.id}:${userId}`);
      if (mem) {
        out.push({ ...org, memberRole: mem.role });
      } else if (org.createdBy === userId) {
        out.push({ ...org, memberRole: 'owner' });
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getOrganization(id: string): Promise<Organization | null> {
    return this.organizations.get(id) ?? null;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const norm = slug.trim().toLowerCase();
    return (
      [...this.organizations.values()].find((o) => o.slug.toLowerCase() === norm) ?? null
    );
  }

  async isOrganizationMember(
    organizationId: string,
    userId: string,
    roles?: OrganizationMemberRole[],
  ): Promise<boolean> {
    const org = this.organizations.get(organizationId);
    if (!org) return false;
    const mem = this.organizationMembers.get(`${organizationId}:${userId}`);
    const effectiveRole: OrganizationMemberRole | null =
      mem?.role ?? (org.createdBy === userId ? 'owner' : null);
    if (!effectiveRole) return false;
    if (!roles || roles.length === 0) return true;
    return roles.includes(effectiveRole);
  }

  async createOrganization(org: Organization, ownerUserId: string): Promise<Organization> {
    assertOrganizationCap(
      [...this.organizations.values()].filter((o) => o.createdBy === ownerUserId),
    );
    const existingSlug = await this.getOrganizationBySlug(org.slug);
    if (existingSlug && existingSlug.id !== org.id) {
      throw Object.assign(new Error(`Organization slug "${org.slug}" is already taken.`), {
        statusCode: 409,
      });
    }
    const created: Organization = {
      ...org,
      createdBy: org.createdBy ?? ownerUserId,
    };
    this.organizations.set(created.id, created);
    this.organizationMembers.set(`${created.id}:${ownerUserId}`, {
      organizationId: created.id,
      userId: ownerUserId,
      role: 'owner',
      createdAt: created.createdAt,
    });
    return created;
  }

  async updateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'name'
        | 'slug'
        | 'logoUrl'
        | 'description'
        | 'website'
        | 'contactEmail'
        | 'contactPhone'
        | 'city'
        | 'state'
        | 'country'
        | 'paymentInstructions'
        | 'paymentQrStoragePath'
      >
    >,
  ): Promise<Organization | null> {
    const existing = this.organizations.get(id);
    if (!existing) return null;
    if (patch.slug && patch.slug.toLowerCase() !== existing.slug.toLowerCase()) {
      const clash = await this.getOrganizationBySlug(patch.slug);
      if (clash && clash.id !== id) {
        throw Object.assign(new Error(`Organization slug "${patch.slug}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    const updated: Organization = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.organizations.set(id, updated);
    return updated;
  }

  async listAllOrganizationsForAdmin(): Promise<AdminOrganizationRow[]> {
    const rows: AdminOrganizationRow[] = [];
    for (const org of this.organizations.values()) {
      const memberIds = new Set<string>();
      if (org.createdBy) memberIds.add(org.createdBy);
      for (const m of this.organizationMembers.values()) {
        if (m.organizationId === org.id) memberIds.add(m.userId);
      }
      const tournamentCount = [...this.tournaments.values()].filter(
        (t) =>
          !t.deletedAt &&
          (t.organizationId === org.id || (!t.organizationId && t.ownerId && t.ownerId === org.createdBy)),
      ).length;
      rows.push({
        ...org,
        memberCount: memberIds.size,
        tournamentCount,
        ownerEmail: org.contactEmail ?? null,
      });
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async adminUpdateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'verificationStatus'
        | 'planTier'
        | 'trialEndsAt'
        | 'maxTournamentsQuota'
        | 'maxPlayersPerTournament'
        | 'eventCreditsRemaining'
        | 'canPublishGlobal'
        | 'canAcceptPaidRegistrations'
        | 'verifiedAt'
        | 'verifiedBy'
      >
    >,
  ): Promise<Organization | null> {
    const existing = this.organizations.get(id);
    if (!existing) return null;
    const updated: Organization = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.organizations.set(id, updated);
    return updated;
  }

  // ---- Player Profiles (B2C) ----

  async listPlayerProfiles(accountUserId: string): Promise<PlayerProfile[]> {
    return [...this.playerProfiles.values()]
      .filter((p) => p.accountUserId === accountUserId)
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async getPlayerProfile(id: string): Promise<PlayerProfile | null> {
    return this.playerProfiles.get(id) ?? null;
  }

  async createPlayerProfile(profile: PlayerProfile): Promise<PlayerProfile> {
    if (profile.username) {
      const norm = profile.username.trim().toLowerCase();
      const clash = [...this.playerProfiles.values()].find(
        (p) => p.username && p.username.toLowerCase() === norm && p.id !== profile.id,
      );
      if (clash) {
        throw Object.assign(new Error(`Username "@${profile.username}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    const existing = await this.listPlayerProfiles(profile.accountUserId);
    const shouldBePrimary = profile.isPrimary || existing.length === 0;
    if (shouldBePrimary) {
      for (const prev of existing) {
        if (prev.isPrimary) {
          this.playerProfiles.set(prev.id, { ...prev, isPrimary: false });
        }
      }
    }
    const created: PlayerProfile = {
      ...profile,
      isPrimary: shouldBePrimary,
    };
    this.playerProfiles.set(created.id, created);
    return created;
  }

  async updatePlayerProfile(
    id: string,
    accountUserId: string,
    patch: Partial<Omit<PlayerProfile, 'id' | 'accountUserId' | 'createdAt'>>,
  ): Promise<PlayerProfile | null> {
    const existing = this.playerProfiles.get(id);
    if (!existing || existing.accountUserId !== accountUserId) return null;
    if (patch.username) {
      const norm = patch.username.trim().toLowerCase();
      const clash = [...this.playerProfiles.values()].find(
        (p) => p.username && p.username.toLowerCase() === norm && p.id !== id,
      );
      if (clash) {
        throw Object.assign(new Error(`Username "@${patch.username}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    if (patch.isPrimary) {
      for (const p of this.playerProfiles.values()) {
        if (p.accountUserId === accountUserId && p.id !== id && p.isPrimary) {
          this.playerProfiles.set(p.id, { ...p, isPrimary: false });
        }
      }
    }
    const updated: PlayerProfile = {
      ...existing,
      ...patch,
      id,
      accountUserId,
      updatedAt: new Date().toISOString(),
    };
    this.playerProfiles.set(id, updated);
    return updated;
  }

  async deletePlayerProfile(id: string, accountUserId: string): Promise<boolean> {
    const existing = this.playerProfiles.get(id);
    if (!existing || existing.accountUserId !== accountUserId) return false;
    this.playerProfiles.delete(id);
    for (const [pid, part] of this.participants.entries()) {
      if (part.playerProfileId === id) {
        this.participants.set(pid, { ...part, playerProfileId: null });
      }
    }
    return true;
  }

  async claimPastParticipations(
    accountUserId: string,
    profileId: string,
    confirmedEmail: string,
  ): Promise<{ claimedCount: number; participantIds: string[] }> {
    const profile = this.playerProfiles.get(profileId);
    if (!profile || profile.accountUserId !== accountUserId) {
      throw Object.assign(new Error('Player profile not found'), { statusCode: 404 });
    }
    const target = confirmedEmail.trim().toLowerCase();
    // Siblings share a parent's email, so the email alone can't say which child a row is.
    const targetName = normalizePlayerName(profile.fullName);
    const claimedIds: string[] = [];
    const now = new Date().toISOString();
    if (!target) return { claimedCount: 0, participantIds: [] };
    for (const [pid, part] of this.participants.entries()) {
      if (part.deletedAt) continue;
      if (part.playerProfileId && part.playerProfileId !== profileId) continue;
      if (part.email?.trim().toLowerCase() !== target) continue;
      if (normalizePlayerName(part.name) !== targetName) continue;
      if (part.playerProfileId !== profileId) {
        this.participants.set(pid, { ...part, playerProfileId: profileId, updatedAt: now });
      }
      claimedIds.push(pid);
    }
    return { claimedCount: claimedIds.length, participantIds: claimedIds };
  }

  async getPlayerCareerDashboard(
    accountUserId: string,
    profileId?: string | null,
    confirmedEmail?: string | null,
  ): Promise<PlayerCareerDashboard> {
    const profiles = await this.listPlayerProfiles(accountUserId);
    const selectedProfile =
      (profileId ? profiles.find((p) => p.id === profileId) : null) ??
      profiles.find((p) => p.isPrimary) ??
      profiles[0] ??
      null;

    if (!selectedProfile) {
      return {
        profiles,
        selectedProfile: null,
        liveMatches: [],
        stats: {
          tournamentsCount: 0,
          gamesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          totalPoints: 0,
        },
        tournaments: [],
        certificates: [],
      };
    }

    const matchedParticipants = [...this.participants.values()].filter(
      (p) => !p.deletedAt && p.playerProfileId === selectedProfile.id,
    );
    const participations: Array<{ participant: Participant; tournament: Tournament }> = [];
    const gamesByTournament = new Map<string, Game[]>();
    const participantsById = new Map<string, Participant>();

    for (const part of matchedParticipants) {
      const tournament = this.tournaments.get(part.tournamentId);
      if (!tournament || tournament.deletedAt) continue;
      participations.push({ participant: part, tournament });
      if (!gamesByTournament.has(tournament.id)) {
        const tGames = [...this.games.values()].filter(
          (g) => g.tournamentId === tournament.id && !g.deletedAt,
        );
        gamesByTournament.set(tournament.id, tGames);
      }
      for (const tp of this.participants.values()) {
        if (tp.tournamentId === tournament.id && !tp.deletedAt) {
          participantsById.set(tp.id, tp);
        }
      }
    }

    const participantIdSet = new Set(matchedParticipants.map((p) => p.id));
    const profileEmailLower = certificateEmailFor(selectedProfile, confirmedEmail);
    const certItems: PlayerCertificateItem[] = [...this.certificateIssues.values()]
      .filter((issue) => {
        if (issue.participantId && participantIdSet.has(issue.participantId)) return true;
        if (
          profileEmailLower &&
          issue.recipientEmail &&
          issue.recipientEmail.trim().toLowerCase() === profileEmailLower
        ) {
          return true;
        }
        return false;
      })
      .map((issue) => {
        const t = this.tournaments.get(issue.tournamentId);
        return {
          id: issue.id,
          tournamentId: issue.tournamentId,
          tournamentName: t?.name ?? 'Tournament',
          tournamentDate: t?.date ?? null,
          participantId: issue.participantId ?? null,
          recipientName: issue.recipientName,
          type: issue.type,
          rank: issue.rank ?? null,
          serial: issue.serial ?? null,
          createdAt: issue.createdAt,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return buildCareerDashboard({
      profiles,
      selectedProfile,
      participations,
      gamesByTournament,
      participantsById,
      certificates: certItems,
    });
  }

  // ---- Tournament Discovery & Registrations (Phase 2) ----

  async getTournamentBySlugOrId(slugOrId: string): Promise<Tournament | null> {
    const norm = slugOrId.trim().toLowerCase();
    const byId = this.tournaments.get(slugOrId);
    if (byId && !byId.deletedAt) return byId;
    const bySlug = [...this.tournaments.values()].find(
      (t) => !t.deletedAt && t.publicSlug && t.publicSlug.toLowerCase() === norm,
    );
    return bySlug ?? null;
  }

  async listPublishedEvents(filters?: {
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
  }): Promise<PublicEventSummary[]> {
    const q = filters?.search?.trim().toLowerCase() || '';
    const hasCoords =
      filters?.lat != null &&
      filters?.lng != null &&
      Number.isFinite(filters.lat) &&
      Number.isFinite(filters.lng);
    const radiusKm =
      filters?.radiusKm != null && Number.isFinite(filters.radiusKm) && filters.radiusKm > 0
        ? filters.radiusKm
        : null;

    const events: PublicEventSummary[] = [];
    for (const t of this.tournaments.values()) {
      if (t.deletedAt || !t.isPublishedGlobal) continue;
      const org = t.organizationId ? (this.organizations.get(t.organizationId) ?? null) : null;
      if (!org || org.verificationStatus !== 'verified' || !org.canPublishGlobal) continue;
      const orgName = org?.name ?? null;
      if (q) {
        const hay = [
          t.name,
          t.venueName,
          t.venueAddress,
          t.city,
          t.state,
          t.country,
          orgName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }

      let distanceKm: number | null = null;
      if (hasCoords && t.latitude != null && t.longitude != null) {
        distanceKm = haversineDistanceKm(filters!.lat!, filters!.lng!, t.latitude, t.longitude);
      }
      if (hasCoords && radiusKm != null) {
        if (distanceKm == null || distanceKm > radiusKm) continue;
      }

      const registeredCount = [...this.participants.values()].filter(
        (p) => p.tournamentId === t.id && !p.deletedAt,
      ).length;
      const categories = [...this.categories.values()]
        .filter((c) => c.tournamentId === t.id && !c.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ id: c.id, name: c.name }));

      events.push({
        id: t.id,
        publicSlug: t.publicSlug ?? null,
        name: t.name,
        date: t.date ?? null,
        style: t.style,
        rounds: t.rounds,
        status: t.status,
        registrationOpen: Boolean(t.registrationOpen),
        registrationDeadline: t.registrationDeadline ?? null,
        maxParticipants: t.maxParticipants ?? null,
        registeredCount,
        venueName: t.venueName ?? null,
        venueAddress: t.venueAddress ?? null,
        city: t.city ?? null,
        state: t.state ?? null,
        country: t.country ?? 'Malaysia',
        latitude: t.latitude ?? null,
        longitude: t.longitude ?? null,
        distanceKm,
        timeControl: t.timeControl ?? null,
        entryFeeCents: t.entryFeeCents ?? 0,
        currency: t.currency ?? 'MYR',
        descriptionMd: t.descriptionMd ?? null,
        organizationName: orgName,
        categories,
      });
    }

    if (hasCoords) {
      events.sort((a, b) => {
        if (a.distanceKm != null && b.distanceKm != null) {
          if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        } else if (a.distanceKm != null) {
          return -1;
        } else if (b.distanceKm != null) {
          return 1;
        }
        return (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31');
      });
    } else {
      events.sort((a, b) => (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31'));
    }

    return events;
  }

  async listTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]> {
    return [...this.registrations.values()]
      .filter((r) => r.tournamentId === tournamentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listUserRegistrations(userId: string): Promise<TournamentRegistration[]> {
    const myProfileIds = new Set(
      [...this.playerProfiles.values()]
        .filter((p) => p.accountUserId === userId)
        .map((p) => p.id),
    );
    return [...this.registrations.values()]
      .filter(
        (r) =>
          r.submittedByUserId === userId ||
          (r.playerProfileId != null && myProfileIds.has(r.playerProfileId)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createTournamentRegistration(
    reg: TournamentRegistration,
  ): Promise<TournamentRegistration> {
    const existingForTournament = [...this.registrations.values()].filter(
      (r) =>
        r.tournamentId === reg.tournamentId &&
        r.status !== 'cancelled' &&
        r.status !== 'rejected',
    );
    if (reg.playerProfileId) {
      const clash = existingForTournament.find(
        (r) => r.playerProfileId === reg.playerProfileId && r.id !== reg.id,
      );
      if (clash) {
        throw Object.assign(
          new Error('This player profile already has an active registration for this tournament.'),
          { statusCode: 409 },
        );
      }
    }
    const normName = reg.playerSnapshot.name.trim().toLowerCase();
    const normEmail = reg.playerSnapshot.email?.trim().toLowerCase() || '';
    if (normName && normEmail) {
      const clash = existingForTournament.find(
        (r) =>
          r.id !== reg.id &&
          r.playerSnapshot.name.trim().toLowerCase() === normName &&
          (r.playerSnapshot.email?.trim().toLowerCase() || '') === normEmail,
      );
      if (clash) {
        throw Object.assign(
          new Error('This player is already registered for this tournament.'),
          { statusCode: 409 },
        );
      }
    }

    this.registrations.set(reg.id, reg);
    return reg;
  }

  async reviewTournamentRegistration(
    tournamentId: string,
    regId: string,
    input: {
      action: 'approve' | 'reject' | 'waitlist';
      reviewerNote?: string | null;
      categoryIds?: string[];
      confirmPaymentWithoutReceipt?: boolean;
    },
  ): Promise<{ registration: TournamentRegistration; participant: Participant | null }> {
    const reg = this.registrations.get(regId);
    if (!reg || reg.tournamentId !== tournamentId) {
      throw Object.assign(new Error('Registration not found'), { statusCode: 404 });
    }
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || tournament.deletedAt) {
      throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
    }

    assertReviewTransition(reg.status, input.action);

    const now = new Date().toISOString();

    if (input.action === 'approve') {
      const approvedPayment = paymentStatusOnApprove(reg, input.confirmPaymentWithoutReceipt);
      if (tournament.maxParticipants != null) {
        const active = [...this.participants.values()].filter(
          (p) => p.tournamentId === tournamentId && !p.deletedAt && p.id !== reg.participantId,
        ).length;
        if (active >= tournament.maxParticipants) {
          throw tournamentFullConflict(tournament.maxParticipants);
        }
      }
      const snap = reg.playerSnapshot;
      const currentYear = new Date().getFullYear();
      const computedAge =
        snap.age != null
          ? snap.age
          : snap.yearOfBirth != null
            ? Math.max(0, currentYear - snap.yearOfBirth)
            : 0;

      const categories = await this.listCategories(tournamentId);
      const validCatIds = new Set(categories.map((c) => c.id));
      let assignedCatIds: string[];
      if (input.categoryIds && input.categoryIds.length > 0) {
        assignedCatIds = input.categoryIds.filter((cid) => validCatIds.has(cid));
      } else {
        const autoMap = assignCategories(
          [
            {
              name: snap.name,
              age: computedAge,
              gender: snap.gender ?? null,
              rating: snap.rating ?? null,
              club: snap.club ?? snap.school ?? null,
              customFields: reg.customAnswers ?? {},
            },
          ],
          categories,
        );
        const autoIds = autoMap.get(0) ?? [];
        const merged = new Set<string>(autoIds);
        if (reg.selectedCategoryId && validCatIds.has(reg.selectedCategoryId)) {
          merged.add(reg.selectedCategoryId);
        }
        assignedCatIds = [...merged];
      }

      const participantId = reg.participantId ?? crypto.randomUUID();
      const participant: Participant = {
        id: participantId,
        tournamentId,
        name: snap.name,
        age: computedAge,
        gender: snap.gender ?? null,
        rating: snap.rating ?? null,
        fideId: snap.fideId ?? null,
        school: snap.school ?? null,
        club: snap.club ?? null,
        city: snap.city ?? null,
        state: snap.state ?? null,
        country: snap.country ?? 'Malaysia',
        yearOfBirth: snap.yearOfBirth ?? null,
        email: snap.email || null,
        customFields: {
          ...(reg.customAnswers ?? {}),
          ...(snap.phone ? { phone: snap.phone } : {}),
        },
        categoryIds: assignedCatIds,
        playerProfileId: reg.playerProfileId ?? null,
        updatedAt: now,
      };

      await this.upsertParticipants([participant]);

      const updatedReg: TournamentRegistration = {
        ...reg,
        status: 'approved',
        paymentStatus: approvedPayment,
        participantId: participant.id,
        reviewerNote: input.reviewerNote !== undefined ? input.reviewerNote : (reg.reviewerNote ?? null),
        reviewedAt: now,
        updatedAt: now,
      };
      this.registrations.set(regId, updatedReg);
      return { registration: updatedReg, participant };
    }

    if (reg.status === 'approved' && reg.participantId) {
      const pid = reg.participantId;
      const confirmed = tournament.confirmedRounds ?? 0;
      const played = [...this.games.values()].some(
        (g) =>
          g.tournamentId === tournamentId &&
          !g.deletedAt &&
          g.round <= confirmed &&
          (g.whiteId === pid || g.blackId === pid),
      );
      if (played) throw confirmedGamesConflict();
      const participant = this.participants.get(pid);
      if (participant && !participant.deletedAt) {
        this.participants.set(pid, { ...participant, deletedAt: now, updatedAt: now });
      }
    }

    const nextStatus: RegistrationStatus =
      input.action === 'waitlist' ? 'waitlisted' : 'rejected';
    const updatedReg: TournamentRegistration = {
      ...reg,
      status: nextStatus,
      reviewerNote: input.reviewerNote !== undefined ? input.reviewerNote : (reg.reviewerNote ?? null),
      reviewedAt: now,
      updatedAt: now,
    };
    this.registrations.set(regId, updatedReg);
    return { registration: updatedReg, participant: null };
  }

  async reserveEmailSends(input: EmailSendReservation): Promise<EmailSendQuota> {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const used = this.emailSends
      .filter((e) => e.scopeKey === input.scopeKey && e.kind === input.kind && e.at > since)
      .reduce((sum, e) => sum + e.count, 0);
    if (used + input.count > input.limit) {
      return { allowed: false, used, limit: input.limit };
    }
    this.emailSends.push({
      scopeKey: input.scopeKey,
      kind: input.kind,
      count: input.count,
      at: Date.now(),
    });
    return { allowed: true, used: used + input.count, limit: input.limit };
  }

  // ---- Floor Chief Arbiter Alerts (Phase 3) ----

  async createFloorAlert(alert: FloorAlert): Promise<FloorAlert> {
    this.floorAlerts.set(alert.id, alert);
    return alert;
  }

  async listFloorAlerts(tournamentId: string, activeOnly = true): Promise<FloorAlert[]> {
    return [...this.floorAlerts.values()]
      .filter(
        (a) =>
          a.tournamentId === tournamentId &&
          (!activeOnly || a.resolvedAt == null),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async resolveFloorAlert(id: string): Promise<FloorAlert | null> {
    const existing = this.floorAlerts.get(id);
    if (!existing) return null;
    const updated: FloorAlert = {
      ...existing,
      resolvedAt: existing.resolvedAt ?? new Date().toISOString(),
    };
    this.floorAlerts.set(id, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Shared career dashboard builder (used by both MemoryStore and PostgresStore)
// ---------------------------------------------------------------------------

/**
 * Certificates addressed by email show up only on a profile carrying the account's
 * confirmed address. profile.email alone is typed in by the user, so it proves nothing.
 */
function certificateEmailFor(
  profile: PlayerProfile,
  confirmedEmail: string | null | undefined,
): string | null {
  const email = profile.email?.trim().toLowerCase() || null;
  return email && email === confirmedEmail ? email : null;
}

function buildCareerDashboard(args: {
  profiles: PlayerProfile[];
  selectedProfile: PlayerProfile;
  participations: Array<{ participant: Participant; tournament: Tournament }>;
  gamesByTournament: Map<string, Game[]>;
  participantsById: Map<string, Participant>;
  certificates: PlayerCertificateItem[];
}): PlayerCareerDashboard {
  const {
    profiles,
    selectedProfile,
    participations,
    gamesByTournament,
    participantsById,
    certificates,
  } = args;

  const liveMatches: PlayerLiveMatchCard[] = [];
  const tournaments: PlayerTournamentHistoryItem[] = [];
  let totalGamesPlayed = 0;
  let totalWins = 0;
  let totalDraws = 0;
  let totalLosses = 0;
  let totalPoints = 0;

  for (const { participant, tournament } of participations) {
    const allTournamentGames = gamesByTournament.get(tournament.id) ?? [];
    const myGames = allTournamentGames
      .filter((g) => g.whiteId === participant.id || g.blackId === participant.id)
      .sort((a, b) => a.round - b.round);

    let score = 0;
    let gamesPlayed = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;

    for (const g of myGames) {
      if (g.isBye || g.result === 'bye') {
        score += 1;
        continue;
      }
      if (g.result === 'pending') {
        continue;
      }
      gamesPlayed += 1;
      if (g.result === '1/2-1/2') {
        draws += 1;
        score += 0.5;
      } else if (g.result === '1-0' || g.result === '1-0F') {
        if (g.whiteId === participant.id) {
          wins += 1;
          score += 1;
        } else {
          losses += 1;
        }
      } else if (g.result === '0-1' || g.result === '0-1F') {
        if (g.blackId === participant.id) {
          wins += 1;
          score += 1;
        } else {
          losses += 1;
        }
      } else if (g.result === '0-0') {
        losses += 1;
      }
    }

    totalGamesPlayed += gamesPlayed;
    totalWins += wins;
    totalDraws += draws;
    totalLosses += losses;
    totalPoints += score;

    const publicToken = tournament.publicEnabled ? (tournament.publicToken ?? null) : null;

    tournaments.push({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      tournamentDate: tournament.date ?? null,
      tournamentStatus: tournament.status,
      style: tournament.style,
      rounds: tournament.rounds,
      currentRound: tournament.currentRound,
      participantId: participant.id,
      playerName: participant.name,
      rating: participant.rating ?? null,
      score,
      gamesPlayed,
      wins,
      draws,
      losses,
      publicToken,
    });

    if (tournament.status === 'in_progress' || tournament.status === 'ready') {
      const targetRound =
        tournament.currentRound > 0
          ? tournament.currentRound
          : myGames.length > 0
            ? myGames[myGames.length - 1]!.round
            : 1;
      const activeGame =
        myGames.find((g) => g.round === targetRound) ??
        myGames[myGames.length - 1] ??
        null;

      if (activeGame) {
        const isBye = Boolean(activeGame.isBye || activeGame.result === 'bye');
        const color: 'white' | 'black' | 'bye' = isBye
          ? 'bye'
          : activeGame.whiteId === participant.id
            ? 'white'
            : 'black';
        const opponentId =
          color === 'bye'
            ? null
            : color === 'white'
              ? activeGame.blackId
              : activeGame.whiteId;
        const opponent = opponentId ? (participantsById.get(opponentId) ?? null) : null;

        liveMatches.push({
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentStatus: tournament.status,
          publicToken,
          participantId: participant.id,
          round: activeGame.round,
          board: activeGame.board,
          color,
          opponentId: opponentId ?? null,
          opponentName: opponent?.name ?? null,
          opponentRating: opponent?.rating ?? null,
          result: activeGame.result,
          isBye,
          currentScore: score,
        });
      } else {
        liveMatches.push({
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentStatus: tournament.status,
          publicToken,
          participantId: participant.id,
          round: tournament.currentRound || 1,
          board: 0,
          color: 'bye',
          opponentId: null,
          opponentName: null,
          opponentRating: null,
          result: 'pending',
          isBye: false,
          currentScore: score,
        });
      }
    }
  }

  tournaments.sort((a, b) => (b.tournamentDate ?? '').localeCompare(a.tournamentDate ?? ''));

  return {
    profiles,
    selectedProfile,
    liveMatches,
    stats: {
      tournamentsCount: tournaments.length,
      gamesPlayed: totalGamesPlayed,
      wins: totalWins,
      draws: totalDraws,
      losses: totalLosses,
      totalPoints,
    },
    tournaments,
    certificates,
  };
}

// ---------------------------------------------------------------------------
// Postgres row types (snake_case mirrors the DB schema)
// ---------------------------------------------------------------------------

interface TournamentRow {
  event_credit_consumed_at?: Date | string | null;
  id: string;
  name: string;
  date: string | null;
  style: string;
  rounds: number;
  status: string;
  current_round: number;
  confirmed_rounds: number | null;
  mix_categories: boolean | null;
  prize_places: number | null;
  award_scope: string | null;
  tiebreak_order: unknown | null;
  shared_places: boolean | null;
  owner_id: string | null;
  organization_id?: string | null;
  arbiter_pin_hash: string | null;
  arbiter_pin_round: number | null;
  table_count: number | null;
  public_token: string | null;
  public_enabled: boolean | null;
  cert_email_subject: string | null;
  cert_email_body: string | null;
  cert_serial_prefix: string | null;
  cert_serial_pad: number | null;
  cert_serial_next: number | null;
  public_slug?: string | null;
  is_published_global?: boolean | null;
  registration_open?: boolean | null;
  registration_deadline?: Date | string | null;
  max_participants?: number | null;
  venue_name?: string | null;
  venue_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description_md?: string | null;
  rules_md?: string | null;
  time_control?: string | null;
  entry_fee_cents?: number | null;
  currency?: string | null;
  payment_instructions?: string | null;
  payment_qr_url?: string | null;
  registration_form_schema?: RegistrationFormConfig | null;
  client_id: string | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface TournamentRegistrationRow {
  id: string;
  tournament_id: string;
  player_profile_id: string | null;
  submitted_by_user_id: string | null;
  selected_category_id: string | null;
  player_snapshot: RegistrationPlayerSnapshot;
  custom_answers: Record<string, unknown>;
  payment_status: string;
  receipt_data_url: string | null;
  receipt_storage_path?: string | null;
  receipt_content_type?: string | null;
  amount_cents: number;
  status: string;
  reviewer_note: string | null;
  reviewed_at: Date | string | null;
  participant_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  verification_status: string;
  plan_tier: string;
  trial_ends_at: Date | string | null;
  max_tournaments_quota: number | null;
  max_players_per_tournament: number | null;
  event_credits_remaining: number;
  can_publish_global: boolean;
  can_accept_paid_registrations: boolean;
  payment_instructions: string | null;
  payment_qr_storage_path: string | null;
  created_by: string | null;
  verified_at: Date | string | null;
  verified_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlayerProfileRow {
  id: string;
  account_user_id: string;
  is_primary: boolean;
  relationship: string;
  username: string | null;
  full_name: string;
  date_of_birth: Date | string | null;
  year_of_birth: number | null;
  gender: string | null;
  national_id: string | null;
  fide_id: number | null;
  fide_standard: number | null;
  fide_rapid: number | null;
  fide_blitz: number | null;
  alokas_rating: number;
  school: string | null;
  club: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TournamentTableRow {
  id: string;
  tournament_id: string;
  table_number: number;
  slug: string;
  created_at: Date | string;
}

interface CategoryRow {
  id: string;
  tournament_id: string;
  name: string;
  filter: FilterGroup;
  sort_order: number;
  prize_places: number | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface ParticipantRow {
  id: string;
  tournament_id: string;
  name: string;
  age: number;
  gender: string | null;
  rating: number | null;
  fide_id: number | null;
  club: string | null;
  school: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  year_of_birth: number | null;
  email: string | null;
  custom_fields: Record<string, unknown>;
  category_ids: string[];
  seed: number | null;
  excluded_rounds: number[] | null;
  withdrawn_from_round: number | null;
  player_profile_id?: string | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface GameRow {
  id: string;
  tournament_id: string;
  category_id: string;
  round: number;
  board: number;
  white_id: string | null;
  black_id: string | null;
  result: string;
  is_bye: boolean;
  result_locked_at: Date | string | null;
  result_entered_by_name: string | null;
  result_entered_by_role: string | null;
  result_override_count: number | null;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface GameCardRow {
  id: string;
  game_id: string;
  tournament_id: string;
  player_id: string;
  card_type: string;
  note: string | null;
  actor_role: string;
  actor_name: string | null;
  actor_user_id: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

interface FloorAlertRow {
  id: string;
  tournament_id: string;
  round: number;
  table_number: number;
  game_id: string | null;
  arbiter_name: string | null;
  reason: string;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

// ---------------------------------------------------------------------------
// Helpers – row → domain type
// ---------------------------------------------------------------------------

function toIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date ?? undefined,
    style: row.style as TournamentStyle,
    rounds: row.rounds,
    status: row.status as TournamentStatus,
    currentRound: row.current_round,
    confirmedRounds: row.confirmed_rounds ?? 0,
    mixCategories: row.mix_categories ?? false,
    prizePlaces: row.prize_places ?? 3,
    awardScope: (row.award_scope as Tournament['awardScope']) ?? 'per_category',
    tiebreakOrder: Array.isArray(row.tiebreak_order)
      ? (row.tiebreak_order as Tournament['tiebreakOrder'])
      : null,
    sharedPlaces: row.shared_places ?? true,
    ownerId: row.owner_id ?? null,
    organizationId: row.organization_id ?? null,
    arbiterPinRound: row.arbiter_pin_round ?? null,
    tableCount: row.table_count ?? 0,
    publicToken: row.public_token ?? null,
    publicEnabled: row.public_enabled ?? false,
    certEmailSubject: row.cert_email_subject ?? null,
    certEmailBody: row.cert_email_body ?? null,
    certSerialPrefix: row.cert_serial_prefix ?? DEFAULT_CERT_SERIAL_PREFIX,
    certSerialPad: row.cert_serial_pad ?? DEFAULT_CERT_SERIAL_PAD,
    certSerialNext: row.cert_serial_next ?? 1,
    publicSlug: row.public_slug ?? null,
    isPublishedGlobal: Boolean(row.is_published_global),
    registrationOpen: Boolean(row.registration_open),
    registrationDeadline: toIso(row.registration_deadline) ?? null,
    maxParticipants: row.max_participants != null ? Number(row.max_participants) : null,
    venueName: row.venue_name ?? null,
    venueAddress: row.venue_address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    descriptionMd: row.description_md ?? null,
    rulesMd: row.rules_md ?? null,
    timeControl: row.time_control ?? null,
    entryFeeCents: row.entry_fee_cents != null ? Number(row.entry_fee_cents) : 0,
    currency: row.currency ?? 'MYR',
    paymentInstructions: row.payment_instructions ?? null,
    paymentQrUrl: row.payment_qr_url ?? null,
    registrationFormSchema: row.registration_form_schema ?? DEFAULT_REGISTRATION_FORM_CONFIG,
    eventCreditConsumedAt: toIso(row.event_credit_consumed_at) ?? null,
    clientId: row.client_id ?? undefined,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToTournamentRegistration(row: TournamentRegistrationRow): TournamentRegistration {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    playerProfileId: row.player_profile_id ?? null,
    submittedByUserId: row.submitted_by_user_id ?? null,
    selectedCategoryId: row.selected_category_id ?? null,
    playerSnapshot: row.player_snapshot ?? { name: 'Player' },
    customAnswers: row.custom_answers ?? {},
    paymentStatus: (row.payment_status as RegistrationPaymentStatus) ?? 'not_required',
    receiptDataUrl: row.receipt_data_url ?? null,
    receiptStoragePath: row.receipt_storage_path ?? null,
    receiptContentType: row.receipt_content_type ?? null,
    amountCents: Number(row.amount_cents ?? 0),
    status: (row.status as RegistrationStatus) ?? 'pending',
    reviewerNote: row.reviewer_note ?? null,
    reviewedAt: toIso(row.reviewed_at) ?? null,
    participantId: row.participant_id ?? null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function rowToTournamentTable(row: TournamentTableRow): TournamentTable {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    tableNumber: row.table_number,
    slug: row.slug,
    createdAt: toIso(row.created_at)!,
  };
}

function rowToFloorAlert(row: FloorAlertRow): FloorAlert {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    round: Number(row.round),
    tableNumber: Number(row.table_number),
    gameId: row.game_id ?? null,
    arbiterName: row.arbiter_name ?? null,
    reason: row.reason,
    createdAt: toIso(row.created_at)!,
    resolvedAt: toIso(row.resolved_at) ?? null,
  };
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    filter: row.filter,
    sortOrder: row.sort_order,
    prizePlaces: row.prize_places ?? null,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToParticipant(row: ParticipantRow): Participant {
  const ratingNum = row.rating != null ? Number(row.rating) : null;
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    age: row.age,
    gender: row.gender ?? undefined,
    // Keep null (not undefined) so sync pull JSON always carries the field.
    // FIDE unrated is stored as 0 in some rows — treat as unrated/null for the app.
    rating: ratingNum != null && ratingNum > 0 ? ratingNum : null,
    fideId: row.fide_id != null ? Number(row.fide_id) : null,
    club: row.club ?? undefined,
    school: row.school ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    country: row.country ?? undefined,
    yearOfBirth: row.year_of_birth ?? undefined,
    email: row.email ?? undefined,
    customFields: row.custom_fields ?? {},
    categoryIds: row.category_ids ?? [],
    seed: row.seed ?? undefined,
    excludedRounds: row.excluded_rounds ?? [],
    withdrawnFromRound: row.withdrawn_from_round ?? null,
    playerProfileId: row.player_profile_id ?? null,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url ?? null,
    description: row.description ?? null,
    website: row.website ?? null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? null,
    verificationStatus: row.verification_status as OrganizationVerificationStatus,
    planTier: row.plan_tier as OrganizationPlanTier,
    trialEndsAt: toIso(row.trial_ends_at) ?? null,
    maxTournamentsQuota:
      row.max_tournaments_quota != null ? Number(row.max_tournaments_quota) : null,
    maxPlayersPerTournament:
      row.max_players_per_tournament != null ? Number(row.max_players_per_tournament) : null,
    eventCreditsRemaining: Number(row.event_credits_remaining ?? 0),
    canPublishGlobal: Boolean(row.can_publish_global),
    canAcceptPaidRegistrations: Boolean(row.can_accept_paid_registrations),
    paymentInstructions: row.payment_instructions ?? null,
    paymentQrStoragePath: row.payment_qr_storage_path ?? null,
    createdBy: row.created_by ?? null,
    verifiedAt: toIso(row.verified_at) ?? null,
    verifiedBy: row.verified_by ?? null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function rowToPlayerProfile(row: PlayerProfileRow): PlayerProfile {
  const dob =
    row.date_of_birth instanceof Date
      ? row.date_of_birth.toISOString().slice(0, 10)
      : row.date_of_birth
        ? String(row.date_of_birth).slice(0, 10)
        : null;
  return {
    id: row.id,
    accountUserId: row.account_user_id,
    isPrimary: Boolean(row.is_primary),
    relationship: (row.relationship as PlayerRelationship) ?? 'self',
    username: row.username ?? null,
    fullName: row.full_name,
    dateOfBirth: dob,
    yearOfBirth: row.year_of_birth != null ? Number(row.year_of_birth) : null,
    gender: row.gender ?? null,
    nationalId: row.national_id ?? null,
    fideId: row.fide_id != null ? Number(row.fide_id) : null,
    fideStandard: row.fide_standard != null ? Number(row.fide_standard) : null,
    fideRapid: row.fide_rapid != null ? Number(row.fide_rapid) : null,
    fideBlitz: row.fide_blitz != null ? Number(row.fide_blitz) : null,
    alokasRating: Number(row.alokas_rating ?? 1000),
    school: row.school ?? null,
    club: row.club ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function exclusionFields(p: {
  excludedRounds?: number[] | null;
  withdrawnFromRound?: number | null;
}): { excluded: number[]; withdrawn: number | null } {
  const excluded = normalizeExcludedRounds(p.excludedRounds);
  const withdrawn =
    p.withdrawnFromRound != null && Number(p.withdrawnFromRound) > 0
      ? Number(p.withdrawnFromRound)
      : null;
  return { excluded, withdrawn };
}

function rowToGame(row: GameRow): Game {
  const role = row.result_entered_by_role;
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    categoryId: row.category_id,
    round: row.round,
    board: row.board,
    whiteId: row.white_id,
    blackId: row.black_id,
    result: row.result as GameResult,
    isBye: row.is_bye,
    resultLockedAt: toIso(row.result_locked_at) ?? null,
    resultEnteredByName: row.result_entered_by_name ?? null,
    resultEnteredByRole:
      role === 'floor' || role === 'director' ? role : null,
    resultOverrideCount: row.result_override_count ?? 0,
    updatedAt: toIso(row.updated_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

function rowToGameCard(row: GameCardRow): GameCard {
  const role = row.actor_role;
  return {
    id: row.id,
    gameId: row.game_id,
    tournamentId: row.tournament_id,
    playerId: row.player_id,
    cardType: row.card_type as GameCardType,
    note: row.note ?? null,
    actorRole: role === 'floor' || role === 'director' ? role : 'floor',
    actorName: row.actor_name ?? null,
    actorUserId: row.actor_user_id ?? null,
    createdAt: toIso(row.created_at)!,
    deletedAt: toIso(row.deleted_at) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// PostgresStore
// ---------------------------------------------------------------------------

export class PostgresStore implements Store {
  private readonly sql: Sql;

  /** Tests pass their own connection; everything else passes a URL. */
  constructor(database: string | Sql) {
    // prepare:false — required for Supabase transaction pooler (PgBouncer);
    // prepared statements otherwise fail with "prepared statement does not exist".
    this.sql =
      typeof database === 'string' ? postgres(database, { max: 10, prepare: false }) : database;
  }

  /**
   * Runs one transaction. Inside it, use only the `s` it hands you: `this.sql` would take
   * a second pooled connection that can't see the uncommitted work.
   */
  private tx<T>(fn: (s: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin((t) => fn(t as unknown as Sql)) as Promise<T>;
  }

  /** Serializes quota checks for one owner or organization until the transaction ends. */
  private async lockQuotaScope(s: Sql, key: string): Promise<void> {
    await s`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  // postgres.js sql.json() expects its own JSONValue recursive type; our objects
  // are always valid JSON at runtime – cast at the boundary to avoid noise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private j(v: unknown): ReturnType<Sql['json']> { return this.sql.json(v as any); }

  // ---- Tournaments ----

  private async resolveTournamentOrganization(t: {
    organizationId?: string | null;
    ownerId?: string | null;
  }, s: Sql = this.sql): Promise<Organization | null> {
    if (t.organizationId) {
      return this.getOrganization(t.organizationId, s);
    }
    if (t.ownerId) {
      const orgs = await this.listUserOrganizations(t.ownerId, s);
      return orgs.find((o) => MANAGER_ROLES.includes(o.memberRole)) ?? null;
    }
    return null;
  }

  private async assertTournamentCreationQuota(t: Tournament, s: Sql = this.sql): Promise<Organization | null> {
    const org = await this.resolveTournamentOrganization(t, s);
    if (!org) {
      if (t.ownerId) {
        const [owned] = await s<{ count: string }[]>`
          SELECT COUNT(*)::text AS count
          FROM tournaments
          WHERE deleted_at IS NULL AND id <> ${t.id} AND owner_id = ${t.ownerId}
        `;
        assertNoOrgTournamentLimit(Number(owned?.count ?? 0));
      }
      return null;
    }
    assertOrgMayCreateTournaments(org);
    if (org.planTier === 'trial' && org.maxTournamentsQuota != null) {
      const [row] = await s<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM tournaments
        WHERE deleted_at IS NULL
          AND id <> ${t.id}
          AND (
            organization_id = ${org.id}
            OR (organization_id IS NULL AND owner_id IS NOT NULL AND owner_id = ${org.createdBy ?? null})
          )
      `;
      const activeCount = Number(row?.count ?? 0);
      if (activeCount >= org.maxTournamentsQuota) {
        throw Object.assign(
          new Error(
            `Sandbox Trial quota reached: maximum ${org.maxTournamentsQuota} active tournament(s) allowed in trial mode.`,
          ),
          { statusCode: 403 },
        );
      }
    }
    return org;
  }

  private async assertParticipantQuota(
    tournamentId: string,
    incomingParticipants: Array<{ id: string; deletedAt?: string | null }>,
    s: Sql = this.sql,
  ): Promise<void> {
    const t = await this.getTournament(tournamentId, s);
    if (!t) return;
    // A soft-deleted tournament is checked too: it can be revived later.
    const org = await this.resolveTournamentOrganization(t, s);
    const playerLimit = playerLimitFor(org, t);
    if (playerLimit != null) {
      const existingRows = await s<{ id: string }[]>`
        SELECT id::text AS id
        FROM participants
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
      `;
      const activeIds = new Set(existingRows.map((r) => r.id));
      for (const inc of incomingParticipants) {
        if (inc.deletedAt) activeIds.delete(inc.id);
        else activeIds.add(inc.id);
      }
      if (activeIds.size > playerLimit) {
        throw Object.assign(
          new Error(
            `Sandbox Trial quota reached: maximum ${playerLimit} players per tournament allowed on this plan.`,
          ),
          { statusCode: 403 },
        );
      }
    }
  }

  async listTournaments(ownerId?: string | null): Promise<Tournament[]> {
    const rows = ownerId
      ? await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE deleted_at IS NULL
            AND (
              owner_id = ${ownerId}
              OR organization_id IN (
                SELECT organization_id FROM organization_members WHERE user_id = ${ownerId}
                UNION
                SELECT id FROM organizations WHERE created_by = ${ownerId}
              )
            )
          ORDER BY updated_at DESC
        `
      : await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments WHERE deleted_at IS NULL ORDER BY updated_at DESC
        `;
    return rows.map(rowToTournament);
  }

  async getTournament(id: string, s: Sql = this.sql): Promise<Tournament | null> {
    const rows = await s<TournamentRow[]>`SELECT * FROM tournaments WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async getTournamentByPublicToken(token: string): Promise<Tournament | null> {
    const rows = await this.sql<TournamentRow[]>`
      SELECT * FROM tournaments
      WHERE public_token = ${token}
        AND public_enabled = true
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async isTournamentOwnedBy(tournamentId: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<{ ok: boolean }[]>`
      SELECT true AS ok FROM tournaments t
      WHERE t.id = ${tournamentId}
        AND t.deleted_at IS NULL
        AND (
          t.owner_id = ${ownerId}
          OR (
            t.organization_id IS NOT NULL
            AND (
              EXISTS (
                SELECT 1 FROM organization_members m
                WHERE m.organization_id = t.organization_id
                  AND m.user_id = ${ownerId}
                  AND m.role IN ('owner', 'admin', 'director')
              )
              OR EXISTS (
                SELECT 1 FROM organizations o
                WHERE o.id = t.organization_id
                  AND o.created_by = ${ownerId}
              )
            )
          )
        )
      LIMIT 1
    `;
    return Boolean(rows[0]);
  }

  async createTournament(t: Tournament): Promise<Tournament> {
    return this.tx(async (s) => {
      await this.lockQuotaScope(s, `quota:${t.organizationId ?? t.ownerId ?? t.id}`);
      const org = await this.assertTournamentCreationQuota(t, s);
      const organizationId = t.organizationId ?? org?.id ?? null;
      const rows = await s<TournamentRow[]>`
        INSERT INTO tournaments (
          id, name, date, style, rounds, status, current_round, confirmed_rounds,
          mix_categories, prize_places, award_scope, tiebreak_order, shared_places,
          owner_id, organization_id, arbiter_pin_round, table_count, public_token, public_enabled,
          cert_email_subject, cert_email_body, cert_serial_prefix, cert_serial_pad, cert_serial_next,
          public_slug, is_published_global, registration_open, registration_deadline, max_participants,
          venue_name, venue_address, city, state, country, latitude, longitude,
          description_md, rules_md, time_control, entry_fee_cents, currency,
          payment_instructions, payment_qr_url, registration_form_schema,
          client_id, updated_at, deleted_at
        )
        VALUES (
          ${t.id}, ${t.name}, ${t.date ?? null}, ${t.style}, ${t.rounds},
          ${t.status}, ${t.currentRound}, ${t.confirmedRounds ?? 0}, ${t.mixCategories ?? false},
          ${t.prizePlaces ?? 3}, ${t.awardScope ?? 'per_category'},
          ${t.tiebreakOrder ? this.j(t.tiebreakOrder) : null}, ${t.sharedPlaces ?? true},
          ${t.ownerId ?? null}, ${organizationId}, ${t.arbiterPinRound ?? null}, ${Math.max(0, t.tableCount ?? 0)},
          ${t.publicToken ?? null}, ${t.publicEnabled ?? false},
          ${t.certEmailSubject ?? null}, ${t.certEmailBody ?? null},
          ${t.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX},
          ${t.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD},
          ${t.certSerialNext ?? 1},
          ${t.publicSlug ?? null}, ${t.isPublishedGlobal ?? false}, ${t.registrationOpen ?? false},
          ${t.registrationDeadline ?? null}, ${t.maxParticipants ?? null},
          ${t.venueName ?? null}, ${t.venueAddress ?? null}, ${t.city ?? null}, ${t.state ?? null},
          ${t.country ?? 'Malaysia'}, ${t.latitude ?? null}, ${t.longitude ?? null},
          ${t.descriptionMd ?? null}, ${t.rulesMd ?? null}, ${t.timeControl ?? null},
          ${t.entryFeeCents ?? 0}, ${t.currency ?? 'MYR'},
          ${t.paymentInstructions ?? null}, ${t.paymentQrUrl ?? null},
          ${this.j(t.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG)},
          ${t.clientId ?? null},
          ${t.updatedAt}, ${t.deletedAt ?? null}
        )
        RETURNING *
      `;
      return rowToTournament(rows[0]!);
    });
  }

  async updateTournament(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
    options?: UpdateTournamentOptions,
  ): Promise<Tournament | null> {
    const orgId = options?.chargeEventCreditTo;
    if (!orgId) return this.applyTournamentUpdate(id, patch, this.sql);
    return this.tx(async (s) => {
      const [row] = await s<{ event_credit_consumed_at: Date | string | null }[]>`
        SELECT event_credit_consumed_at FROM tournaments WHERE id = ${id} FOR UPDATE
      `;
      if (row && !row.event_credit_consumed_at) {
        const charged = await s`
          UPDATE organizations
          SET event_credits_remaining = event_credits_remaining - 1
          WHERE id = ${orgId} AND event_credits_remaining > 0
          RETURNING id
        `;
        if (charged.length === 0) throw noEventCredits();
        await s`UPDATE tournaments SET event_credit_consumed_at = now() WHERE id = ${id}`;
      }
      // Runs in the same transaction: a slug clash below must refund the credit.
      return this.applyTournamentUpdate(id, patch, s);
    });
  }

  private async applyTournamentUpdate(
    id: string,
    patch: Partial<Omit<Tournament, 'id'>>,
    s: Sql,
  ): Promise<Tournament | null> {
    const existing = await this.getTournament(id, s);
    if (!existing) return null;
    if (patch.publicSlug) {
      const norm = patch.publicSlug.trim().toLowerCase();
      const clash = await s<{ id: string }[]>`
        SELECT id::text AS id FROM tournaments
        WHERE deleted_at IS NULL
          AND id <> ${id}
          AND public_slug IS NOT NULL
          AND lower(public_slug) = ${norm}
        LIMIT 1
      `;
      if (clash[0]) {
        throw Object.assign(
          new Error(`Registration slug "${patch.publicSlug}" is already taken.`),
          { statusCode: 409 },
        );
      }
    }
    const m = { ...existing, ...patch };
    const rows = await s<TournamentRow[]>`
      UPDATE tournaments SET
        name = ${m.name}, date = ${m.date ?? null}, style = ${m.style},
        rounds = ${m.rounds}, status = ${m.status}, current_round = ${m.currentRound},
        confirmed_rounds = ${m.confirmedRounds ?? 0},
        mix_categories = ${m.mixCategories ?? false},
        prize_places = ${m.prizePlaces ?? 3},
        award_scope = ${m.awardScope ?? 'per_category'},
        tiebreak_order = ${m.tiebreakOrder ? this.j(m.tiebreakOrder) : null},
        shared_places = ${m.sharedPlaces ?? true},
        owner_id = ${m.ownerId ?? null},
        organization_id = ${m.organizationId ?? null},
        arbiter_pin_round = ${m.arbiterPinRound ?? null},
        table_count = GREATEST(COALESCE(tournaments.table_count, 0), ${Math.max(0, m.tableCount ?? 0)}),
        public_token = ${m.publicToken ?? null},
        public_enabled = ${m.publicEnabled ?? false},
        cert_email_subject = ${m.certEmailSubject ?? null},
        cert_email_body = ${m.certEmailBody ?? null},
        cert_serial_prefix = ${m.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX},
        cert_serial_pad = ${m.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD},
        cert_serial_next = GREATEST(cert_serial_next, ${m.certSerialNext ?? 1}),
        public_slug = ${m.publicSlug ?? null},
        is_published_global = ${m.isPublishedGlobal ?? false},
        registration_open = ${m.registrationOpen ?? false},
        registration_deadline = ${m.registrationDeadline ?? null},
        max_participants = ${m.maxParticipants ?? null},
        venue_name = ${m.venueName ?? null},
        venue_address = ${m.venueAddress ?? null},
        city = ${m.city ?? null},
        state = ${m.state ?? null},
        country = ${m.country ?? 'Malaysia'},
        latitude = ${m.latitude ?? null},
        longitude = ${m.longitude ?? null},
        description_md = ${m.descriptionMd ?? null},
        rules_md = ${m.rulesMd ?? null},
        time_control = ${m.timeControl ?? null},
        entry_fee_cents = ${m.entryFeeCents ?? 0},
        currency = ${m.currency ?? 'MYR'},
        payment_instructions = ${m.paymentInstructions ?? null},
        payment_qr_url = ${m.paymentQrUrl ?? null},
        registration_form_schema = ${this.j(m.registrationFormSchema ?? DEFAULT_REGISTRATION_FORM_CONFIG)},
        client_id = ${m.clientId ?? null}, updated_at = ${m.updatedAt},
        deleted_at = ${m.deletedAt ?? null},
        completed_at = CASE
          WHEN ${m.status} = 'completed' THEN COALESCE(completed_at, ${m.updatedAt}::timestamptz)
          ELSE NULL
        END
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  // ---- Categories ----

  async listCategories(
    tournamentId: string,
    includeDeleted = false,
    s: Sql = this.sql,
  ): Promise<Category[]> {
    const rows = includeDeleted
      ? await s<CategoryRow[]>`
          SELECT * FROM categories WHERE tournament_id = ${tournamentId} ORDER BY sort_order`
      : await s<CategoryRow[]>`
          SELECT * FROM categories WHERE tournament_id = ${tournamentId}
            AND deleted_at IS NULL ORDER BY sort_order`;
    return rows.map(rowToCategory);
  }

  async getCategory(id: string): Promise<Category | null> {
    const rows = await this.sql<CategoryRow[]>`SELECT * FROM categories WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToCategory(row) : null;
  }

  async createCategory(c: Category): Promise<Category> {
    const rows = await this.sql<CategoryRow[]>`
      INSERT INTO categories (id, tournament_id, name, filter, sort_order, prize_places, updated_at, deleted_at)
      VALUES (${c.id}, ${c.tournamentId}, ${c.name}, ${this.j(c.filter)},
              ${c.sortOrder}, ${c.prizePlaces ?? null}, ${c.updatedAt}, ${c.deletedAt ?? null})
      RETURNING *
    `;
    return rowToCategory(rows[0]!);
  }

  async updateCategory(
    id: string,
    patch: Partial<Omit<Category, 'id'>>,
  ): Promise<Category | null> {
    const existing = await this.getCategory(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql<CategoryRow[]>`
      UPDATE categories SET
        tournament_id = ${m.tournamentId}, name = ${m.name},
        filter = ${this.j(m.filter)}, sort_order = ${m.sortOrder},
        prize_places = ${m.prizePlaces ?? null},
        updated_at = ${m.updatedAt}, deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToCategory(row) : null;
  }

  // ---- Participants ----

  async listParticipants(tournamentId: string, includeDeleted = false): Promise<Participant[]> {
    const rows = includeDeleted
      ? await this.sql<ParticipantRow[]>`
          SELECT * FROM participants WHERE tournament_id = ${tournamentId}`
      : await this.sql<ParticipantRow[]>`
          SELECT * FROM participants WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL`;
    return rows.map(rowToParticipant);
  }

  async getParticipant(id: string): Promise<Participant | null> {
    const rows = await this.sql<ParticipantRow[]>`SELECT * FROM participants WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToParticipant(row) : null;
  }

  async createParticipant(p: Participant): Promise<Participant> {
    return this.tx(async (s) => {
      await s`SELECT id FROM tournaments WHERE id = ${p.tournamentId} FOR UPDATE`;
      await this.assertParticipantQuota(p.tournamentId, [p], s);
      const { excluded, withdrawn } = exclusionFields(p);
      const rows = await s<ParticipantRow[]>`
        INSERT INTO participants
          (id, tournament_id, name, age, gender, rating, fide_id, club, school, city, state, country,
           year_of_birth, email, custom_fields, category_ids, seed, excluded_rounds, withdrawn_from_round,
           player_profile_id, updated_at, deleted_at)
        VALUES
          (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
           ${p.rating ?? null}, ${p.fideId ?? null}, ${p.club ?? null}, ${p.school ?? null}, ${p.city ?? null},
           ${p.state ?? null}, ${p.country ?? null}, ${p.yearOfBirth ?? null},
           ${p.email ?? null}, ${this.j(p.customFields)},
             ${p.categoryIds}, ${p.seed ?? null}, ${excluded}, ${withdrawn},
             ${p.playerProfileId ?? null},
             ${p.updatedAt}, ${p.deletedAt ?? null})
        RETURNING *
      `;
      return rowToParticipant(rows[0]!);
    });
  }

  async upsertParticipants(participants: Participant[]): Promise<Participant[]> {
    if (participants.length === 0) return [];
    return this.tx((s) => this.upsertParticipantsIn(participants, s));
  }

  /** The caller's transaction serializes this; quota needs the locked tournament rows. */
  private async upsertParticipantsIn(
    participants: Participant[],
    s: Sql,
  ): Promise<Participant[]> {
    const lockIds = [...new Set(participants.map((p) => p.tournamentId))].sort();
    await s`SELECT id FROM tournaments WHERE id IN ${s(lockIds)} ORDER BY id FOR UPDATE`;
    const byTournament = new Map<string, Participant[]>();
    for (const p of participants) {
      const list = byTournament.get(p.tournamentId) ?? [];
      list.push(p);
      byTournament.set(p.tournamentId, list);
    }
    for (const [tid, list] of byTournament) {
      await this.assertParticipantQuota(tid, list, s);
    }
    const results: Participant[] = [];
    for (const p of participants) {
      const { excluded, withdrawn } = exclusionFields(p);
      const rows = await s<ParticipantRow[]>`
        INSERT INTO participants
          (id, tournament_id, name, age, gender, rating, fide_id, club, school, city, state, country,
           year_of_birth, email, custom_fields, category_ids, seed, excluded_rounds, withdrawn_from_round,
           player_profile_id, updated_at, deleted_at)
        VALUES
          (${p.id}, ${p.tournamentId}, ${p.name}, ${p.age}, ${p.gender ?? null},
           ${p.rating ?? null}, ${p.fideId ?? null}, ${p.club ?? null}, ${p.school ?? null}, ${p.city ?? null},
           ${p.state ?? null}, ${p.country ?? null}, ${p.yearOfBirth ?? null},
           ${p.email ?? null}, ${this.j(p.customFields)},
           ${p.categoryIds}, ${p.seed ?? null}, ${excluded}, ${withdrawn},
           ${p.playerProfileId ?? null},
           ${p.updatedAt}, ${p.deletedAt ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender,
          rating = EXCLUDED.rating, fide_id = EXCLUDED.fide_id, club = EXCLUDED.club, school = EXCLUDED.school,
          city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
          year_of_birth = EXCLUDED.year_of_birth, email = EXCLUDED.email,
          custom_fields = EXCLUDED.custom_fields, category_ids = EXCLUDED.category_ids,
          seed = EXCLUDED.seed, excluded_rounds = EXCLUDED.excluded_rounds,
          withdrawn_from_round = EXCLUDED.withdrawn_from_round,
          player_profile_id = COALESCE(EXCLUDED.player_profile_id, participants.player_profile_id),
          updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > participants.updated_at
          AND participants.tournament_id = EXCLUDED.tournament_id
        RETURNING *
      `;
      const row = rows[0];
      results.push(row ? rowToParticipant(row) : p);
    }
    return results;
  }

  async softDeleteParticipantsByTournament(tournamentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.sql`
      UPDATE participants SET deleted_at = ${now}, updated_at = ${now}
      WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
    `;
  }

  // ---- Games ----

  async listGames(
    tournamentId: string,
    filters?: { round?: number; categoryId?: string },
  ): Promise<Game[]> {
    let rows: GameRow[];
    if (filters?.round !== undefined && filters.categoryId !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
          AND round = ${filters.round} AND category_id = ${filters.categoryId}`;
    } else if (filters?.round !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL AND round = ${filters.round}`;
    } else if (filters?.categoryId !== undefined) {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games
        WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL AND category_id = ${filters.categoryId}`;
    } else {
      rows = await this.sql<GameRow[]>`
        SELECT * FROM games WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL`;
    }
    return rows.map(rowToGame);
  }

  async getGame(id: string): Promise<Game | null> {
    const rows = await this.sql<GameRow[]>`SELECT * FROM games WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToGame(row) : null;
  }

  async createGame(g: Game): Promise<Game> {
    const rows = await this.sql<GameRow[]>`
      INSERT INTO games
        (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye,
         result_locked_at, result_entered_by_name, result_entered_by_role, result_override_count,
         updated_at, deleted_at)
      VALUES
        (${g.id}, ${g.tournamentId}, ${g.categoryId}, ${g.round}, ${g.board},
         ${g.whiteId}, ${g.blackId}, ${g.result}, ${g.isBye}, ${g.resultLockedAt ?? null},
         ${g.resultEnteredByName ?? null}, ${g.resultEnteredByRole ?? null},
         ${g.resultOverrideCount ?? 0},
         ${g.updatedAt}, ${g.deletedAt ?? null})
      RETURNING *
    `;
    return rowToGame(rows[0]!);
  }

  async updateGame(id: string, patch: Partial<Omit<Game, 'id'>>): Promise<Game | null> {
    const existing = await this.getGame(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql<GameRow[]>`
      UPDATE games SET
        tournament_id = ${m.tournamentId}, category_id = ${m.categoryId},
        round = ${m.round}, board = ${m.board},
        white_id = ${m.whiteId}, black_id = ${m.blackId},
        result = ${m.result}, is_bye = ${m.isBye},
        result_locked_at = ${m.resultLockedAt ?? null},
        result_entered_by_name = ${m.resultEnteredByName ?? null},
        result_entered_by_role = ${m.resultEnteredByRole ?? null},
        result_override_count = ${m.resultOverrideCount ?? 0},
        updated_at = ${m.updatedAt}, deleted_at = ${m.deletedAt ?? null}
      WHERE id = ${id} RETURNING *
    `;
    const row = rows[0];
    return row ? rowToGame(row) : null;
  }

  async recordGameResult(
    id: string,
    input: {
      result: Game['result'];
      actorRole: 'floor' | 'director';
      actorName?: string | null;
      actorUserId?: string | null;
      note?: string | null;
      lock?: boolean;
      onlyIfOpen?: boolean;
    },
  ): Promise<Game | null> {
    return this.tx(async (s) => {
      const [current] = await s<GameRow[]>`SELECT * FROM games WHERE id = ${id} FOR UPDATE`;
      if (!current) return null;
      const existing = rowToGame(current);
      if (input.onlyIfOpen && (existing.result !== 'pending' || existing.resultLockedAt)) {
        throw resultNotOpenConflict();
      }
      const now = new Date().toISOString();
      const prev = existing.result;
      const wasEntered = prev !== 'pending' && prev !== 'bye';
      const overrideBump =
        input.actorRole === 'director' && wasEntered && prev !== input.result ? 1 : 0;
      const actorName = input.actorName?.trim() || existing.resultEnteredByName || null;
      const nextOverride = (existing.resultOverrideCount ?? 0) + overrideBump;
      const lockAt = input.lock ? now : (existing.resultLockedAt ?? null);
      const onlyIfOpen = Boolean(input.onlyIfOpen);

      const rows = await s<GameRow[]>`
        UPDATE games SET
          result = ${input.result},
          result_locked_at = ${lockAt},
          result_entered_by_name = ${actorName},
          result_entered_by_role = ${input.actorRole},
          result_override_count = ${nextOverride},
          updated_at = ${now}
        WHERE id = ${id}
          AND (NOT ${onlyIfOpen}::boolean OR (result = 'pending' AND result_locked_at IS NULL))
        RETURNING *
      `;
      const row = rows[0];
      if (!row) {
        if (onlyIfOpen) throw resultNotOpenConflict();
        return null;
      }

      await s`
        INSERT INTO game_result_events
          (id, game_id, tournament_id, result, previous_result, actor_role, actor_name, actor_user_id, note, created_at)
        VALUES
          (${crypto.randomUUID()}, ${id}, ${existing.tournamentId}, ${input.result}, ${prev},
           ${input.actorRole}, ${input.actorName?.trim() || null}, ${input.actorUserId ?? null},
           ${input.note?.trim() || null}, ${now})
      `;
      return rowToGame(row);
    });
  }

  async getTableBySlug(slug: string): Promise<TournamentTable | null> {
    const rows = await this.sql<TournamentTableRow[]>`
      SELECT * FROM tournament_tables WHERE slug = ${slug} LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToTournamentTable(row) : null;
  }

  async listTables(tournamentId: string): Promise<TournamentTable[]> {
    const rows = await this.sql<TournamentTableRow[]>`
      SELECT * FROM tournament_tables
      WHERE tournament_id = ${tournamentId}
      ORDER BY table_number ASC
    `;
    return rows.map(rowToTournamentTable);
  }

  async ensureTables(tournamentId: string, count: number): Promise<TournamentTable[]> {
    for (let n = 1; n <= count; n++) {
      const slug = generateTableSlug();
      await this.sql`
        INSERT INTO tournament_tables (id, tournament_id, table_number, slug)
        VALUES (${crypto.randomUUID()}, ${tournamentId}, ${n}, ${slug})
        ON CONFLICT (tournament_id, table_number) DO NOTHING
      `;
    }
    const now = new Date().toISOString();
    await this.sql`
      UPDATE tournaments
      SET table_count = GREATEST(table_count, ${count}), updated_at = ${now}
      WHERE id = ${tournamentId}
    `;
    return this.listTables(tournamentId);
  }

  async setArbiterPin(
    tournamentId: string,
    pinHash: string,
    pinRound: number,
  ): Promise<Tournament | null> {
    const now = new Date().toISOString();
    const rows = await this.sql<TournamentRow[]>`
      UPDATE tournaments
      SET arbiter_pin_hash = ${pinHash},
          arbiter_pin_round = ${pinRound},
          updated_at = ${now}
      WHERE id = ${tournamentId}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async getArbiterPinMeta(
    tournamentId: string,
  ): Promise<{ hash: string | null; round: number | null }> {
    const rows = await this.sql<{ arbiter_pin_hash: string | null; arbiter_pin_round: number | null }[]>`
      SELECT arbiter_pin_hash, arbiter_pin_round FROM tournaments WHERE id = ${tournamentId}
    `;
    const row = rows[0];
    return {
      hash: row?.arbiter_pin_hash ?? null,
      round: row?.arbiter_pin_round ?? null,
    };
  }

  async findGameForTable(
    tournamentId: string,
    tableNumber: number,
    round: number,
  ): Promise<Game | null> {
    const rows = await this.sql<GameRow[]>`
      SELECT * FROM games
      WHERE tournament_id = ${tournamentId}
        AND board = ${tableNumber}
        AND round = ${round}
        AND deleted_at IS NULL
    `;
    if (rows.length !== 1) return null;
    return rowToGame(rows[0]!);
  }

  async allocateCertificateSerials(tournamentId: string, count: number): Promise<string[]> {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return [];
    const rows = await this.sql<
      {
        start_seq: number;
        cert_serial_prefix: string | null;
        cert_serial_pad: number | null;
        date: string | null;
      }[]
    >`
      UPDATE tournaments
      SET cert_serial_next = cert_serial_next + ${n}
      WHERE id = ${tournamentId} AND deleted_at IS NULL
      RETURNING
        (cert_serial_next - ${n}) AS start_seq,
        cert_serial_prefix,
        cert_serial_pad,
        date
    `;
    const row = rows[0];
    if (!row) return [];
    const prefix = row.cert_serial_prefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX;
    const pad = row.cert_serial_pad ?? DEFAULT_CERT_SERIAL_PAD;
    const year = certificateYear(row.date);
    const start = Number(row.start_seq) || 1;
    return Array.from({ length: n }, (_, i) =>
      formatCertificateSerial(prefix, start + i, pad, year),
    );
  }

  async listGameCards(gameId: string, includeDeleted = false): Promise<GameCard[]> {
    const rows = includeDeleted
      ? await this.sql<GameCardRow[]>`
          SELECT * FROM game_cards WHERE game_id = ${gameId} ORDER BY created_at ASC`
      : await this.sql<GameCardRow[]>`
          SELECT * FROM game_cards
          WHERE game_id = ${gameId} AND deleted_at IS NULL
          ORDER BY created_at ASC`;
    return rows.map(rowToGameCard);
  }

  async listTournamentGameCards(
    tournamentId: string,
    filters?: { round?: number; gameId?: string },
  ): Promise<GameCard[]> {
    if (filters?.gameId) {
      return this.listGameCards(filters.gameId);
    }
    if (filters?.round != null) {
      const rows = await this.sql<GameCardRow[]>`
        SELECT c.* FROM game_cards c
        INNER JOIN games g ON g.id = c.game_id
        WHERE c.tournament_id = ${tournamentId}
          AND c.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND g.round = ${filters.round}
        ORDER BY c.created_at ASC
      `;
      return rows.map(rowToGameCard);
    }
    const rows = await this.sql<GameCardRow[]>`
      SELECT * FROM game_cards
      WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
      ORDER BY created_at ASC
    `;
    return rows.map(rowToGameCard);
  }

  async createGameCard(card: GameCard): Promise<GameCard> {
    const rows = await this.sql<GameCardRow[]>`
      INSERT INTO game_cards
        (id, game_id, tournament_id, player_id, card_type, note, actor_role, actor_name, actor_user_id, created_at, deleted_at)
      VALUES
        (${card.id}, ${card.gameId}, ${card.tournamentId}, ${card.playerId}, ${card.cardType},
         ${card.note ?? null}, ${card.actorRole}, ${card.actorName ?? null}, ${card.actorUserId ?? null},
         ${card.createdAt}, ${card.deletedAt ?? null})
      RETURNING *
    `;
    return rowToGameCard(rows[0]!);
  }

  async softDeleteGameCard(id: string): Promise<GameCard | null> {
    const now = new Date().toISOString();
    const rows = await this.sql<GameCardRow[]>`
      UPDATE game_cards SET deleted_at = ${now}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToGameCard(row) : null;
  }

  async softDeleteGamesForRound(
    tournamentId: string,
    round: number,
    categoryId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.sql`
      UPDATE games SET deleted_at = ${now}, updated_at = ${now}
      WHERE tournament_id = ${tournamentId} AND round = ${round}
        AND category_id = ${categoryId} AND deleted_at IS NULL
    `;
  }

  // ---- Sync ----

  async pullSince(since: string, ownerId?: string | null): Promise<SyncPullResult> {
    // server_updated_at, not updated_at: the latter comes from the client's clock, so an
    // offline edit pushed late would sit behind every other device's cursor forever.
    const cursor = syncPullCursor(since);
    if (ownerId) {
      // When a tournament row is pulled (e.g. after a revive), also return all of
      // its children even if the children themselves haven't changed.
      const manageable = this.sql`
        t.owner_id = ${ownerId}
        OR t.organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = ${ownerId} AND role IN ('owner', 'admin', 'director')
          UNION
          SELECT id FROM organizations WHERE created_by = ${ownerId}
        )
      `;
      const [tournaments, categories, participants, games] = await Promise.all([
        this.sql<TournamentRow[]>`
          SELECT t.* FROM tournaments t
          WHERE t.server_updated_at > ${cursor}::timestamptz AND (${manageable})
        `,
        this.sql<CategoryRow[]>`
          SELECT c.* FROM categories c
          INNER JOIN tournaments t ON t.id = c.tournament_id
          WHERE (${manageable})
            AND (c.server_updated_at > ${cursor}::timestamptz OR t.server_updated_at > ${cursor}::timestamptz)
        `,
        this.sql<ParticipantRow[]>`
          SELECT p.* FROM participants p
          INNER JOIN tournaments t ON t.id = p.tournament_id
          WHERE (${manageable})
            AND (p.server_updated_at > ${cursor}::timestamptz OR t.server_updated_at > ${cursor}::timestamptz)
        `,
        this.sql<GameRow[]>`
          SELECT g.* FROM games g
          INNER JOIN tournaments t ON t.id = g.tournament_id
          WHERE (${manageable})
            AND (g.server_updated_at > ${cursor}::timestamptz OR t.server_updated_at > ${cursor}::timestamptz)
        `,
      ]);
      return {
        tournaments: tournaments.map(rowToTournament),
        categories: categories.map(rowToCategory),
        participants: participants.map(rowToParticipant),
        games: games.map(rowToGame),
      };
    }
    const [tournaments, categories, participants, games] = await Promise.all([
      this.sql<TournamentRow[]>`SELECT * FROM tournaments WHERE server_updated_at > ${cursor}::timestamptz`,
      this.sql<CategoryRow[]>`SELECT * FROM categories WHERE server_updated_at > ${cursor}::timestamptz`,
      this.sql<ParticipantRow[]>`SELECT * FROM participants WHERE server_updated_at > ${cursor}::timestamptz`,
      this.sql<GameRow[]>`SELECT * FROM games WHERE server_updated_at > ${cursor}::timestamptz`,
    ]);
    return {
      tournaments: tournaments.map(rowToTournament),
      categories: categories.map(rowToCategory),
      participants: participants.map(rowToParticipant),
      games: games.map(rowToGame),
    };
  }

  async pushSync(
    items: SyncPushItem[],
    ownerId?: string | null,
    options?: SyncPushOptions,
  ): Promise<SyncPushResult> {
    return this.tx((s) => runSyncPush(this.syncBackend(s), items, ownerId ?? null, options));
  }

  private syncBackend(s: Sql): SyncBackend {
    return {
      loadTournaments: async (ids) => {
        const found = new Map<string, Tournament>();
        if (ids.length === 0) return found;
        // Sorted by the caller, so two batches can't deadlock on each other.
        const rows = await s<TournamentRow[]>`
          SELECT * FROM tournaments WHERE id IN ${s(ids)} ORDER BY id FOR UPDATE
        `;
        for (const row of rows) found.set(row.id, rowToTournament(row));
        return found;
      },
      manageableOrganizationIds: async (userId) => {
        const rows = await s<{ id: string }[]>`
          SELECT organization_id::text AS id FROM organization_members
          WHERE user_id = ${userId} AND role IN ('owner', 'admin', 'director')
          UNION
          SELECT id::text AS id FROM organizations WHERE created_by = ${userId}
        `;
        return new Set(rows.map((r) => r.id));
      },
      checkTournamentQuota: async (t) => {
        await this.lockQuotaScope(s, `quota:${t.organizationId ?? t.ownerId ?? t.id}`);
        return this.assertTournamentCreationQuota(t, s);
      },
      playerLimit: async (t) => playerLimitFor(await this.resolveTournamentOrganization(t, s), t),
      activeParticipantIds: async (tid) => {
        const rows = await s<{ id: string }[]>`
          SELECT id::text AS id FROM participants
          WHERE tournament_id = ${tid} AND deleted_at IS NULL
        `;
        return new Set(rows.map((r) => r.id));
      },
      categoryIds: async (tid) => {
        const rows = await s<{ id: string }[]>`
          SELECT id::text AS id FROM categories WHERE tournament_id = ${tid}
        `;
        return new Set(rows.map((r) => r.id));
      },
      participantIds: async (tid) => {
        const rows = await s<{ id: string }[]>`
          SELECT id::text AS id FROM participants WHERE tournament_id = ${tid}
        `;
        return new Set(rows.map((r) => r.id));
      },
      childMeta: async (entity, id) => {
        const rows =
          entity === 'category'
            ? await s<{ tournament_id: string; updated_at: Date | string }[]>`
                SELECT tournament_id, updated_at FROM categories WHERE id = ${id}
              `
            : await s<{ tournament_id: string; updated_at: Date | string }[]>`
                SELECT tournament_id, updated_at FROM participants WHERE id = ${id}
              `;
        const row = rows[0];
        return row ? { tournamentId: row.tournament_id, updatedAt: toIso(row.updated_at)! } : null;
      },
      getGame: async (id) => {
        const [row] = await s<GameRow[]>`SELECT * FROM games WHERE id = ${id}`;
        return row ? rowToGame(row) : null;
      },
      writeTournament: ({ item, ownerId, organizationId }) =>
        this.writeSyncTournament(s, item, ownerId, organizationId),
      writeChild: (entity, item) =>
        entity === 'category' ? this.writeSyncCategory(s, item) : this.writeSyncParticipant(s, item),
      writeGame: (item, decision) => this.writeSyncGame(s, item, decision),
      insertResultEvent: (event) => this.insertSyncResultEvent(s, event),
    };
  }

  private async writeSyncTournament(
    s: Sql,
    item: SyncPushItem,
    ownerId: string | null,
    organizationId: string | null,
  ): Promise<Tournament> {
    const { id, payload: p, updatedAt, deletedAt } = item;
    const certPrefix = String(p['certSerialPrefix'] ?? '').trim() || DEFAULT_CERT_SERIAL_PREFIX;
    const certPad = Math.min(
      8,
      Math.max(1, Number(p['certSerialPad'] ?? DEFAULT_CERT_SERIAL_PAD) || DEFAULT_CERT_SERIAL_PAD),
    );
    const certNext = Math.max(1, Number(p['certSerialNext'] ?? 1) || 1);
    const arbiterPinRound = p['arbiterPinRound'] == null ? null : Number(p['arbiterPinRound']);
    const tableCount = Math.max(0, Number(p['tableCount'] ?? 0) || 0);
    // public_token / public_enabled are server-owned (enable/rotate/disable API only).
    // Owner and organization never change through sync. The owner match in the WHERE stops
    // an insert racing someone else's first push of the same id from taking over their row.
    const rows = await s<TournamentRow[]>`
      INSERT INTO tournaments (id, name, date, style, rounds, status, current_round, confirmed_rounds, mix_categories, prize_places, award_scope, tiebreak_order, shared_places, owner_id, organization_id, arbiter_pin_round, table_count, cert_email_subject, cert_email_body, cert_serial_prefix, cert_serial_pad, cert_serial_next, client_id, updated_at, deleted_at)
      VALUES (${id}, ${String(p['name'] ?? '')}, ${(p['date'] as string) ?? null},
              ${String(p['style'] ?? 'swiss')}, ${Number(p['rounds'] ?? 1)},
              ${String(p['status'] ?? 'draft')}, ${Number(p['currentRound'] ?? 0)},
              ${Number(p['confirmedRounds'] ?? 0)},
              ${Boolean(p['mixCategories'] ?? false)},
              ${Number(p['prizePlaces'] ?? 3)},
              ${String(p['awardScope'] ?? 'per_category')},
              ${p['tiebreakOrder'] ? this.j(p['tiebreakOrder']) : null},
              ${p['sharedPlaces'] == null ? true : Boolean(p['sharedPlaces'])},
              ${ownerId},
              ${organizationId},
              ${arbiterPinRound},
              ${tableCount},
              ${(p['certEmailSubject'] as string) ?? null},
              ${(p['certEmailBody'] as string) ?? null},
              ${certPrefix}, ${certPad}, ${certNext},
              ${(p['clientId'] as string) ?? null}, ${updatedAt}, ${deletedAt ?? null})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, date = EXCLUDED.date, style = EXCLUDED.style,
        rounds = EXCLUDED.rounds, status = EXCLUDED.status,
        current_round = EXCLUDED.current_round,
        confirmed_rounds = EXCLUDED.confirmed_rounds,
        mix_categories = EXCLUDED.mix_categories,
        prize_places = EXCLUDED.prize_places,
        award_scope = EXCLUDED.award_scope,
        tiebreak_order = EXCLUDED.tiebreak_order,
        shared_places = EXCLUDED.shared_places,
        arbiter_pin_round = COALESCE(EXCLUDED.arbiter_pin_round, tournaments.arbiter_pin_round),
        table_count = GREATEST(COALESCE(tournaments.table_count, 0), EXCLUDED.table_count),
        cert_email_subject = EXCLUDED.cert_email_subject,
        cert_email_body = EXCLUDED.cert_email_body,
        cert_serial_prefix = EXCLUDED.cert_serial_prefix,
        cert_serial_pad = EXCLUDED.cert_serial_pad,
        cert_serial_next = GREATEST(tournaments.cert_serial_next, EXCLUDED.cert_serial_next),
        client_id = EXCLUDED.client_id,
        updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at,
        completed_at = CASE
          WHEN EXCLUDED.status = 'completed'
            THEN COALESCE(tournaments.completed_at, EXCLUDED.updated_at)
          ELSE NULL
        END
      WHERE EXCLUDED.updated_at > tournaments.updated_at
        AND tournaments.owner_id IS NOT DISTINCT FROM EXCLUDED.owner_id
      RETURNING *
    `;
    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error('This tournament id is already in use.'), { statusCode: 409 });
    }
    return rowToTournament(row);
  }

  private async writeSyncCategory(s: Sql, item: SyncPushItem): Promise<void> {
    const { id, payload: p, updatedAt, deletedAt } = item;
    const filter = (p['filter'] as FilterGroup) ?? { logic: 'and', rules: [] };
    await s`
      INSERT INTO categories (id, tournament_id, name, filter, sort_order, prize_places, updated_at, deleted_at)
      VALUES (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['name'] ?? '')},
              ${this.j(filter)}, ${Number(p['sortOrder'] ?? 0)},
              ${p['prizePlaces'] == null ? null : Number(p['prizePlaces'])},
              ${updatedAt}, ${deletedAt ?? null})
      ON CONFLICT (id) DO UPDATE SET
        tournament_id = EXCLUDED.tournament_id, name = EXCLUDED.name,
        filter = EXCLUDED.filter, sort_order = EXCLUDED.sort_order,
        prize_places = EXCLUDED.prize_places,
        updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
      WHERE EXCLUDED.updated_at > categories.updated_at
        AND categories.tournament_id = EXCLUDED.tournament_id
    `;
  }

  private async writeSyncParticipant(s: Sql, item: SyncPushItem): Promise<void> {
    const { id, payload: p, updatedAt, deletedAt } = item;
    const customFields = (p['customFields'] as Record<string, unknown>) ?? {};
    const categoryIds = (p['categoryIds'] as string[]) ?? [];
    const { excluded, withdrawn } = exclusionFields({
      excludedRounds: p['excludedRounds'] as number[] | null | undefined,
      withdrawnFromRound: p['withdrawnFromRound'] as number | null | undefined,
    });
    // player_profile_id is left out on purpose: links come only from registration
    // approval or a confirmed-email claim, never from a client payload.
    await s`
      INSERT INTO participants
        (id, tournament_id, name, age, gender, rating, fide_id, club, school, city, state, country,
         year_of_birth, email, custom_fields, category_ids, seed, excluded_rounds, withdrawn_from_round,
         updated_at, deleted_at)
      VALUES
        (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['name'] ?? '')},
         ${Number(p['age'] ?? 0)}, ${(p['gender'] as string) ?? null},
         ${p['rating'] != null ? Number(p['rating']) : null},
         ${p['fideId'] != null ? Number(p['fideId']) : null},
         ${(p['club'] as string) ?? null}, ${(p['school'] as string) ?? null},
         ${(p['city'] as string) ?? null}, ${(p['state'] as string) ?? null},
         ${(p['country'] as string) ?? null},
         ${p['yearOfBirth'] != null ? Number(p['yearOfBirth']) : null},
         ${(p['email'] as string) ?? null}, ${this.j(customFields)},
         ${categoryIds}, ${p['seed'] != null ? Number(p['seed']) : null},
         ${excluded}, ${withdrawn},
         ${updatedAt}, ${deletedAt ?? null})
      ON CONFLICT (id) DO UPDATE SET
        tournament_id = EXCLUDED.tournament_id, name = EXCLUDED.name, age = EXCLUDED.age,
        gender = EXCLUDED.gender, rating = EXCLUDED.rating, fide_id = EXCLUDED.fide_id,
        club = EXCLUDED.club,
        school = EXCLUDED.school, city = EXCLUDED.city, state = EXCLUDED.state,
        country = EXCLUDED.country, year_of_birth = EXCLUDED.year_of_birth,
        email = EXCLUDED.email,
        custom_fields = EXCLUDED.custom_fields, category_ids = EXCLUDED.category_ids,
        seed = EXCLUDED.seed, excluded_rounds = EXCLUDED.excluded_rounds,
        withdrawn_from_round = EXCLUDED.withdrawn_from_round,
        updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
      WHERE EXCLUDED.updated_at > participants.updated_at
        AND participants.tournament_id = EXCLUDED.tournament_id
    `;
  }

  private async writeSyncGame(
    s: Sql,
    item: SyncPushItem,
    decision: GameWriteApply,
  ): Promise<void> {
    const { id, payload: p, updatedAt, deletedAt } = item;
    const enteredRole = p['resultEnteredByRole'];
    const role = enteredRole === 'floor' || enteredRole === 'director' ? enteredRole : null;
    await s`
      INSERT INTO games
        (id, tournament_id, category_id, round, board, white_id, black_id, result, is_bye,
         result_locked_at, result_entered_by_name, result_entered_by_role, result_override_count,
         updated_at, deleted_at)
      VALUES
        (${id}, ${String(p['tournamentId'] ?? '')}, ${String(p['categoryId'] ?? '')},
         ${Number(p['round'] ?? 1)}, ${Number(p['board'] ?? 1)},
         ${(p['whiteId'] as string) ?? null}, ${(p['blackId'] as string) ?? null},
         ${String(p['result'] ?? 'pending')}, ${Boolean(p['isBye'] ?? false)},
         ${decision.resultLockedAt},
         ${(p['resultEnteredByName'] as string) ?? null}, ${role},
         ${decision.resultOverrideCount},
         ${updatedAt}, ${deletedAt ?? null})
      ON CONFLICT (id) DO UPDATE SET
        tournament_id = EXCLUDED.tournament_id, category_id = EXCLUDED.category_id,
        round = EXCLUDED.round, board = EXCLUDED.board,
        white_id = EXCLUDED.white_id, black_id = EXCLUDED.black_id,
        result = EXCLUDED.result, is_bye = EXCLUDED.is_bye,
        result_locked_at = EXCLUDED.result_locked_at,
        result_entered_by_name = EXCLUDED.result_entered_by_name,
        result_entered_by_role = EXCLUDED.result_entered_by_role,
        result_override_count = EXCLUDED.result_override_count,
        updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at
      WHERE EXCLUDED.updated_at > games.updated_at
        AND games.tournament_id = EXCLUDED.tournament_id
    `;
  }

  private async insertSyncResultEvent(s: Sql, event: SyncResultEvent): Promise<void> {
    await s`
      INSERT INTO game_result_events
        (id, game_id, tournament_id, result, previous_result, actor_role, actor_name, actor_user_id, note, created_at)
      VALUES
        (${crypto.randomUUID()}, ${event.gameId}, ${event.tournamentId}, ${event.result},
         ${event.previousResult}, 'director', ${event.actorName}, ${event.actorUserId},
         ${event.note}, ${event.createdAt})
    `;
  }

  // ---- Organizations (B2B) ----

  async listUserOrganizations(
    userId: string,
    s: Sql = this.sql,
  ): Promise<Array<Organization & { memberRole: OrganizationMemberRole }>> {
    const rows = await s<(OrganizationRow & { member_role: string })[]>`
      SELECT o.*, COALESCE(m.role, 'owner') AS member_role
      FROM organizations o
      LEFT JOIN organization_members m
        ON m.organization_id = o.id AND m.user_id = ${userId}
      WHERE m.user_id = ${userId} OR o.created_by = ${userId}
      ORDER BY o.created_at ASC
    `;
    return rows.map((r) => ({
      ...rowToOrganization(r),
      memberRole: (r.member_role as OrganizationMemberRole) || 'owner',
    }));
  }

  async getOrganization(id: string, s: Sql = this.sql): Promise<Organization | null> {
    const rows = await s<OrganizationRow[]>`
      SELECT * FROM organizations WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToOrganization(row) : null;
  }

  async getOrganizationBySlug(slug: string, s: Sql = this.sql): Promise<Organization | null> {
    const norm = slug.trim().toLowerCase();
    const rows = await s<OrganizationRow[]>`
      SELECT * FROM organizations WHERE lower(slug) = ${norm} LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToOrganization(row) : null;
  }

  async isOrganizationMember(
    organizationId: string,
    userId: string,
    roles?: OrganizationMemberRole[],
  ): Promise<boolean> {
    const rows = await this.sql<{ role: string }[]>`
      SELECT COALESCE(m.role, CASE WHEN o.created_by = ${userId} THEN 'owner' ELSE NULL END) AS role
      FROM organizations o
      LEFT JOIN organization_members m
        ON m.organization_id = o.id AND m.user_id = ${userId}
      WHERE o.id = ${organizationId}
      LIMIT 1
    `;
    const effectiveRole = rows[0]?.role as OrganizationMemberRole | undefined;
    if (!effectiveRole) return false;
    if (!roles || roles.length === 0) return true;
    return roles.includes(effectiveRole);
  }

  async createOrganization(org: Organization, ownerUserId: string): Promise<Organization> {
    return this.tx(async (s) => {
      await this.lockQuotaScope(s, `orgs:${ownerUserId}`);
      const mine = await s<{ plan_tier: string }[]>`
        SELECT plan_tier FROM organizations WHERE created_by = ${ownerUserId}
      `;
      assertOrganizationCap(mine.map((o) => ({ planTier: o.plan_tier })));
      const existingSlug = await this.getOrganizationBySlug(org.slug, s);
      if (existingSlug && existingSlug.id !== org.id) {
        throw Object.assign(new Error(`Organization slug "${org.slug}" is already taken.`), {
          statusCode: 409,
        });
      }
      const rows = await s<OrganizationRow[]>`
        INSERT INTO organizations (
          id, name, slug, logo_url, description, website, contact_email, contact_phone,
          city, state, country, verification_status, plan_tier, trial_ends_at,
          max_tournaments_quota, max_players_per_tournament, event_credits_remaining,
          can_publish_global, can_accept_paid_registrations, payment_instructions,
          payment_qr_storage_path, created_by, verified_at, verified_by, created_at, updated_at
        )
        VALUES (
          ${org.id}, ${org.name}, ${org.slug}, ${org.logoUrl ?? null}, ${org.description ?? null},
          ${org.website ?? null}, ${org.contactEmail ?? null}, ${org.contactPhone ?? null},
          ${org.city ?? null}, ${org.state ?? null}, ${org.country ?? 'Malaysia'},
          ${org.verificationStatus}, ${org.planTier}, ${org.trialEndsAt ?? null},
          ${org.maxTournamentsQuota ?? 1}, ${org.maxPlayersPerTournament ?? 24},
          ${org.eventCreditsRemaining ?? 0}, ${org.canPublishGlobal ?? false},
          ${org.canAcceptPaidRegistrations ?? false}, ${org.paymentInstructions ?? null},
          ${org.paymentQrStoragePath ?? null}, ${org.createdBy ?? ownerUserId},
          ${org.verifiedAt ?? null}, ${org.verifiedBy ?? null},
          ${org.createdAt}, ${org.updatedAt}
        )
        RETURNING *
      `;
      await s`
        INSERT INTO organization_members (organization_id, user_id, role, created_at)
        VALUES (${org.id}, ${ownerUserId}, 'owner', ${org.createdAt})
        ON CONFLICT (organization_id, user_id) DO NOTHING
      `;
      await s`
        UPDATE profiles
        SET account_role = CASE WHEN account_role = 'participant' THEN 'both' ELSE 'organizer' END,
            default_organization_id = COALESCE(default_organization_id, ${org.id}),
            updated_at = ${org.updatedAt}
        WHERE id = ${ownerUserId}
      `;
      return rowToOrganization(rows[0]!);
    });
  }

  async updateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'name'
        | 'slug'
        | 'logoUrl'
        | 'description'
        | 'website'
        | 'contactEmail'
        | 'contactPhone'
        | 'city'
        | 'state'
        | 'country'
        | 'paymentInstructions'
        | 'paymentQrStoragePath'
      >
    >,
  ): Promise<Organization | null> {
    const existing = await this.getOrganization(id);
    if (!existing) return null;
    if (patch.slug && patch.slug.toLowerCase() !== existing.slug.toLowerCase()) {
      const clash = await this.getOrganizationBySlug(patch.slug);
      if (clash && clash.id !== id) {
        throw Object.assign(new Error(`Organization slug "${patch.slug}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    const m = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    const rows = await this.sql<OrganizationRow[]>`
      UPDATE organizations SET
        name = ${m.name},
        slug = ${m.slug},
        logo_url = ${m.logoUrl ?? null},
        description = ${m.description ?? null},
        website = ${m.website ?? null},
        contact_email = ${m.contactEmail ?? null},
        contact_phone = ${m.contactPhone ?? null},
        city = ${m.city ?? null},
        state = ${m.state ?? null},
        country = ${m.country ?? null},
        payment_instructions = ${m.paymentInstructions ?? null},
        payment_qr_storage_path = ${m.paymentQrStoragePath ?? null},
        updated_at = ${m.updatedAt}
      WHERE id = ${id}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToOrganization(row) : null;
  }

  async listAllOrganizationsForAdmin(): Promise<AdminOrganizationRow[]> {
    const rows = await this.sql<
      (OrganizationRow & {
        member_count: string;
        tournament_count: string;
        owner_email: string | null;
      })[]
    >`
      SELECT
        o.*,
        (
          SELECT COUNT(*)::text
          FROM organization_members m
          WHERE m.organization_id = o.id
        ) AS member_count,
        (
          SELECT COUNT(*)::text
          FROM tournaments t
          WHERE t.deleted_at IS NULL
            AND (
              t.organization_id = o.id
              OR (t.organization_id IS NULL AND t.owner_id IS NOT NULL AND t.owner_id = o.created_by)
            )
        ) AS tournament_count,
        u.email AS owner_email
      FROM organizations o
      LEFT JOIN auth.users u ON u.id = o.created_by
      ORDER BY o.created_at DESC
    `;
    return rows.map((r) => ({
      ...rowToOrganization(r),
      memberCount: Math.max(1, Number(r.member_count ?? 1)),
      tournamentCount: Number(r.tournament_count ?? 0),
      ownerEmail: r.owner_email ?? r.contact_email ?? null,
    }));
  }

  async adminUpdateOrganization(
    id: string,
    patch: Partial<
      Pick<
        Organization,
        | 'verificationStatus'
        | 'planTier'
        | 'trialEndsAt'
        | 'maxTournamentsQuota'
        | 'maxPlayersPerTournament'
        | 'eventCreditsRemaining'
        | 'canPublishGlobal'
        | 'canAcceptPaidRegistrations'
        | 'verifiedAt'
        | 'verifiedBy'
      >
    >,
  ): Promise<Organization | null> {
    const existing = await this.getOrganization(id);
    if (!existing) return null;
    const m = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    const rows = await this.sql<OrganizationRow[]>`
      UPDATE organizations SET
        verification_status = ${m.verificationStatus},
        plan_tier = ${m.planTier},
        trial_ends_at = ${m.trialEndsAt ?? null},
        max_tournaments_quota = ${m.maxTournamentsQuota ?? null},
        max_players_per_tournament = ${m.maxPlayersPerTournament ?? null},
        event_credits_remaining = ${m.eventCreditsRemaining ?? 0},
        can_publish_global = ${m.canPublishGlobal ?? false},
        can_accept_paid_registrations = ${m.canAcceptPaidRegistrations ?? false},
        verified_at = ${m.verifiedAt ?? null},
        verified_by = ${m.verifiedBy ?? null},
        updated_at = ${m.updatedAt}
      WHERE id = ${id}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToOrganization(row) : null;
  }

  // ---- Player Profiles (B2C) ----

  async listPlayerProfiles(accountUserId: string): Promise<PlayerProfile[]> {
    const rows = await this.sql<PlayerProfileRow[]>`
      SELECT * FROM player_profiles
      WHERE account_user_id = ${accountUserId}
      ORDER BY is_primary DESC, created_at ASC
    `;
    return rows.map(rowToPlayerProfile);
  }

  async getPlayerProfile(id: string): Promise<PlayerProfile | null> {
    const rows = await this.sql<PlayerProfileRow[]>`
      SELECT * FROM player_profiles WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToPlayerProfile(row) : null;
  }

  async createPlayerProfile(profile: PlayerProfile): Promise<PlayerProfile> {
    if (profile.username) {
      const norm = profile.username.trim().toLowerCase();
      const clash = await this.sql<{ id: string }[]>`
        SELECT id::text AS id FROM player_profiles
        WHERE lower(username) = ${norm} AND id <> ${profile.id}
        LIMIT 1
      `;
      if (clash[0]) {
        throw Object.assign(new Error(`Username "@${profile.username}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    const existing = await this.listPlayerProfiles(profile.accountUserId);
    const shouldBePrimary = profile.isPrimary || existing.length === 0;
    if (shouldBePrimary && existing.some((p) => p.isPrimary)) {
      await this.sql`
        UPDATE player_profiles
        SET is_primary = false
        WHERE account_user_id = ${profile.accountUserId} AND is_primary = true
      `;
    }
    const rows = await this.sql<PlayerProfileRow[]>`
      INSERT INTO player_profiles (
        id, account_user_id, is_primary, relationship, username, full_name,
        date_of_birth, year_of_birth, gender, national_id, fide_id,
        fide_standard, fide_rapid, fide_blitz, alokas_rating,
        school, club, city, state, country, email, phone, created_at, updated_at
      )
      VALUES (
        ${profile.id}, ${profile.accountUserId}, ${shouldBePrimary}, ${profile.relationship},
        ${profile.username ?? null}, ${profile.fullName},
        ${profile.dateOfBirth ?? null}, ${profile.yearOfBirth ?? null},
        ${profile.gender ?? null}, ${profile.nationalId ?? null}, ${profile.fideId ?? null},
        ${profile.fideStandard ?? null}, ${profile.fideRapid ?? null}, ${profile.fideBlitz ?? null},
        ${profile.alokasRating ?? 1000},
        ${profile.school ?? null}, ${profile.club ?? null}, ${profile.city ?? null},
        ${profile.state ?? null}, ${profile.country ?? 'Malaysia'},
        ${profile.email ?? null}, ${profile.phone ?? null},
        ${profile.createdAt}, ${profile.updatedAt}
      )
      RETURNING *
    `;
    return rowToPlayerProfile(rows[0]!);
  }

  async updatePlayerProfile(
    id: string,
    accountUserId: string,
    patch: Partial<Omit<PlayerProfile, 'id' | 'accountUserId' | 'createdAt'>>,
  ): Promise<PlayerProfile | null> {
    const existing = await this.getPlayerProfile(id);
    if (!existing || existing.accountUserId !== accountUserId) return null;
    if (patch.username) {
      const norm = patch.username.trim().toLowerCase();
      const clash = await this.sql<{ id: string }[]>`
        SELECT id::text AS id FROM player_profiles
        WHERE lower(username) = ${norm} AND id <> ${id}
        LIMIT 1
      `;
      if (clash[0]) {
        throw Object.assign(new Error(`Username "@${patch.username}" is already taken.`), {
          statusCode: 409,
        });
      }
    }
    if (patch.isPrimary) {
      await this.sql`
        UPDATE player_profiles
        SET is_primary = false
        WHERE account_user_id = ${accountUserId} AND id <> ${id} AND is_primary = true
      `;
    }
    const m = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    const rows = await this.sql<PlayerProfileRow[]>`
      UPDATE player_profiles SET
        is_primary = ${m.isPrimary},
        relationship = ${m.relationship},
        username = ${m.username ?? null},
        full_name = ${m.fullName},
        date_of_birth = ${m.dateOfBirth ?? null},
        year_of_birth = ${m.yearOfBirth ?? null},
        gender = ${m.gender ?? null},
        national_id = ${m.nationalId ?? null},
        fide_id = ${m.fideId ?? null},
        fide_standard = ${m.fideStandard ?? null},
        fide_rapid = ${m.fideRapid ?? null},
        fide_blitz = ${m.fideBlitz ?? null},
        alokas_rating = ${m.alokasRating ?? 1000},
        school = ${m.school ?? null},
        club = ${m.club ?? null},
        city = ${m.city ?? null},
        state = ${m.state ?? null},
        country = ${m.country ?? null},
        email = ${m.email ?? null},
        phone = ${m.phone ?? null},
        updated_at = ${m.updatedAt}
      WHERE id = ${id} AND account_user_id = ${accountUserId}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToPlayerProfile(row) : null;
  }

  async deletePlayerProfile(id: string, accountUserId: string): Promise<boolean> {
    const deleted = await this.sql<{ id: string }[]>`
      DELETE FROM player_profiles
      WHERE id = ${id} AND account_user_id = ${accountUserId}
      RETURNING id::text AS id
    `;
    return deleted.length > 0;
  }

  async claimPastParticipations(
    accountUserId: string,
    profileId: string,
    confirmedEmail: string,
  ): Promise<{ claimedCount: number; participantIds: string[] }> {
    const profile = await this.getPlayerProfile(profileId);
    if (!profile || profile.accountUserId !== accountUserId) {
      throw Object.assign(new Error('Player profile not found'), { statusCode: 404 });
    }
    const target = confirmedEmail.trim().toLowerCase();
    if (!target) return { claimedCount: 0, participantIds: [] };

    const now = new Date().toISOString();
    const rows = await this.sql<{ id: string }[]>`
      UPDATE participants
      SET player_profile_id = ${profileId}, updated_at = ${now}
      WHERE deleted_at IS NULL
        AND (player_profile_id IS NULL OR player_profile_id = ${profileId})
        AND email IS NOT NULL
        AND lower(trim(email)) = ${target}
        AND lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = ${normalizePlayerName(profile.fullName)}
      RETURNING id::text AS id
    `;
    const ids = rows.map((r) => r.id);
    return { claimedCount: ids.length, participantIds: ids };
  }

  async getPlayerCareerDashboard(
    accountUserId: string,
    profileId?: string | null,
    confirmedEmail?: string | null,
  ): Promise<PlayerCareerDashboard> {
    const profiles = await this.listPlayerProfiles(accountUserId);
    const selectedProfile =
      (profileId ? profiles.find((p) => p.id === profileId) : null) ??
      profiles.find((p) => p.isPrimary) ??
      profiles[0] ??
      null;

    if (!selectedProfile) {
      return {
        profiles,
        selectedProfile: null,
        liveMatches: [],
        stats: {
          tournamentsCount: 0,
          gamesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          totalPoints: 0,
        },
        tournaments: [],
        certificates: [],
      };
    }

    const partRows = await this.sql<ParticipantRow[]>`
      SELECT p.*
      FROM participants p
      INNER JOIN tournaments t ON t.id = p.tournament_id
      WHERE p.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND p.player_profile_id = ${selectedProfile.id}
    `;
    const matchedParticipants = partRows.map(rowToParticipant);
    const tournamentIds = [...new Set(matchedParticipants.map((p) => p.tournamentId))];

    const participations: Array<{ participant: Participant; tournament: Tournament }> = [];
    const gamesByTournament = new Map<string, Game[]>();
    const participantsById = new Map<string, Participant>();

    if (tournamentIds.length > 0) {
      const [tRows, gRows, allPartRows] = await Promise.all([
        this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE id IN ${this.sql(tournamentIds)} AND deleted_at IS NULL
        `,
        this.sql<GameRow[]>`
          SELECT * FROM games
          WHERE tournament_id IN ${this.sql(tournamentIds)} AND deleted_at IS NULL
        `,
        this.sql<ParticipantRow[]>`
          SELECT * FROM participants
          WHERE tournament_id IN ${this.sql(tournamentIds)} AND deleted_at IS NULL
        `,
      ]);
      const tById = new Map(tRows.map((r) => [r.id, rowToTournament(r)]));
      for (const part of matchedParticipants) {
        const t = tById.get(part.tournamentId);
        if (t) participations.push({ participant: part, tournament: t });
      }
      for (const gRow of gRows) {
        const g = rowToGame(gRow);
        const list = gamesByTournament.get(g.tournamentId) ?? [];
        list.push(g);
        gamesByTournament.set(g.tournamentId, list);
      }
      for (const pRow of allPartRows) {
        const p = rowToParticipant(pRow);
        participantsById.set(p.id, p);
      }
    }

    const participantIds = matchedParticipants.map((p) => p.id);
    const profileEmailLower = certificateEmailFor(selectedProfile, confirmedEmail);

    let certItems: PlayerCertificateItem[] = [];
    if (participantIds.length > 0 || profileEmailLower) {
      const certRows = await this.sql<
        {
          id: string;
          tournament_id: string;
          tournament_name: string;
          tournament_date: string | null;
          participant_id: string | null;
          recipient_name: string;
          type: string;
          rank: number | null;
          serial: string | null;
          created_at: Date | string;
        }[]
      >`
        SELECT
          c.id::text AS id,
          c.tournament_id::text AS tournament_id,
          t.name AS tournament_name,
          t.date AS tournament_date,
          c.participant_id::text AS participant_id,
          c.recipient_name,
          c.type,
          c.rank,
          c.serial,
          c.created_at
        FROM certificate_issues c
        INNER JOIN tournaments t ON t.id = c.tournament_id
        WHERE (
          ${participantIds.length > 0 ? this.sql`c.participant_id IN ${this.sql(participantIds)}` : this.sql`false`}
          OR (
            ${profileEmailLower}::text IS NOT NULL
            AND c.recipient_email IS NOT NULL
            AND lower(trim(c.recipient_email)) = ${profileEmailLower}::text
          )
        )
        ORDER BY c.created_at DESC
      `;
      certItems = certRows.map((r) => ({
        id: r.id,
        tournamentId: r.tournament_id,
        tournamentName: r.tournament_name,
        tournamentDate: r.tournament_date ?? null,
        participantId: r.participant_id ?? null,
        recipientName: r.recipient_name,
        type: r.type as CertificateIssueType,
        rank: r.rank != null ? Number(r.rank) : null,
        serial: r.serial ?? null,
        createdAt: toIso(r.created_at)!,
      }));
    }

    return buildCareerDashboard({
      profiles,
      selectedProfile,
      participations,
      gamesByTournament,
      participantsById,
      certificates: certItems,
    });
  }

  // ---- Tournament Discovery & Registrations (Phase 2) ----

  async getTournamentBySlugOrId(slugOrId: string): Promise<Tournament | null> {
    const trimmed = slugOrId.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const norm = trimmed.toLowerCase();
    const rows = isUuid
      ? await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE deleted_at IS NULL
            AND (id = ${trimmed}::uuid OR lower(public_slug) = ${norm})
          LIMIT 1
        `
      : await this.sql<TournamentRow[]>`
          SELECT * FROM tournaments
          WHERE deleted_at IS NULL
            AND public_slug IS NOT NULL
            AND lower(public_slug) = ${norm}
          LIMIT 1
        `;
    const row = rows[0];
    return row ? rowToTournament(row) : null;
  }

  async listPublishedEvents(filters?: {
    lat?: number;
    lng?: number;
    radiusKm?: number;
    search?: string;
  }): Promise<PublicEventSummary[]> {
    const q = filters?.search?.trim().toLowerCase() || '';
    const hasCoords =
      filters?.lat != null &&
      filters?.lng != null &&
      Number.isFinite(filters.lat) &&
      Number.isFinite(filters.lng);
    const radiusKm =
      filters?.radiusKm != null && Number.isFinite(filters.radiusKm) && filters.radiusKm > 0
        ? filters.radiusKm
        : null;

    const rows = await this.sql<
      (TournamentRow & {
        organization_name: string | null;
        registered_count: string;
      })[]
    >`
      SELECT
        t.*,
        o.name AS organization_name,
        (
          SELECT COUNT(*)::text
          FROM participants p
          WHERE p.tournament_id = t.id AND p.deleted_at IS NULL
        ) AS registered_count
      FROM tournaments t
      JOIN organizations o ON o.id = t.organization_id
      WHERE t.deleted_at IS NULL
        AND t.is_published_global = true
        AND o.verification_status = 'verified'
        AND o.can_publish_global = true
      ORDER BY t.date ASC NULLS LAST, t.updated_at DESC
    `;

    const tournamentIds = rows.map((r) => r.id);
    const categoriesByTournament = new Map<string, Array<{ id: string; name: string }>>();
    if (tournamentIds.length > 0) {
      const catRows = await this.sql<{ id: string; tournament_id: string; name: string }[]>`
        SELECT id::text AS id, tournament_id::text AS tournament_id, name
        FROM categories
        WHERE tournament_id IN ${this.sql(tournamentIds)}
          AND deleted_at IS NULL
        ORDER BY sort_order ASC
      `;
      for (const c of catRows) {
        const list = categoriesByTournament.get(c.tournament_id) ?? [];
        list.push({ id: c.id, name: c.name });
        categoriesByTournament.set(c.tournament_id, list);
      }
    }

    const events: PublicEventSummary[] = [];
    for (const r of rows) {
      const t = rowToTournament(r);
      const orgName = r.organization_name ?? null;
      if (q) {
        const hay = [
          t.name,
          t.venueName,
          t.venueAddress,
          t.city,
          t.state,
          t.country,
          orgName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }

      let distanceKm: number | null = null;
      if (hasCoords && t.latitude != null && t.longitude != null) {
        distanceKm = haversineDistanceKm(filters!.lat!, filters!.lng!, t.latitude, t.longitude);
      }
      if (hasCoords && radiusKm != null) {
        if (distanceKm == null || distanceKm > radiusKm) continue;
      }

      events.push({
        id: t.id,
        publicSlug: t.publicSlug ?? null,
        name: t.name,
        date: t.date ?? null,
        style: t.style,
        rounds: t.rounds,
        status: t.status,
        registrationOpen: Boolean(t.registrationOpen),
        registrationDeadline: t.registrationDeadline ?? null,
        maxParticipants: t.maxParticipants ?? null,
        registeredCount: Number(r.registered_count ?? 0),
        venueName: t.venueName ?? null,
        venueAddress: t.venueAddress ?? null,
        city: t.city ?? null,
        state: t.state ?? null,
        country: t.country ?? 'Malaysia',
        latitude: t.latitude ?? null,
        longitude: t.longitude ?? null,
        distanceKm,
        timeControl: t.timeControl ?? null,
        entryFeeCents: t.entryFeeCents ?? 0,
        currency: t.currency ?? 'MYR',
        descriptionMd: t.descriptionMd ?? null,
        organizationName: orgName,
        categories: categoriesByTournament.get(t.id) ?? [],
      });
    }

    if (hasCoords) {
      events.sort((a, b) => {
        if (a.distanceKm != null && b.distanceKm != null) {
          if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        } else if (a.distanceKm != null) {
          return -1;
        } else if (b.distanceKm != null) {
          return 1;
        }
        return (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31');
      });
    }

    return events;
  }

  async listTournamentRegistrations(tournamentId: string): Promise<TournamentRegistration[]> {
    const rows = await this.sql<TournamentRegistrationRow[]>`
      SELECT * FROM tournament_registrations
      WHERE tournament_id = ${tournamentId}
      ORDER BY created_at DESC
    `;
    return rows.map(rowToTournamentRegistration);
  }

  async listUserRegistrations(userId: string): Promise<TournamentRegistration[]> {
    const rows = await this.sql<TournamentRegistrationRow[]>`
      SELECT r.*
      FROM tournament_registrations r
      LEFT JOIN player_profiles pp ON pp.id = r.player_profile_id
      WHERE r.submitted_by_user_id = ${userId}
        OR pp.account_user_id = ${userId}
      ORDER BY r.created_at DESC
    `;
    return rows.map(rowToTournamentRegistration);
  }

  async createTournamentRegistration(
    reg: TournamentRegistration,
  ): Promise<TournamentRegistration> {
    if (reg.playerProfileId) {
      const clash = await this.sql<{ id: string }[]>`
        SELECT id::text AS id
        FROM tournament_registrations
        WHERE tournament_id = ${reg.tournamentId}
          AND player_profile_id = ${reg.playerProfileId}
          AND status NOT IN ('cancelled', 'rejected')
          AND id <> ${reg.id}
        LIMIT 1
      `;
      if (clash[0]) {
        throw Object.assign(
          new Error('This player profile already has an active registration for this tournament.'),
          { statusCode: 409 },
        );
      }
    }
    const normName = reg.playerSnapshot.name.trim().toLowerCase();
    const normEmail = reg.playerSnapshot.email?.trim().toLowerCase() || '';
    if (normName && normEmail) {
      const clash = await this.sql<{ id: string }[]>`
        SELECT id::text AS id
        FROM tournament_registrations
        WHERE tournament_id = ${reg.tournamentId}
          AND status NOT IN ('cancelled', 'rejected')
          AND id <> ${reg.id}
          AND lower(trim(coalesce(player_snapshot->>'name', ''))) = ${normName}
          AND lower(trim(coalesce(player_snapshot->>'email', ''))) = ${normEmail}
        LIMIT 1
      `;
      if (clash[0]) {
        throw Object.assign(
          new Error('This player is already registered for this tournament.'),
          { statusCode: 409 },
        );
      }
    }

    const rows = await this.sql<TournamentRegistrationRow[]>`
      INSERT INTO tournament_registrations (
        id, tournament_id, player_profile_id, submitted_by_user_id, selected_category_id,
        player_snapshot, custom_answers, payment_status, receipt_data_url,
        receipt_storage_path, receipt_content_type, amount_cents,
        status, reviewer_note, reviewed_at, participant_id, created_at, updated_at
      )
      VALUES (
        ${reg.id}, ${reg.tournamentId}, ${reg.playerProfileId ?? null},
        ${reg.submittedByUserId ?? null}, ${reg.selectedCategoryId ?? null},
        ${this.j(reg.playerSnapshot)}, ${this.j(reg.customAnswers ?? {})},
        ${reg.paymentStatus}, ${reg.receiptDataUrl ?? null},
        ${reg.receiptStoragePath ?? null}, ${reg.receiptContentType ?? null}, ${reg.amountCents ?? 0},
        ${reg.status}, ${reg.reviewerNote ?? null}, ${reg.reviewedAt ?? null},
        ${reg.participantId ?? null}, ${reg.createdAt}, ${reg.updatedAt}
      )
      RETURNING *
    `;
    return rowToTournamentRegistration(rows[0]!);
  }

  async reviewTournamentRegistration(
    tournamentId: string,
    regId: string,
    input: {
      action: 'approve' | 'reject' | 'waitlist';
      reviewerNote?: string | null;
      categoryIds?: string[];
      confirmPaymentWithoutReceipt?: boolean;
    },
  ): Promise<{ registration: TournamentRegistration; participant: Participant | null }> {
    return this.tx(async (s) => {
      // Tournament first, the same order sync takes, so the two can't deadlock.
      const [lockedTournament] = await s<TournamentRow[]>`
        SELECT * FROM tournaments WHERE id = ${tournamentId} FOR UPDATE
      `;
      const regRows = await s<TournamentRegistrationRow[]>`
        SELECT * FROM tournament_registrations
        WHERE id = ${regId} AND tournament_id = ${tournamentId}
        LIMIT 1
        FOR UPDATE
      `;
      const regRow = regRows[0];
      if (!regRow) {
        throw Object.assign(new Error('Registration not found'), { statusCode: 404 });
      }
      const reg = rowToTournamentRegistration(regRow);
      const tournament = lockedTournament ? rowToTournament(lockedTournament) : null;
      if (!tournament || tournament.deletedAt) {
        throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
      }

      assertReviewTransition(reg.status, input.action);

      const now = new Date().toISOString();

      if (input.action === 'approve') {
        const approvedPayment = paymentStatusOnApprove(reg, input.confirmPaymentWithoutReceipt);
        if (tournament.maxParticipants != null) {
          const [countRow] = await s<{ count: string }[]>`
            SELECT COUNT(*)::text AS count FROM participants
            WHERE tournament_id = ${tournamentId} AND deleted_at IS NULL
              AND id IS DISTINCT FROM ${reg.participantId ?? null}::uuid
          `;
          if (Number(countRow?.count ?? 0) >= tournament.maxParticipants) {
            throw tournamentFullConflict(tournament.maxParticipants);
          }
        }
        const snap = reg.playerSnapshot;
        const currentYear = new Date().getFullYear();
        const computedAge =
          snap.age != null
            ? snap.age
            : snap.yearOfBirth != null
              ? Math.max(0, currentYear - snap.yearOfBirth)
              : 0;

        const categories = await this.listCategories(tournamentId, false, s);
        const validCatIds = new Set(categories.map((c) => c.id));
        let assignedCatIds: string[];
        if (input.categoryIds && input.categoryIds.length > 0) {
          assignedCatIds = input.categoryIds.filter((cid) => validCatIds.has(cid));
        } else {
          const autoMap = assignCategories(
            [
              {
                name: snap.name,
                age: computedAge,
                gender: snap.gender ?? null,
                rating: snap.rating ?? null,
                club: snap.club ?? snap.school ?? null,
                customFields: reg.customAnswers ?? {},
              },
            ],
            categories,
          );
          const autoIds = autoMap.get(0) ?? [];
          const merged = new Set<string>(autoIds);
          if (reg.selectedCategoryId && validCatIds.has(reg.selectedCategoryId)) {
            merged.add(reg.selectedCategoryId);
          }
          assignedCatIds = [...merged];
        }

        const participantId = reg.participantId ?? crypto.randomUUID();
        const participant: Participant = {
          id: participantId,
          tournamentId,
          name: snap.name,
          age: computedAge,
          gender: snap.gender ?? null,
          rating: snap.rating ?? null,
          fideId: snap.fideId ?? null,
          school: snap.school ?? null,
          club: snap.club ?? null,
          city: snap.city ?? null,
          state: snap.state ?? null,
          country: snap.country ?? 'Malaysia',
          yearOfBirth: snap.yearOfBirth ?? null,
          email: snap.email || null,
          customFields: {
            ...(reg.customAnswers ?? {}),
            ...(snap.phone ? { phone: snap.phone } : {}),
          },
          categoryIds: assignedCatIds,
          playerProfileId: reg.playerProfileId ?? null,
          updatedAt: now,
        };

        const [upserted] = await this.upsertParticipantsIn([participant], s);
        const finalParticipant = upserted ?? participant;

        const note =
          input.reviewerNote !== undefined ? input.reviewerNote : (reg.reviewerNote ?? null);

        const updatedRows = await s<TournamentRegistrationRow[]>`
          UPDATE tournament_registrations SET
            status = 'approved',
            payment_status = ${approvedPayment},
            participant_id = ${finalParticipant.id},
            reviewer_note = ${note},
            reviewed_at = ${now},
            updated_at = ${now}
          WHERE id = ${regId} AND tournament_id = ${tournamentId}
          RETURNING *
        `;
        return {
          registration: rowToTournamentRegistration(updatedRows[0]!),
          participant: finalParticipant,
        };
      }

      if (reg.status === 'approved' && reg.participantId) {
        const pid = reg.participantId;
        const played = await s`
          SELECT 1 FROM games
          WHERE tournament_id = ${tournamentId}
            AND deleted_at IS NULL
            AND round <= ${tournament.confirmedRounds ?? 0}
            AND (white_id = ${pid} OR black_id = ${pid})
          LIMIT 1
        `;
        if (played.length > 0) throw confirmedGamesConflict();
        await s`
          UPDATE participants SET deleted_at = ${now}, updated_at = ${now}
          WHERE id = ${pid} AND deleted_at IS NULL
        `;
      }

      const nextStatus: RegistrationStatus =
        input.action === 'waitlist' ? 'waitlisted' : 'rejected';
      const note =
        input.reviewerNote !== undefined ? input.reviewerNote : (reg.reviewerNote ?? null);
      const updatedRows = await s<TournamentRegistrationRow[]>`
        UPDATE tournament_registrations SET
          status = ${nextStatus},
          reviewer_note = ${note},
          reviewed_at = ${now},
          updated_at = ${now}
        WHERE id = ${regId} AND tournament_id = ${tournamentId}
        RETURNING *
      `;
      return {
        registration: rowToTournamentRegistration(updatedRows[0]!),
        participant: null,
      };
    });
  }

  async reserveEmailSends(input: EmailSendReservation): Promise<EmailSendQuota> {
    return this.tx(async (s) => {
      await this.lockQuotaScope(s, `email:${input.kind}:${input.scopeKey}`);
      const [row] = await s<{ used: number }[]>`
        SELECT COALESCE(SUM(recipient_count), 0)::int AS used
        FROM email_sends
        WHERE scope_key = ${input.scopeKey}
          AND kind = ${input.kind}
          AND created_at > now() - interval '24 hours'
      `;
      const used = Number(row?.used ?? 0);
      if (used + input.count > input.limit) {
        return { allowed: false, used, limit: input.limit };
      }
      await s`
        INSERT INTO email_sends (scope_key, kind, tournament_id, user_id, recipient_count)
        VALUES (${input.scopeKey}, ${input.kind}, ${input.tournamentId ?? null},
                ${input.userId ?? null}, ${input.count})
      `;
      return { allowed: true, used: used + input.count, limit: input.limit };
    });
  }

  // ---- Floor Chief Arbiter Alerts (Phase 3) ----

  async createFloorAlert(alert: FloorAlert): Promise<FloorAlert> {
    const rows = await this.sql<FloorAlertRow[]>`
      INSERT INTO floor_alerts (
        id, tournament_id, round, table_number, game_id, arbiter_name, reason, created_at, resolved_at
      )
      VALUES (
        ${alert.id}, ${alert.tournamentId}, ${alert.round}, ${alert.tableNumber},
        ${alert.gameId ?? null}, ${alert.arbiterName ?? null}, ${alert.reason},
        ${alert.createdAt}, ${alert.resolvedAt ?? null}
      )
      RETURNING *
    `;
    return rowToFloorAlert(rows[0]!);
  }

  async listFloorAlerts(tournamentId: string, activeOnly = true): Promise<FloorAlert[]> {
    const rows = activeOnly
      ? await this.sql<FloorAlertRow[]>`
          SELECT * FROM floor_alerts
          WHERE tournament_id = ${tournamentId} AND resolved_at IS NULL
          ORDER BY created_at DESC
        `
      : await this.sql<FloorAlertRow[]>`
          SELECT * FROM floor_alerts
          WHERE tournament_id = ${tournamentId}
          ORDER BY created_at DESC
        `;
    return rows.map(rowToFloorAlert);
  }

  async resolveFloorAlert(id: string): Promise<FloorAlert | null> {
    const now = new Date().toISOString();
    const rows = await this.sql<FloorAlertRow[]>`
      UPDATE floor_alerts
      SET resolved_at = COALESCE(resolved_at, ${now})
      WHERE id = ${id}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToFloorAlert(row) : null;
  }
}

// ---------------------------------------------------------------------------
// Factory – returns the right store based on environment
// ---------------------------------------------------------------------------

export function createStore(): Store {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    return new PostgresStore(dbUrl);
  }
  return new MemoryStore();
}
