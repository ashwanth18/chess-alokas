import { useEffect, useState } from 'react';
import Dexie, { liveQuery } from 'dexie';
import BootIssueCard from './BootIssueCard';
import { db, ensureDbOpen } from '../db/local';

/* ── Desktop local backups ─────────────────────────────────────────────────
 * A backup is a JSON copy of the whole local database. The desktop main process
 * stores automatic snapshots in <user data>/backups and keeps the newest 20.
 * They hold personal data, so they never go anywhere shared unless the person
 * explicitly exports one to a file.
 */

type BackupBridge = {
  setLiveTournamentCount: (count: number) => void;
  backupSave: (json: string, reason: string) => Promise<{ name: string }>;
  backupList: () => Promise<Array<{ name: string; size: number; savedAt: string }>>;
  backupRead: (name: string) => Promise<string>;
  backupExport: (json: string) => Promise<string | null>;
  backupImport: () => Promise<string | null>;
  backupOpenFolder: () => Promise<void>;
  backupFolder: () => string;
};

function backupBridge(): BackupBridge | null {
  const bridge = window.desktop as unknown as Partial<BackupBridge> | undefined;
  return bridge?.backupSave ? (bridge as BackupBridge) : null;
}

const BACKUP_FORMAT = 'chess-alokas-backup';

type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  createdAt: string;
  appVersion: string | null;
  dbVersion: number;
  tables: Record<string, unknown[]>;
};

async function buildBackupJson(): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) {
      tables[table.name] = await table.toArray();
    }
  });
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: window.desktop?.getAppVersion?.() ?? null,
    dbVersion: db.verno,
    tables,
  };
  return JSON.stringify(file);
}

function parseBackup(json: string): BackupFile {
  let parsed: Partial<BackupFile>;
  try {
    parsed = JSON.parse(json) as Partial<BackupFile>;
  } catch {
    throw new Error('This file is not a Chess Alokas backup.');
  }
  if (parsed?.format !== BACKUP_FORMAT || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('This file is not a Chess Alokas backup.');
  }
  // verno reflects the declared schema even while the store cannot open.
  if (typeof parsed.dbVersion !== 'number' || parsed.dbVersion > db.verno) {
    throw new Error('This backup is from a newer version of the app. Update the app first.');
  }
  const known = new Set(db.tables.map((t) => t.name));
  for (const [name, rows] of Object.entries(parsed.tables)) {
    if (!known.has(name)) throw new Error(`This backup has an unknown table: ${name}.`);
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object')) {
      throw new Error(`This backup has invalid data in: ${name}.`);
    }
    const key = db.table(name).schema.primKey.keyPath as string;
    if (rows.some((r) => typeof (r as Record<string, unknown>)[key] !== 'string')) {
      throw new Error(`This backup has rows without an id in: ${name}.`);
    }
  }
  return parsed as BackupFile;
}

