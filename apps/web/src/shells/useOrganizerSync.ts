import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { checkOnline } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { db, getLastSyncAt } from '../db/local';
import { reportSyncFailure, syncErrorMessage } from '../lib/syncError';
import { SYNC_REJECTIONS_EVENT, syncOnline, type ShownRejection } from '../sync/sync';
import type { DeskSync } from './deskSync';

/** Counts local rows the cloud doesn't have. All these tables index `dirty`. */
async function countPending(): Promise<number> {
  const counts = await Promise.all(
    [db.tournaments, db.categories, db.participants, db.games, db.certificateTemplates, db.tournamentTables].map(
      (table) => table.where('dirty').equals(1).count(),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Connection, sync and rejection state for the desk. Moved out of Layout, unchanged in behaviour. */
export function useOrganizerSync(): DeskSync {
  const auth = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [rejections, setRejections] = useState<ShownRejection[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    void getLastSyncAt().then(setLastSync);
  }, []);

  useEffect(() => {
    const sub = liveQuery(countPending).subscribe({
      next: setPendingCount,
      error: (err) => console.warn('[sync] could not count pending changes', err),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const interval = setInterval(async () => {
      const reachable = await checkOnline();
      setOnline(reachable);
    }, 30_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const onRejections = (e: Event) => {
      setRejections((e as CustomEvent<ShownRejection[]>).detail);
    };
    window.addEventListener(SYNC_REJECTIONS_EVENT, onRejections);
    return () => window.removeEventListener(SYNC_REJECTIONS_EVENT, onRejections);
  }, []);

  const run = useCallback(
    async (afterReconnect = false) => {
      if ((!online && !afterReconnect) || syncing || !auth.user) return;
      setSyncing(true);
      setMessage(null);
      setFailed(false);
      try {
        const { pushed, pulled, rejected } = await syncOnline();
        setLastSync(new Date().toISOString());
        // Refused rows are listed in the banner below the top bar and stay there until they sync.
        if (rejected.length === 0) {
          setMessage(`↑ ${pushed} pushed · ↓ ${pulled} pulled`);
          setTimeout(() => setMessage(null), 4000);
        }
      } catch (err) {
        reportSyncFailure(err);
        setFailed(true);
        setMessage(syncErrorMessage(err));
      } finally {
        setSyncing(false);
      }
    },
    [online, syncing, auth.user],
  );

  // Work done offline goes up as soon as the connection returns.
  useEffect(() => {
    const onReconnect = () => {
      setOnline(true);
      void run(true);
    };
    window.addEventListener('online', onReconnect);
    return () => window.removeEventListener('online', onReconnect);
  }, [run]);

  useEffect(() => {
    if (!window.desktop?.isDesktop || !auth.user) return;
    let cancelled = false;
    void (async () => {
      const reachable = await checkOnline();
      if (cancelled || !reachable) return;
      setOnline(true);
      try {
        const { pushed, pulled, rejected } = await syncOnline();
        if (cancelled) return;
        setLastSync(new Date().toISOString());
        setFailed(false);
        if (rejected.length === 0) {
          setMessage(`↑ ${pushed} pushed · ↓ ${pulled} pulled`);
          setTimeout(() => setMessage(null), 4000);
        }
      } catch (err) {
        reportSyncFailure(err);
        setFailed(true);
        setMessage(syncErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  return {
    online,
    syncing,
    message,
    failed,
    lastSync,
    rejections,
    pendingCount,
    sync: () => void run(),
  };
}
