import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, shell, type BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { isSnapshotName, snapshotName, snapshotsToPrune } from './policy.js';

/** Tournament snapshots hold personal data, so they stay in the per-user app data folder. */
const KEEP_SNAPSHOTS = 20;
const MAX_SNAPSHOT_CHARS = 400 * 1024 * 1024;

export function backupsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function assertSnapshotText(json: unknown): asserts json is string {
  if (typeof json !== 'string' || json.length === 0 || json.length > MAX_SNAPSHOT_CHARS) {
    throw new Error('Invalid backup contents');
  }
}

export function saveSnapshot(json: unknown, reason: unknown): { name: string } {
  assertSnapshotText(json);
  const dir = backupsDir();
  const name = snapshotName(typeof reason === 'string' ? reason : 'auto', new Date());
  const dest = path.join(dir, name);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dest);
  for (const old of snapshotsToPrune(fs.readdirSync(dir), KEEP_SNAPSHOTS)) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch (err) {
      log.warn('Could not prune snapshot', old, err);
    }
  }
  return { name };
}

export function listSnapshots(): Array<{ name: string; size: number; savedAt: string }> {
  const dir = backupsDir();
  return fs
    .readdirSync(dir)
    .filter(isSnapshotName)
    .sort()
    .reverse()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, savedAt: st.mtime.toISOString() };
    });
}

export function readSnapshot(name: unknown): string {
  if (!isSnapshotName(name)) throw new Error('Invalid snapshot name');
  return fs.readFileSync(path.join(backupsDir(), name), 'utf8');
}

export async function exportToFile(win: BrowserWindow | null, json: unknown): Promise<string | null> {
  assertSnapshotText(json);
  const options = {
    title: 'Export tournament backup',
    defaultPath: snapshotName('export', new Date()).replace('snapshot-', 'chess-alokas-backup-'),
    filters: [{ name: 'Chess Alokas backup', extensions: ['json'] }],
  };
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, json, 'utf8');
  return res.filePath;
}

export async function importFromFile(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    title: 'Restore tournament backup',
    properties: ['openFile' as const],
    filters: [{ name: 'Chess Alokas backup', extensions: ['json'] }],
  };
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = res.filePaths[0];
  if (res.canceled || !file) return null;
  if (fs.statSync(file).size > MAX_SNAPSHOT_CHARS) throw new Error('Backup file is too large');
  return fs.readFileSync(file, 'utf8');
}

export async function openBackupsFolder(): Promise<void> {
  await shell.openPath(backupsDir());
}