/** Replaces all local data with the backup. A broken store is deleted and rebuilt first. */
async function restoreBackup(backup: BackupFile, opts: { rebuildStore: boolean }): Promise<void> {
  if (opts.rebuildStore) {
    db.close();
    await Dexie.delete(db.name);
    await db.open();
  } else {
    const bridge = backupBridge();
    if (bridge) await bridge.backupSave(await buildBackupJson(), 'before-restore');
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = backup.tables[table.name];
      if (rows?.length) await table.bulkPut(rows);
    }
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupPanel({ storeBroken }: { storeBroken: boolean }) {
  const bridge = backupBridge();
  const [snapshots, setSnapshots] = useState<
    Array<{ name: string; size: number; savedAt: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (bridge) setSnapshots(await bridge.backupList());
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bridge) {
    return <p className="form-hint">Local backups are available in the desktop app.</p>;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function restoreFrom(json: string, label: string) {
    return run(async () => {
      const backup = parseBackup(json);
      const warning = storeBroken
        ? `The local database could not open. Restoring deletes it and rebuilds it from ${label}. Anything newer that was not synced is lost. Continue?`
        : `Replace all tournament data on this computer with ${label}? A copy of the current data is saved first. After restoring, Sync may bring back newer changes from the cloud.`;
      if (!window.confirm(warning)) return;
      await restoreBackup(backup, { rebuildStore: storeBroken });
      window.location.reload();
    });
  }

  return (
    <div>
      <p className="form-hint">
        A snapshot is saved automatically each time a round changes, and the newest 20 are kept in{' '}
        <code>{bridge.backupFolder()}</code>. They contain player names and contact details, so keep
        any exported file somewhere private.
      </p>
      <div className="account-actions">
        {!storeBroken && (
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await bridge.backupSave(await buildBackupJson(), 'manual');
                  await refresh();
                  setNotice('Snapshot saved.');
                })
              }
            >
              Save snapshot now
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const where = await bridge.backupExport(await buildBackupJson());
                  if (where) setNotice(`Exported to ${where}`);
                })
              }
            >
              Export to file…
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const json = await bridge.backupImport();
              if (json) await restoreFrom(json, 'the selected file');
            })
          }
        >
          Restore from file…
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void bridge.backupOpenFolder()}
        >
          Open backups folder
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {notice && <p className="form-hint">{notice}</p>}
      {snapshots.length === 0 ? (
        <p className="form-hint">No snapshots yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0' }}>
          {snapshots.map((snap) => (
            <li
              key={snap.name}
              data-snapshot={snap.name}
              style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.25rem 0' }}
            >
              <span style={{ flex: 1 }}>
                {new Date(snap.savedAt).toLocaleString()} · {formatSize(snap.size)}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await restoreFrom(
                      await bridge.backupRead(snap.name),
                      `the snapshot from ${new Date(snap.savedAt).toLocaleString()}`,
                    );
                  })
                }
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BackupPage() {
  return (
    <section className="account-panel">
      <h2>Local backups</h2>
      <BackupPanel storeBroken={false} />
    </section>
  );
}

function isTournamentLive(t: { status: string; currentRound: number; deletedAt?: string | null }) {
  if (t.deletedAt || t.status === 'completed') return false;
  return t.status === 'in_progress' || t.currentRound > 0;
}

const LAST_ROUND_KEY = 'chess-alokas-backup-round-key';

/**
 * Desktop only, no visible work: snapshots the database whenever any tournament's
 * round state changes, and tells the updater whether a tournament is running.
 */
export function DesktopBackupAgent() {
  useEffect(() => {
    const bridge = backupBridge();
    if (!bridge) return;
    let timer: number | null = null;
    let saving = false;

    const saveIfChanged = async (roundKey: string) => {
      if (saving) return;
      saving = true;
      try {
        await bridge.backupSave(await buildBackupJson(), 'round');
        window.localStorage.setItem(LAST_ROUND_KEY, roundKey);
      } catch (err) {
        console.warn('[backup] snapshot failed', err);
      } finally {
        saving = false;
      }
    };

    const sub = liveQuery(() => db.tournaments.toArray()).subscribe({
      next(tournaments) {
        const active = tournaments.filter((t) => !t.deletedAt);
        bridge.setLiveTournamentCount(active.filter(isTournamentLive).length);
        const roundKey = active
          .map((t) => `${t.id}:${t.currentRound}:${t.confirmedRounds ?? 0}:${t.status}`)
          .sort()
          .join('|');
        if (!roundKey || roundKey === window.localStorage.getItem(LAST_ROUND_KEY)) return;
        // Results and pairings are written in several steps; let them settle first.
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(() => void saveIfChanged(roundKey), 5_000);
      },
      error(err) {
        console.warn('[backup] watch failed', err);
      },
    });
    return () => {
      sub.unsubscribe();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}

/** Only 20 snapshots are kept, so results may not crowd out the round snapshots too quickly. */
const RESULT_SNAPSHOT_MIN_GAP_MS = 5 * 60 * 1000;
const RESULT_SNAPSHOT_SETTLE_MS = 5_000;
let lastResultSnapshotAt = 0;
let resultSnapshotTimer: number | null = null;

/** Desktop only. Call after a result is saved; a burst of results produces one snapshot. */
export function snapshotAfterResult(): void {
  const bridge = backupBridge();
  if (!bridge || resultSnapshotTimer != null) return;
  const wait = Math.max(
    RESULT_SNAPSHOT_SETTLE_MS,
    lastResultSnapshotAt + RESULT_SNAPSHOT_MIN_GAP_MS - Date.now(),
  );
  resultSnapshotTimer = window.setTimeout(() => {
    resultSnapshotTimer = null;
    lastResultSnapshotAt = Date.now();
    void buildBackupJson()
      .then((json) => bridge.backupSave(json, 'result'))
      .catch((err) => console.warn('[backup] snapshot failed', err));
  }, wait);
}

export default function IndexedDbRecovery({ details }: { details?: string }) {
  const [busy, setBusy] = useState(false);
  const dataPath = window.desktop?.getUserDataPath?.();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Offline data could not open</h1>
        <p className="form-hint">
          Chess Alokas could not open its local database on this computer. This is usually another
          copy of the app still running, or Windows locking the store.
        </p>
        <ol className="form-hint" style={{ paddingLeft: '1.2rem', margin: '0.75rem 0' }}>
          <li>Close every Chess Alokas window.</li>
          <li>In Task Manager, end any leftover Chess Alokas process.</li>
          <li>Click Try again.</li>
        </ol>
        <BootIssueCard />
        {details ? <p className="form-hint-sm">{details}</p> : null}
        {dataPath ? (
          <p className="form-hint-sm">
            Data folder: <code>{dataPath}</code>
          </p>
        ) : null}
        <div className="boot-issue-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void ensureDbOpen().then((result) => {
                if (result.ok) window.location.reload();
                else setBusy(false);
              });
            }}
          >
            {busy ? 'Retrying…' : 'Try again'}
          </button>
        </div>
        {backupBridge() ? (
          <>
            <h2 style={{ marginTop: '1.25rem' }}>Restore from a backup</h2>
            <p className="form-hint">Only do this if Try again keeps failing.</p>
            <BackupPanel storeBroken />
          </>
        ) : null}
      </div>
    </div>
  );
}
