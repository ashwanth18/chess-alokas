import type {
  Tournament,
  Category,
  Participant,
  Game,
  SyncPushRequest,
} from '@chess-alokas/shared';
import { supabase } from '../lib/supabase';

export function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.desktop?.getApiBaseUrl) {
    const fromDesktop = window.desktop.getApiBaseUrl();
    if (fromDesktop) return fromDesktop;
  }
  return import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<{ data: T; ok: true } | { data: null; ok: false; error: string }> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const defaultTimeout = path.startsWith('/sync')
    ? 60_000
    : path.includes('/certificates/')
      ? 120_000
      : 8_000;
  const BASE_URL = resolveApiBaseUrl();
  try {
    const authHeaders = await getAuthHeaders();
    const hasBody = fetchOptions.body != null && fetchOptions.body !== '';
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: AbortSignal.timeout(timeoutMs ?? defaultTimeout),
      ...fetchOptions,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders,
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
      return { data: null, ok: false, error };
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
export async function apiPairRound(tournamentId: string, categoryId: string, round: number) {
  return req<{ boards: unknown[] }>(`/tournaments/${tournamentId}/pair`, {
    method: 'POST',
    body: JSON.stringify({ categoryId, round }),
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
}

export async function apiSyncPush(body: SyncPushRequest) {
  return req<{ accepted: number; serverTime: string }>('/sync/push', {
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
  return req<{ issues: unknown[] }>(`/tournaments/${tournamentId}/certificates`);
}

export async function apiEmailCertificates(
  tournamentId: string,
  body: { issueIds?: string[]; allPending?: boolean },
) {
  return req<{ sent: number; failed: number; results: unknown[] }>(
    `/tournaments/${tournamentId}/certificates/email`,
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

export type FloorTableView = {
  slug: string;
  tableNumber: number;
  tournamentName: string;
  tournamentId: string;
  pinRound: number | null;
  round: number | null;
  whiteName: string | null;
  blackName: string | null;
  status: 'needs_pin' | 'pending' | 'locked' | 'bye' | 'no_game' | 'confirmed_closed';
  result: string | null;
  sessionOk: boolean;
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

export async function apiPublicTableSession(slug: string, pin: string) {
  return req<{ token: string; table: FloorTableView }>(
    `/public/tables/${encodeURIComponent(slug)}/session`,
    {
      method: 'POST',
      body: JSON.stringify({ pin }),
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
      headers: { 'X-Arbiter-Session': sessionToken },
      body: JSON.stringify({ result, confirm: true, arbiterName }),
    },
  );
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
  };
  categories: Array<{ id: string; name: string; prizePlaces: number | null }>;
  players: Array<{
    id: string;
    name: string;
    rating: number | null;
    club: string | null;
    seed: number | null;
    categoryIds: string[];
  }>;
  games: Array<{
    round: number;
    board: number;
    whiteId: string | null;
    blackId: string | null;
    result: string;
    isBye: boolean;
    categoryId: string;
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
