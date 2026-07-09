import type {
  Tournament,
  Category,
  Participant,
  Game,
  SyncPushRequest,
} from '@chess-alokas/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function req<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data: T; ok: true } | { data: null; ok: false }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: AbortSignal.timeout(8000),
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) return { data: null, ok: false };
    const data = (await res.json()) as T;
    return { data, ok: true };
  } catch {
    return { data: null, ok: false };
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
