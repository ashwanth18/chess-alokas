import type {
  Category,
  FloorAlert,
  Game,
  GameCard,
  Organization,
  OrganizationMemberRole,
  Participant,
  PlayerProfile,
  Tournament,
  TournamentRegistration,
  TournamentTable,
} from '@chess-alokas/shared';

export type DemoOrganization = Organization & { isDemo?: boolean };

export interface DemoAccount {
  userId: string;
  email: string;
  /** owner, director, arbiter, parent or teen. */
  label: string;
}

export interface DemoMember {
  userId: string;
  email: string;
  role: OrganizationMemberRole;
}

/** What the guard looks at before anything is deleted. */
export interface DemoScopeFacts {
  flaggedOrganizations: Array<{ id: string; slug: string }>;
  /** An organization with the demo slug that isn't flagged: someone real took the name. */
  unflaggedSlugHolder: boolean;
  /** Members and creators of the demo organization who aren't demo accounts. */
  foreignMembers: number;
  /** Entries in a real tournament that point at a demo account's player profile. */
  foreignProfileLinks: number;
}

export interface DemoCleared {
  tournamentsRemoved: number;
  profilesRemoved: number;
  /** Files for the caller to remove once the rows are gone. */
  receiptPaths: string[];
  certificatePaths: string[];
}

export interface DemoResultEvent {
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
}

export interface DemoCertificateRow {
  id: string;
  tournamentId: string;
  participantId: string | null;
  type: 'participation' | 'winner';
  rank: number | null;
  categoryId: string | null;
  recipientEmail: string | null;
  recipientName: string;
  storagePath: string;
  contentSha256: string;
  byteSize: number;
  status: 'stored';
  serial: string | null;
  createdAt: string;
}

export interface DemoFile {
  kind: 'receipt' | 'certificate';
  tournamentId: string;
  /** The registration or certificate this file belongs to. */
  ownerId: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface DemoTournamentPlan {
  tournament: Tournament & { completedAt?: string | null; arbiterPinHash?: string | null };
  categories: Category[];
  participants: Array<Participant & { checkedIn?: boolean }>;
  games: Game[];
  resultEvents: DemoResultEvent[];
  cards: GameCard[];
  tables: TournamentTable[];
  alerts: FloorAlert[];
  registrations: TournamentRegistration[];
  certificates: DemoCertificateRow[];
}

export interface DemoPlan {
  organization: DemoOrganization;
  members: DemoMember[];
  profiles: PlayerProfile[];
  tournaments: DemoTournamentPlan[];
  /** Written before the database, so a failed upload changes nothing that people can see. */
  files: DemoFile[];
  summary: DemoPlanSummary;
}

export interface DemoPlanSummary {
  engine: string;
  tournaments: number;
  participants: number;
  games: number;
  registrations: number;
  certificates: number;
  files: number;
}

/** Depends on which migrations this database has. */
export interface DemoCapabilities {
  /** 034: NRIC, age proof and the richer question types. */
  formBuilder: boolean;
  /** 036: the trigger that stops a shared account's password or email being changed. */
  credentialLock: boolean;
}

export interface DemoWriteResult {
  cleared: DemoCleared;
  /** Plan fields this database has no column for: added by a re-run after the migration. */
  skippedColumns: string[];
  realCounts: Record<string, number>;
  rolledBack: boolean;
}

/** Everything the demo tenant needs from a store. Implemented once per store, in this folder. */
export interface DemoOps {
  isAccount(userId: string): Promise<boolean>;
  listAccounts(): Promise<DemoAccount[]>;
  registerAccount(account: DemoAccount): Promise<void>;
  /** Forgets accounts whose sign-in is gone, or all of them, ending the tenant. */
  forgetAccounts(): Promise<void>;
  /** Allows, or with null stops allowing, a password change or deletion of these accounts. */
  setCredentialsUnlocked(userIds: string[], untilIso: string | null): Promise<void>;
  getOrganization(): Promise<DemoOrganization | null>;
  /**
   * The one switch for whether demo events appear in public Discover. It is the same
   * can_publish_global every feed already checks, so it also works on an older API.
   */
  setPubliclyListed(listed: boolean): Promise<boolean>;
  scopeFacts(): Promise<DemoScopeFacts>;
  capabilities(): Promise<DemoCapabilities>;
  /** Counts of rows that aren't demo. A run that changes one of these undoes itself. */
  realCounts(): Promise<Record<string, number>>;
  /**
   * Replaces all demo data with the plan, as one step, after the guard. Tournaments leave a
   * tombstone, so devices holding the old rows drop them on their next sync.
   */
  apply(plan: DemoPlan, options?: { dryRun?: boolean; placeholderAccounts?: DemoAccount[] }): Promise<DemoWriteResult>;
  /** Removes all demo data, the organization included. Accounts are forgotten separately. */
  removeAll(): Promise<DemoCleared>;
}
