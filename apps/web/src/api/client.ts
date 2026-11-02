import type {
  Tournament,
  Category,
  Participant,
  Game,
  SyncPushRequest,
  Organization,
  OrganizationMemberRole,
  OrganizationVerificationStatus,
  OrganizationPlanTier,
  AdminOrganizationRow,
  PlayerProfile,
  PlayerRelationship,
  PlayerCareerDashboard,
  PublicEventSummary,
  PublicRegistrationForm,
  RegistrationFormConfig,
  TournamentRegistration,
  FloorAlert,
  FloorZoneBoard,
  FilterGroup,
  SyncRejection,
  AcceptInviteResult,
  InviteEmailStatus,
  OrganizationInvite,
  OrganizationInvitePreview,
  OrganizationInviteStatus,
  OrganizationTeamMember,
} from '@chess-alokas/shared';
import type { GameResultEvent } from '@chess-alokas/shared';
import { supabase } from '../lib/supabase';

export function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.desktop?.getApiBaseUrl) {
    const fromDesktop = window.desktop.getApiBaseUrl();
    if (fromDesktop) return fromDesktop;
  }
  return import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
}

/** Reachable without signing in; everything else needs a token once auth is configured. */
function isPublicPath(path: string): boolean {
  return path === '/health' || path.startsWith('/public/');
}

/**
 * getSession can hang when a token refresh is stuck offline, so it gets the request's own deadline.
 * Returns null when that deadline passes, which is a connection problem, not a signed-out user.
 */
async function getAuthHeaders(signal: AbortSignal): Promise<Record<string, string> | null> {
  if (!supabase) return {};
  const expired = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null);
    else signal.addEventListener('abort', () => resolve(null), { once: true });
  });
  const session = supabase.auth.getSession().then(({ data }): Record<string, string> => {
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  });
  return Promise.race([session, expired]);
}

