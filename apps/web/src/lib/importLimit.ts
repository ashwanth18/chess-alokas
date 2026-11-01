import { useEffect, useState } from 'react';
import { apiListOrganizations } from '../api/client';

/** Used when the account's plan cannot be read. Mirrors the server's Sandbox Trial default. */
export const DEFAULT_TRIAL_PLAYER_LIMIT = 24;

const LIMIT_STORAGE_KEY = 'alokas:playerLimit';

export type PlanForLimit = {
  planTier?: string | null;
  maxPlayersPerTournament?: number | null;
};

/** Player cap for an account, or null when it has none. The server only caps the trial tier. */
export function playerLimitForOrg(org: PlanForLimit | null | undefined): number | null {
  if (!org) return DEFAULT_TRIAL_PLAYER_LIMIT;
  if (org.planTier !== 'trial') return null;
  return org.maxPlayersPerTournament ?? null;
}

export function importAllowance(limit: number | null, existing: number, incoming: number) {
  if (limit == null) return { over: false, room: incoming };
  const room = Math.max(0, limit - existing);
  return { over: incoming > room, room };
}

/** Row indexes ticked by default when the file does not fit: the first rows that do. */
export function defaultKeepIndexes(incoming: number, room: number): Set<number> {
  const keep = new Set<number>();
  for (let i = 0; i < Math.min(incoming, room); i++) keep.add(i);
  return keep;
}

function readRemembered(): number | null | undefined {
  try {
    const raw = localStorage.getItem(LIMIT_STORAGE_KEY);
    if (raw === null) return undefined;
    return raw === 'none' ? null : Number(raw);
  } catch {
    return undefined;
  }
}

/**
 * The player cap for the signed-in account. Remembers the last value so a warning still appears
 * offline. `undefined` means not known yet; signed-out and local demo builds never have a cap.
 */
export function usePlayerLimit(signedIn: boolean): number | null | undefined {
  const [limit, setLimit] = useState<number | null | undefined>(() =>
    signedIn ? readRemembered() : null,
  );
  useEffect(() => {
    if (!signedIn) {
      setLimit(null);
      return;
    }
    let cancelled = false;
    void apiListOrganizations().then((res) => {
      if (cancelled || !res.ok) return;
      const next = playerLimitForOrg(res.data.organizations[0]);
      setLimit(next);
      try {
        localStorage.setItem(LIMIT_STORAGE_KEY, next == null ? 'none' : String(next));
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return limit;
}
