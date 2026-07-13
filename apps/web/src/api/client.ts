import type {
  Tournament,
  Category,
  Participant,
  Game,
  SyncPushRequest,
} from '@chess-alokas/shared';

function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.desktop?.getApiBaseUrl) {
    const fromDesktop = window.desktop.getApiBaseUrl();
    if (fromDesktop) return fromDesktop;
  }
  return import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
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
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: AbortSignal.timeout(timeoutMs ?? defaultTimeout),
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers ?? {}),
      },
    });
    if (!res.ok) {
      let error = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        error = body.message ?? body.error ?? error;
      } catch {
        /* ignore non-JSON error bodies */
      }
      return { data: null, ok: false, error };
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