async function req<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<{ data: T; ok: true } | { data: null; ok: false; error: string; status?: number }> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const defaultTimeout = path.startsWith('/sync')
    ? 60_000
    : path.includes('/certificates/')
      ? 120_000
      : 8_000;
  const BASE_URL = resolveApiBaseUrl();
  const deadline = AbortSignal.timeout(timeoutMs ?? defaultTimeout);
  try {
    const authHeaders = await getAuthHeaders(deadline);
    if (!isPublicPath(path) && supabase) {
      // Not sending these also means no 401, which would sign the person out: an outage or a
      // stuck session check must never cost anyone their saved sign-in.
      if (authHeaders === null) {
        return { data: null, ok: false, error: 'Sign-in check timed out' };
      }
      if (!('Authorization' in authHeaders)) {
        return { data: null, ok: false, error: 'Not signed in' };
      }
    }
    const hasBody = fetchOptions.body != null && fetchOptions.body !== '';
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: deadline,
      ...fetchOptions,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeaders ?? {}),
        ...(fetchOptions.headers ?? {}),
      },
    });
    if (!res.ok) {
      let error = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        error = body.message ?? body.error ?? error;
      } catch {
        /* ignore */
      }
      if (res.status === 401 && typeof window !== 'undefined') {
        // The access token was rejected server-side and auto-refresh didn't
        // save it (revoked/expired session) — stop retrying silently and
        // let AuthContext sign the user out so they're prompted to log in
        // again instead of failing every sync forever with no feedback.
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
      return { data: null, ok: false, error, status: res.status };
    }
    if (res.status === 204) {
      return { data: null as T, ok: true };
    }
    const data = (await res.json()) as T;
    return { data, ok: true };
  } catch (err) {
    return {
      data: null,
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function checkOnline(): Promise<boolean> {
  const r = await req<{ ok: boolean }>('/health');
  return r.ok;
}

// ── Tournaments ──────────────────────────────────────────────────────────────
export async function apiGetTournaments() {
  return req<Tournament[]>('/tournaments');
}

export async function apiCreateTournament(payload: Partial<Tournament> & { name: string }) {
  return req<Tournament>('/tournaments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateTournament(id: string, payload: Partial<Tournament>) {
  return req<Tournament>(`/tournaments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteTournament(id: string) {
  return req<void>(`/tournaments/${id}`, { method: 'DELETE' });
}

// ── Import ───────────────────────────────────────────────────────────────────
export async function apiImportParticipants(
  tournamentId: string,
  payload: { participants: Partial<Participant>[]; columnMapping?: Record<string, string> },
) {
  return req<{ imported: number }>(`/tournaments/${tournamentId}/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Pairing ──────────────────────────────────────────────────────────────────
export async function apiDutchPair(input: {
  players: Array<{ id: string; name: string; rating?: number | null; seed?: number | null }>;
  pastGames: Array<{
    round: number;
    whiteId: string | null;
    blackId: string | null;
    result: string;
    isBye: boolean;
  }>;
  round: number;
  totalRounds: number;
  initialColor?: 'W' | 'B';
}) {
  return req<{
    boards: Array<{ board: number; whiteId: string | null; blackId: string | null; isBye: boolean }>;
    byePlayerId: string | null;
    engine: string;
  }>('/pairing/dutch', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

// ── Results ──────────────────────────────────────────────────────────────────
export async function apiSubmitResult(
  tournamentId: string,
  gameId: string,
  result: string,
) {
  return req<Game>(`/tournaments/${tournamentId}/games/${gameId}/result`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
}

// ── Standings ────────────────────────────────────────────────────────────────
export async function apiGetStandings(tournamentId: string, categoryId?: string) {
  const qs = categoryId ? `?categoryId=${categoryId}` : '';
  return req<unknown[]>(`/tournaments/${tournamentId}/standings${qs}`);
}

// ── Sync ─────────────────────────────────────────────────────────────────────
export interface SyncPullResponse {
  tournaments: Tournament[];
  categories: Category[];
  participants: Participant[];
  games: Game[];
  serverTime: string;
  /** Absent on an older server, which means nothing may be removed. */
  revokedTournamentIds?: string[];
  revokedForUserId?: string | null;
}

export async function apiSyncPush(body: SyncPushRequest) {
  return req<{
    accepted: number;
    serverTime: string;
    /** Rows the server did not save, and why. Sent only if the request asks with reportRejections. */
    rejected?: SyncRejection[];
  }>('/sync/push', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiSyncPull(since: string) {
  return req<SyncPullResponse>(`/sync/pull?since=${encodeURIComponent(since)}`);
}

// ── Certificates ─────────────────────────────────────────────────────────────
type CertificateIssueItem = {
  participantId?: string | null;
  type: 'participation' | 'winner';
  rank?: number | null;
  categoryId?: string | null;
  recipientEmail?: string | null;
  recipientName: string;
  serial?: string | null;
  pdfBase64: string;
};

/** Post certificates in small batches so PDF payloads stay under body limits. */
export async function apiIssueCertificates(
  tournamentId: string,
  items: CertificateIssueItem[],
  batchSize = 5,
) {
  let issued = 0;
  let storageBackend: 'supabase' | 'local' | undefined;
  const issues: unknown[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const res = await req<{
      issued: number;
      issues: unknown[];
      storageBackend?: 'supabase' | 'local';
    }>(`/tournaments/${tournamentId}/certificates/issue`, {
      method: 'POST',
      body: JSON.stringify({ items: chunk }),
    });
    if (!res.ok) {
      return {
        data: null,
        ok: false as const,
        error:
          i === 0
            ? res.error
            : `${res.error} (stored ${issued} of ${items.length} before failure)`,
      };
    }
    issued += res.data.issued;
    issues.push(...res.data.issues);
    storageBackend = res.data.storageBackend ?? storageBackend;
  }

  return {
    data: { issued, issues, storageBackend },
    ok: true as const,
  };
}

export async function apiListCertificates(tournamentId: string) {
  return req<{
    issues: Array<{
      id: string;
      tournamentId: string;
      participantId?: string | null;
      categoryId?: string | null;
      recipientName: string;
      recipientEmail?: string | null;
      type: 'participation' | 'winner';
      status: string;
      serial?: string | null;
      error?: string | null;
      emailedAt?: string | null;
      createdAt: string;
    }>;
  }>(`/tournaments/${tournamentId}/certificates`);
}

export async function apiReserveCertificateSerials(tournamentId: string, count: number) {
  return req<{ serials: string[] }>(`/tournaments/${tournamentId}/certificates/reserve-serials`, {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

export async function apiEmailCertificates(
  tournamentId: string,
  body: {
    issueIds?: string[];
    allPending?: boolean;
    resend?: boolean;
    subject?: string;
    body?: string;
  },
) {
  return req<{
    sent: number;
    failed: number;
    results: Array<{
      id: string;
      name: string;
      email: string | null;
      status: string;
      error?: string;
    }>;
  }>(`/tournaments/${tournamentId}/certificates/email`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiEmailCertificateTest(
  tournamentId: string,
  body: { to: string; subject?: string; body?: string; issueId?: string },
) {
  return req<{ sent: boolean; attachedPdf: boolean; to: string }>(
    `/tournaments/${tournamentId}/certificates/email-test`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

// ── Floor arbiter tables ─────────────────────────────────────────────────────

export type FloorTableRow = {
  id: string;
  tournamentId: string;
  tableNumber: number;
  slug: string;
  createdAt: string;
};

export type PlayerCardCounts = {
  illegalMove: number;
  warning: number;
};

export type FloorTableView = {
  slug: string;
  tableNumber: number;
  tournamentName: string;
  tournamentId: string;
  pinRound: number | null;
  round: number | null;
  gameId: string | null;
  whiteId: string | null;
  blackId: string | null;
  whiteName: string | null;
  blackName: string | null;
  status: 'needs_pin' | 'pending' | 'locked' | 'bye' | 'no_game' | 'confirmed_closed';
  result: string | null;
  sessionOk: boolean;
  whiteCards: PlayerCardCounts;
  blackCards: PlayerCardCounts;
  forfeitReason: string | null;
};

export async function apiFloorPrepare(
  tournamentId: string,
  body: { tableCount: number; pinRound: number; rotatePin?: boolean },
) {
  return req<{
    tables: FloorTableRow[];
    tableCount: number;
    arbiterPin: string | null;
    arbiterPinRound: number | null;
  }>(`/tournaments/${tournamentId}/floor/prepare`, {
    method: 'POST',
    body: JSON.stringify({ rotatePin: true, ...body }),
  });
}

export async function apiFloorListTables(tournamentId: string) {
  return req<{
    tables: FloorTableRow[];
    tableCount: number;
    arbiterPinRound: number | null;
  }>(`/tournaments/${tournamentId}/floor/tables`);
}

export async function apiFloorRotatePin(tournamentId: string, pinRound: number) {
  return req<{ arbiterPin: string; arbiterPinRound: number }>(
    `/tournaments/${tournamentId}/floor/rotate-pin`,
    {
      method: 'POST',
      body: JSON.stringify({ pinRound }),
    },
  );
}

export async function apiPublicTableGet(slug: string, sessionToken?: string | null) {
  return req<FloorTableView>(`/public/tables/${encodeURIComponent(slug)}`, {
    headers: sessionToken ? { 'X-Arbiter-Session': sessionToken } : {},
  });
}

export async function apiPublicTableSession(
  slug: string,
  pin: string,
  arbiterName?: string,
) {
  return req<{ token: string; table: FloorTableView }>(
    `/public/tables/${encodeURIComponent(slug)}/session`,
    {
      method: 'POST',
      body: JSON.stringify({ pin, ...(arbiterName ? { arbiterName } : {}) }),
    },
  );
}

export async function apiPublicTableZone(slug: string, token: string) {
  return req<{
    tournamentId: string;
    tournamentName: string;
    round: number;
    arbiterName: string | null;
    boards: FloorZoneBoard[];
  }>(`/public/tables/${encodeURIComponent(slug)}/zone`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Arbiter-Session': token,
    },
  });
}

export async function apiPublicTableCallChief(
  slug: string,
  token: string,
  reason: string,
  arbiterName?: string,
) {
  return req<{ alert: FloorAlert }>(
    `/public/tables/${encodeURIComponent(slug)}/call-chief`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Arbiter-Session': token,
      },
      body: JSON.stringify({ reason, ...(arbiterName ? { arbiterName } : {}) }),
    },
  );
}

export async function apiFloorListAlerts(tournamentId: string, activeOnly = true) {
  const qs = activeOnly ? '' : '?activeOnly=false';
  return req<{ alerts: FloorAlert[] }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/floor/alerts${qs}`,
  );
}

export async function apiFloorResolveAlert(tournamentId: string, alertId: string) {
  return req<{ alert: FloorAlert }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/floor/alerts/${encodeURIComponent(alertId)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export async function apiPublicTableResult(
  slug: string,
  sessionToken: string,
  result: string,
  arbiterName: string,
) {
  return req<{ ok: true; table: FloorTableView }>(
    `/public/tables/${encodeURIComponent(slug)}/result`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-Arbiter-Session': sessionToken,
      },
      body: JSON.stringify({ result, confirm: true, arbiterName }),
    },
  );
}

export const apiPublicTableSetResult = apiPublicTableResult;

export async function apiPublicTableCard(
  slug: string,
  sessionToken: string,
  body: {
    playerSide: 'white' | 'black';
    cardType: 'illegal_move' | 'warning';
    note?: string;
    arbiterName: string;
  },
) {
  return req<{
    ok: true;
    table: FloorTableView;
    forfeited: boolean;
    forfeitReason: string | null;
  }>(`/public/tables/${encodeURIComponent(slug)}/cards`, {
    method: 'POST',
    headers: { 'X-Arbiter-Session': sessionToken },
    body: JSON.stringify(body),
  });
}

export async function apiListGameCards(tournamentId: string, round?: number) {
  const qs = round != null ? `?round=${round}` : '';
  return req<{ cards: Array<{
    id: string;
    gameId: string;
    playerId: string;
    cardType: 'illegal_move' | 'warning';
    note?: string | null;
    createdAt: string;
  }> }>(`/tournaments/${tournamentId}/game-cards${qs}`);
}

export async function apiDirectorIssueCard(
  tournamentId: string,
  gameId: string,
  body: {
    playerSide?: 'white' | 'black';
    playerId?: string;
    cardType: 'illegal_move' | 'warning';
    note?: string;
    actorName?: string;
  },
) {
  return req<{
    ok: true;
    game: Game;
    whiteCards: PlayerCardCounts;
    blackCards: PlayerCardCounts;
    forfeited: boolean;
    forfeitReason: string | null;
  }>(`/tournaments/${tournamentId}/games/${gameId}/cards`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiDirectorRemoveCard(
  tournamentId: string,
  gameId: string,
  cardId: string,
) {
  return req<{
    ok: true;
    game: Game;
    whiteCards: PlayerCardCounts;
    blackCards: PlayerCardCounts;
    unlocked: boolean;
  }>(`/tournaments/${tournamentId}/games/${gameId}/cards/${cardId}`, {
    method: 'DELETE',
  });
}

// ── Public live viewer ───────────────────────────────────────────────────────

export type PublicLivePayload = {
  tournament: {
    name: string;
    date: string | null;
    rounds: number;
    currentRound: number;
    confirmedRounds: number;
    mixCategories: boolean;
    status: string;
    prizePlaces: number;
    tiebreakOrder?: string[] | null;
    sharedPlaces?: boolean;
  };
  categories: Array<{ id: string; name: string; prizePlaces: number | null }>;
  players: Array<{
    id: string;
    name: string;
    rating: number | null;
    /** No longer sent: kept optional so LivePage compiles until it drops them. */
    club?: string | null;
    school?: string | null;
    yearOfBirth?: number | null;
    age?: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    seed: number | null;
    categoryIds: string[];
  }>;
  games: Array<{
    id?: string;
    round: number;
    board: number;
    whiteId: string | null;
    blackId: string | null;
    result: string;
    isBye: boolean;
    categoryId: string;
    whiteCards?: PlayerCardCounts;
    blackCards?: PlayerCardCounts;
  }>;
};

export async function apiPublicLiveGet(token: string) {
  return req<PublicLivePayload>(`/public/live/${encodeURIComponent(token)}`);
}

export async function apiPublicLiveEnable(tournamentId: string) {
  return req<{ publicToken: string | null; publicEnabled: boolean; updatedAt: string }>(
    `/tournaments/${tournamentId}/public-live/enable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function apiPublicLiveRotate(tournamentId: string) {
  return req<{ publicToken: string | null; publicEnabled: boolean; updatedAt: string }>(
    `/tournaments/${tournamentId}/public-live/rotate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function apiPublicLiveDisable(tournamentId: string) {
  return req<{ publicToken: string | null; publicEnabled: boolean; updatedAt: string }>(
    `/tournaments/${tournamentId}/public-live/disable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export type AdminOverview = {
  accounts: Array<{
    id: string;
    email: string | null;
    displayName: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    tournamentCount: number;
    participantCount: number;
    isPlatformAdmin: boolean;
  }>;
  totals: {
    users: number;
    tournaments: number;
    tournamentsByStatus: Record<string, number>;
    publicLiveEnabled: number;
    participants: number;
    games: number;
    gamesPending: number;
    gamesFinished: number;
    floorTournaments: number;
    tournamentsWithCertificates: number;
    certificateIssuesByStatus: Record<string, number>;
    gameCardsByType: Record<string, number>;
    resultEventsLast7dByRole: Record<string, number>;
  };
  adoption: {
    publicLivePct: number;
    floorTablesPct: number;
    certificatesPct: number;
  };
  growthByWeek: Array<{
    weekStart: string;
    users: number;
    resultEvents: number;
    pageViews: number;
    certificates: number;
  }>;
  pageViews: {
    last7d: number;
    last30d: number;
    byRouteKeyLast7d: Record<string, number>;
    byDayLast14d: Array<{ day: string; count: number }>;
    topLiveHashesLast7d: Array<{ hashPrefix: string; count: number }>;
  };
  recentTournaments: Array<{
    id: string;
    name: string;
    status: string;
    ownerEmail: string | null;
    participantCount: number;
    publicEnabled: boolean;
    currentRound: number;
    createdAt: string;
    completedAt: string | null;
    updatedAt: string;
  }>;
  timestampsAreUtc: true;
  distribution: {
    githubLatestTag: string | null;
    githubDownloadsLatest: number;
    githubDownloadsRecent: number;
    githubAssets: Array<{ name: string; downloads: number }>;
    siteDownloadClicks7d: number;
    siteDownloadClicks30d: number;
    desktopLaunches7d: number;
    uniqueInstalls30d: number;
    byOs7d: Record<string, number>;
    byArch7d: Record<string, number>;
    byCountry7d: Record<string, number>;
    byAsset7d: Record<string, number>;
    byTimezone7d: Record<string, number>;
  };
};

export async function apiAdminOverview() {
  return req<AdminOverview>('/admin/overview', { timeoutMs: 20_000 });
}

export type FidePlayerCandidate = {
  fideId: number;
  name: string;
  federation: string | null;
  birthYear: number | null;
  title: string | null;
  sex: string | null;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  inactive: boolean;
};

export type FideLookupResultRow = {
  participantId: string;
  status: 'exact' | 'unique' | 'ambiguous' | 'not_found';
  selectedFideId: number | null;
  candidates: FidePlayerCandidate[];
};

export async function apiFideLookup(
  tournamentId: string,
  body: {
    ratingType: 'standard' | 'rapid' | 'blitz';
    players: Array<{
      id: string;
      name: string;
      country?: string | null;
      yearOfBirth?: number | null;
      fideId?: number | null;
    }>;
  },
) {
  return req<{
    ratingType: 'standard' | 'rapid' | 'blitz';
    provider?: string;
    results: FideLookupResultRow[];
  }>(`/tournaments/${tournamentId}/fide-lookup`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });
}

export async function apiDirectorSetGameResult(
  gameId: string,
  body: {
    result: string;
    confirm?: true;
    note?: string;
    actorName?: string;
  },
) {
  return req<{
    id: string;
    result: string;
    resultEnteredByName?: string | null;
    resultEnteredByRole?: string | null;
    resultOverrideCount?: number;
    resultLockedAt?: string | null;
    updatedAt: string;
  }>(`/games/${gameId}/result`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiGameHistory(gameId: string) {
  return req<{ events: GameResultEvent[] }>(`/games/${gameId}/history`);
}

/** Removes the newest round's unplayed games and ends its floor PIN. Needs the server. */
export async function apiUndoRound(
  tournamentId: string,
  round: number,
  body: { reason?: string; actorName?: string },
) {
  return req<{ tournament: Tournament; removedGameIds: string[] }>(
    `/tournaments/${tournamentId}/rounds/${round}/undo`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ── Organizations (B2B multi-tenant & Sandbox Trial) ─────────────────────────

export type UserOrganization = Organization & { memberRole: OrganizationMemberRole };

export async function apiListOrganizations() {
  return req<{ organizations: UserOrganization[] }>('/organizations');
}

// ── Team: members and invites ────────────────────────────────────────────────

export type InviteRow = OrganizationInvite & { status: OrganizationInviteStatus };
type IssuedInvite = { invite: InviteRow; inviteUrl: string; emailStatus: InviteEmailStatus };

/** Sending an invite waits on the mail provider, so it gets longer than the default. */
const INVITE_SEND_TIMEOUT_MS = 20_000;

const orgPath = (id: string) => `/organizations/${encodeURIComponent(id)}`;

export async function apiListMembers(organizationId: string) {
  return req<{ members: OrganizationTeamMember[]; yourRole: OrganizationMemberRole }>(
    `${orgPath(organizationId)}/members`,
  );
}

export async function apiChangeMemberRole(
  organizationId: string,
  userId: string,
  role: OrganizationMemberRole,
) {
  return req<{ userId: string; role: OrganizationMemberRole }>(
    `${orgPath(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
  );
}

export async function apiRemoveMember(organizationId: string, userId: string) {
  return req<null>(`${orgPath(organizationId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function apiLeaveOrganization(organizationId: string) {
  return req<null>(`${orgPath(organizationId)}/leave`, { method: 'POST' });
}

export async function apiListInvites(organizationId: string) {
  return req<{ invites: InviteRow[] }>(`${orgPath(organizationId)}/invites`);
}

export async function apiCreateInvite(
  organizationId: string,
  body: { email: string; role: OrganizationMemberRole },
) {
  return req<IssuedInvite>(`${orgPath(organizationId)}/invites`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: INVITE_SEND_TIMEOUT_MS,
  });
}

/** Issues a new link and kills the old one: only a hash of the link is stored. */
export async function apiResendInvite(
  organizationId: string,
  inviteId: string,
  sendEmail: boolean,
) {
  return req<IssuedInvite>(
    `${orgPath(organizationId)}/invites/${encodeURIComponent(inviteId)}/resend`,
    {
      method: 'POST',
      body: JSON.stringify({ sendEmail }),
      timeoutMs: INVITE_SEND_TIMEOUT_MS,
    },
  );
}

export async function apiRevokeInvite(organizationId: string, inviteId: string) {
  return req<null>(`${orgPath(organizationId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export async function apiLookupInvite(token: string) {
  return req<OrganizationInvitePreview>('/public/invites/lookup', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function apiAcceptInvite(token: string) {
  return req<Extract<AcceptInviteResult, { ok: true }>>('/invites/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function apiCreateOrganization(body: {
  name: string;
  slug?: string;
  logoUrl?: string | null;
  description?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  paymentInstructions?: string | null;
}) {
  return req<{ organization: Organization }>('/organizations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiUpdateOrganization(
  id: string,
  body: {
    name?: string;
    slug?: string;
    logoUrl?: string | null;
    description?: string | null;
    website?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    paymentInstructions?: string | null;
    paymentQrStoragePath?: string | null;
  },
) {
  return req<{ organization: Organization }>(`/organizations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiAdminListOrganizations() {
  return req<{ organizations: AdminOrganizationRow[] }>('/admin/organizations', {
    timeoutMs: 15_000,
  });
}

export async function apiAdminUpdateOrganization(
  id: string,
  body: {
    verificationStatus?: OrganizationVerificationStatus;
    planTier?: OrganizationPlanTier;
    trialEndsAt?: string | null;
    maxTournamentsQuota?: number | null;
    maxPlayersPerTournament?: number | null;
    eventCreditsRemaining?: number;
    canPublishGlobal?: boolean;
    canAcceptPaidRegistrations?: boolean;
  },
) {
  return req<{ organization: Organization }>(`/admin/organizations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ── Player & Family Profiles (B2C Participant Portal) ────────────────────────

export async function apiListPlayerProfiles() {
  return req<{ profiles: PlayerProfile[] }>('/player/profiles');
}

export async function apiCreatePlayerProfile(body: {
  fullName: string;
  username?: string | null;
  isPrimary?: boolean;
  relationship?: PlayerRelationship;
  dateOfBirth?: string | null;
  yearOfBirth?: number | null;
  gender?: string | null;
  nationalId?: string | null;
  fideId?: number | null;
  fideStandard?: number | null;
  fideRapid?: number | null;
  fideBlitz?: number | null;
  school?: string | null;
  club?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  guardianConsent?: boolean;
}) {
  return req<{ profile: PlayerProfile }>('/player/profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiUpdatePlayerProfile(
  id: string,
  body: Partial<{
    fullName: string;
    username: string | null;
    isPrimary: boolean;
    relationship: PlayerRelationship;
    dateOfBirth: string | null;
    yearOfBirth: number | null;
    gender: string | null;
    nationalId: string | null;
    fideId: number | null;
    fideStandard: number | null;
    fideRapid: number | null;
    fideBlitz: number | null;
    school: string | null;
    club: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    email: string | null;
    phone: string | null;
  }>,
) {
  return req<{ profile: PlayerProfile }>(`/player/profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiDeletePlayerProfile(id: string) {
  return req<void>(`/player/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Links past tournaments entered under the signed-in account's confirmed email. */
export async function apiClaimPlayerParticipations(profileId: string) {
  return req<{ claimedCount: number; participantIds: string[] }>(
    `/player/profiles/${encodeURIComponent(profileId)}/claim`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export async function apiGetPlayerDashboard(profileId?: string | null) {
  const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  return req<PlayerCareerDashboard>(`/player/dashboard${qs}`);
}

export async function apiDownloadCertificatePdf(
  issueId: string,
  filename = 'certificate.pdf',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const BASE_URL = resolveApiBaseUrl();
  try {
    const authHeaders = await getAuthHeaders(AbortSignal.timeout(8_000));
    const res = await fetch(`${BASE_URL}/certificates/${encodeURIComponent(issueId)}/download`, {
      headers: {
        ...authHeaders,
      },
    });
    if (!res.ok) {
      let error = `Download failed (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        error = body.message ?? body.error ?? error;
      } catch {
        /* ignore */
      }
      return { ok: false, error };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Download failed',
    };
  }
}

// ── Public Event Discovery & Registrations (Phase 2) ─────────────────────────

export type PublicEventDetailResponse = {
  event: {
    id: string;
    publicSlug: string | null;
    name: string;
    date: string | null;
    style: string;
    rounds: number;
    status: string;
    registrationOpen: boolean;
    registrationDeadline: string | null;
    maxParticipants: number | null;
    registeredCount: number;
    venueName: string | null;
    venueAddress: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    descriptionMd: string | null;
    rulesMd: string | null;
    timeControl: string | null;
    entryFeeCents: number;
    currency: string;
    paymentInstructions: string | null;
    paymentQrUrl: string | null;
    registrationFormSchema: PublicRegistrationForm | RegistrationFormConfig;
    organizationName: string | null;
    publicToken: string | null;
  };
  categories: Array<{
    id: string;
    name: string;
    filter: FilterGroup;
    sortOrder: number;
    prizePlaces: number | null;
  }>;
  participants: Array<{
    id: string;
    name: string;
    rating: number | null;
    fideId: number | null;
    school: string | null;
    club: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    yearOfBirth: number | null;
    categoryIds: string[];
  }>;
};

export async function apiListPublicEvents(params?: {
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  search?: string | null;
}) {
  const qs = new URLSearchParams();
  if (params?.lat != null && Number.isFinite(params.lat)) qs.set('lat', String(params.lat));
  if (params?.lng != null && Number.isFinite(params.lng)) qs.set('lng', String(params.lng));
  if (params?.radiusKm != null && Number.isFinite(params.radiusKm) && params.radiusKm > 0) {
    qs.set('radiusKm', String(params.radiusKm));
  }
  if (params?.search?.trim()) qs.set('search', params.search.trim());
  const query = qs.toString();
  return req<{ events: PublicEventSummary[] }>(`/public/events${query ? `?${query}` : ''}`);
}

export async function apiGetPublicEvent(slugOrId: string) {
  return req<PublicEventDetailResponse>(`/public/events/${encodeURIComponent(slugOrId)}`);
}

export async function apiSubmitEventRegistration(
  slugOrId: string,
  body: {
    playerProfileId?: string | null;
    selectedCategoryId?: string | null;
    name?: string;
    age?: number | null;
    yearOfBirth?: number | null;
    gender?: string | null;
    fideId?: number | null;
    rating?: number | null;
    school?: string | null;
    club?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    email?: string | null;
    phone?: string | null;
    customAnswers?: Record<string, unknown>;
    customFiles?: Record<string, string>;
    nricNumber?: string | null;
    ageProofDataUrl?: string | null;
    receiptDataUrl?: string | null;
    guardianConsent?: boolean;
  },
) {
  const hasFiles = Boolean(body.receiptDataUrl || body.ageProofDataUrl || body.customFiles);
  return req<{ registration: TournamentRegistration }>(
    `/public/events/${encodeURIComponent(slugOrId)}/register`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      // Several photos over a venue's mobile signal take a while.
      timeoutMs: hasFiles ? 180_000 : 20_000,
    },
  );
}

export async function apiSchoolSuggestions(slugOrId: string, query: string) {
  return req<{ schools: string[] }>(
    `/public/events/${encodeURIComponent(slugOrId)}/schools?q=${encodeURIComponent(query)}`,
  );
}

export async function apiGetTournamentPublishing(tournamentId: string) {
  return req<{
    tournament: Tournament;
    form: RegistrationFormConfig;
    answerCounts: Record<string, { answers: number; options: Record<string, number> }>;
    can: { listPublicly: boolean; takePaidEntries: boolean };
  }>(`/tournaments/${encodeURIComponent(tournamentId)}/publishing`);
}

export async function apiFetchRegistrationFile(
  tournamentId: string,
  registrationId: string,
  fileId: string,
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${resolveApiBaseUrl()}/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(registrationId)}/files/${encodeURIComponent(fileId)}`,
      { headers: (await getAuthHeaders(AbortSignal.timeout(8_000))) ?? {} },
    );
    if (!res.ok) return { ok: false, error: `Could not load the file (${res.status}).` };
    return { ok: true, blob: await res.blob() };
  } catch {
    return { ok: false, error: 'Could not load the file. Check your connection.' };
  }
}

/** The full number, for an organizer who asks to see it. Not kept in any list. */
export async function apiRevealRegistrationNric(tournamentId: string, registrationId: string) {
  return req<{ nricNumber: string }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(registrationId)}/nric`,
  );
}

export async function apiDeleteRegistrationAgeProofs(tournamentId: string) {
  return req<{ files: number; nricNumbers: number; failed: number }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/registrations/delete-age-proofs`,
    { method: 'POST', body: JSON.stringify({ confirm: true }), timeoutMs: 60_000 },
  );
}

export async function apiFetchRegistrationReceipt(
  tournamentId: string,
  registrationId: string,
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${resolveApiBaseUrl()}/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(registrationId)}/receipt`,
      { headers: (await getAuthHeaders(AbortSignal.timeout(8_000))) ?? {} },
    );
    if (!res.ok) return { ok: false, error: `Could not load the receipt (${res.status}).` };
    return { ok: true, blob: await res.blob() };
  } catch {
    return { ok: false, error: 'Could not load the receipt. Check your connection.' };
  }
}

export async function apiUpdateTournamentPublishing(
  tournamentId: string,
  body: {
    publicSlug?: string | null;
    isPublishedGlobal?: boolean;
    registrationOpen?: boolean;
    registrationDeadline?: string | null;
    maxParticipants?: number | null;
    venueName?: string | null;
    venueAddress?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    descriptionMd?: string | null;
    rulesMd?: string | null;
    timeControl?: string | null;
    entryFeeCents?: number;
    currency?: string;
    paymentInstructions?: string | null;
    paymentQrUrl?: string | null;
    registrationFormSchema?: RegistrationFormConfig | null;
  },
) {
  return req<{
    tournament: Tournament;
    answerCounts?: Record<string, { answers: number; options: Record<string, number> }>;
  }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/publishing`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
}

export async function apiListTournamentRegistrations(tournamentId: string) {
  return req<{ registrations: TournamentRegistration[] }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/registrations`,
  );
}

export async function apiReviewTournamentRegistration(
  tournamentId: string,
  regId: string,
  body: {
    action: 'approve' | 'reject' | 'waitlist';
    reviewerNote?: string | null;
    categoryIds?: string[];
    /** The organizer vouches for a paid entry with no receipt. Without it the server answers 409. */
    confirmPaymentWithoutReceipt?: boolean;
  },
) {
  return req<{
    registration: TournamentRegistration;
    participant: Participant | null;
  }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/registrations/${encodeURIComponent(regId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export async function apiListPlayerRegistrations() {
  return req<{ registrations: TournamentRegistration[] }>('/player/registrations');
}

