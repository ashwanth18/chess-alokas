import { isNetworkFailure } from './offline';

export type QueuedFloorResult = {
  slug: string;
  token: string;
  result: string;
  arbiterName?: string;
  tableNumber?: number;
  queuedAt: string;
};

/** A queued result the server refused. It was not recorded, so the arbiter must be told. */
export type RejectedFloorResult = {
  slug: string;
  tableNumber?: number;
  result: string;
  reason: string;
  /** What the server holds for this table, when it could be read. */
  serverResult?: string | null;
  rejectedAt: string;
};

export type FlushAttempt = { ok: true } | { ok: false; error: string };

export type FlushSummary = {
  submitted: number;
  remaining: QueuedFloorResult[];
  rejected: { item: QueuedFloorResult; reason: string }[];
};

/** Sorts each attempt: accepted, still offline (retry later), or refused by the server. */
export function summarizeFlush(
  attempts: { item: QueuedFloorResult; attempt: FlushAttempt }[],
): FlushSummary {
  const summary: FlushSummary = { submitted: 0, remaining: [], rejected: [] };
  for (const { item, attempt } of attempts) {
    if (attempt.ok) summary.submitted += 1;
    else if (isNetworkFailure(attempt.error)) summary.remaining.push(item);
    else summary.rejected.push({ item, reason: attempt.error });
  }
  return summary;
}

export function flushBanner(summary: FlushSummary): string | null {
  const parts: string[] = [];
  if (summary.submitted > 0) {
    parts.push(`Synced ${summary.submitted} queued result${summary.submitted === 1 ? '' : 's'}.`);
  }
  if (summary.rejected.length > 0) {
    parts.push(
      `${summary.rejected.length} not accepted — see the table${summary.rejected.length === 1 ? '' : 's'} below.`,
    );
  }
  if (summary.remaining.length > 0) {
    parts.push(`${summary.remaining.length} still waiting for connection.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function resultLabel(result: string): string {
  return result === '1/2-1/2' ? '½–½' : result;
}

export function conflictMessage(rejected: RejectedFloorResult): string {
  const table = rejected.tableNumber ? `Table ${rejected.tableNumber}` : 'This table';
  const yours = resultLabel(rejected.result);
  if (rejected.serverResult && rejected.serverResult !== 'pending') {
    if (rejected.serverResult === rejected.result) {
      return `${table}: ${yours} was already recorded by someone else. Nothing to do.`;
    }
    return `${table}: your ${yours} was NOT saved. The server holds ${resultLabel(rejected.serverResult)}. Ask the chief arbiter to check it.`;
  }
  return `${table}: your ${yours} was NOT saved — ${rejected.reason}`;
}
