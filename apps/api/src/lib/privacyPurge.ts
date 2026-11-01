import type { Store } from '../db.js';
import { deleteCertificatePdf } from '../certificates/storage.js';
import { deleteReceipt } from '../registrations/receipts.js';

/** How long files and closed tournaments stay after an account is deleted. */
export const DELETION_GRACE_DAYS = 30;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

export function purgeAfterFrom(now: Date = new Date()): string {
  return new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface PurgeResult {
  receipts: number;
  tournaments: number;
  organizations: number;
  /** Files that could not be removed. Their rows stay, so the next run tries again. */
  failed: number;
}

export interface PurgeOptions {
  now?: Date;
  deleteReceiptFile?: (storagePath: string) => Promise<void>;
  deleteCertificateFile?: (storagePath: string) => Promise<void>;
}

/**
 * Finishes what DELETE /me scheduled. Safe to run at any time and any number of times: each step
 * records success only after the file is gone, and a failure is retried on the next run.
 */
export async function runPrivacyPurge(store: Store, options: PurgeOptions = {}): Promise<PurgeResult> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const removeReceipt = options.deleteReceiptFile ?? deleteReceipt;
  const removeCertificate = options.deleteCertificateFile ?? deleteCertificatePdf;
  const result: PurgeResult = { receipts: 0, tournaments: 0, organizations: 0, failed: 0 };

  for (const due of await store.listDueReceiptPurges(nowIso)) {
    try {
      if (due.storagePath) await removeReceipt(due.storagePath);
      await store.clearPurgedReceipt(due.registrationId);
      result.receipts += 1;
    } catch {
      result.failed += 1;
    }
  }

  for (const due of await store.listTournamentsDuePurge(nowIso)) {
    try {
      for (const file of due.receiptPaths) await removeReceipt(file);
      for (const file of due.certificatePaths) await removeCertificate(file);
      await store.hardDeleteTournament(due.id);
      result.tournaments += 1;
    } catch {
      result.failed += 1;
    }
  }

  result.organizations = await store.anonymiseDueOrganizations(nowIso);
  return result;
}

/**
 * Runs inside the API process: a minute after start, then every 6 hours. A deployment restart
 * only delays it. PRIVACY_PURGE_DISABLED=1 turns it off.
 */
export function startPrivacyPurgeSchedule(
  store: Store,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): () => void {
  if (process.env['PRIVACY_PURGE_DISABLED'] === '1') return () => undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPrivacyPurge(store);
      if (result.receipts || result.tournaments || result.organizations || result.failed) {
        log.info({ ...result }, 'privacy purge finished');
      }
    } catch (err) {
      log.error({ err }, 'privacy purge failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
  const repeat = setInterval(() => void run(), PURGE_INTERVAL_MS);
  first.unref();
  repeat.unref();
  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}
