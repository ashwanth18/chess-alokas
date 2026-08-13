import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import log from 'electron-log/main';

export type DesktopErrorRecord = {
  code: string;
  message: string;
  at: string;
  details?: string;
};

function errorFile(): string {
  return path.join(app.getPath('userData'), 'last-error.json');
}

export function readLastError(): DesktopErrorRecord | null {
  try {
    const file = errorFile();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DesktopErrorRecord;
    if (!parsed?.code || !parsed?.message) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLastError(record: Omit<DesktopErrorRecord, 'at'> & { at?: string }): DesktopErrorRecord {
  const next: DesktopErrorRecord = {
    code: record.code,
    message: record.message,
    details: record.details,
    at: record.at ?? new Date().toISOString(),
  };
  try {
    fs.writeFileSync(errorFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    log.warn('Could not write last-error.json', err);
  }
  log.error(`[${next.code}] ${next.message}`, next.details ?? '');
  return next;
}

export async function openLogsFolder(): Promise<void> {
  const dir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  await shell.openPath(dir);
}
