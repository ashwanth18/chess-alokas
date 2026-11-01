import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import IndexedDbRecovery, { DesktopBackupAgent } from '../components/IndexedDbRecovery';
import RevocationNotice from '../components/RevocationNotice';
import { db, ensureDbOpen } from '../db/local';
import { reportBootIssue } from '../lib/bootDiagnostics';
import { connectOwnerIdSink } from '../lib/ownerIdSink';
import { DeskSyncContext } from './deskSync';
import { SessionLoading, isDesktop } from './gates';
import { useOrganizerSync } from './useOrganizerSync';

/** Everything that needs an open database, mounted only once the gate below has opened it. */
function DeskReady() {
  const sync = useOrganizerSync();

  // AuthContext can't reach Dexie without loading it for parents, so it hands the owner id over here.
  useEffect(
    () =>
      connectOwnerIdSink(async (userId) => {
        if (userId) await db.meta.put({ key: 'ownerId', value: userId });
        else await db.meta.delete('ownerId');
      }),
    [],
  );

  return (
    <DeskSyncContext.Provider value={sync}>
      {isDesktop && <DesktopBackupAgent />}
      <RevocationNotice />
      <Outlet />
    </DeskSyncContext.Provider>
  );
}

/**
 * The desk: `/app`, `/tournaments/*`, `/certificates`, `/settings`, `/account`, `/admin` and the rest
 * of the organizer routes. The only shell allowed to touch Dexie and sync. This file and everything
 * it imports are one lazy chunk, so nothing here reaches a parent's phone.
 */
export default function OrganizerShell() {
  const [dbReady, setDbReady] = useState(false);
  const [dbFailed, setDbFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      reportBootIssue(
        'INDEXEDDB_OPEN_FAILED',
        'The local tournament database took too long to open.',
        'Timed out after 12s',
      );
      setDbFailed('Timed out opening the local database.');
    }, 12_000);

    void ensureDbOpen().then((result) => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      if (result.ok) {
        setDbReady(true);
        return;
      }
      reportBootIssue(
        'INDEXEDDB_OPEN_FAILED',
        'The local tournament database could not open on this computer.',
        result.error.message,
      );
      setDbFailed(result.error.message);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  if (dbFailed) return <IndexedDbRecovery details={dbFailed} />;
  if (!dbReady) return <SessionLoading title="Starting" />;
  return <DeskReady />;
}
