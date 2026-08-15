/** User-facing copy for sync failures. Keep this short — it shows in the top bar. */
export function syncErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const text = raw.trim() || 'Sync failed';

  if (/failed to fetch|load failed|networkerror|network request failed|offline/i.test(text)) {
    return 'Could not reach the server. Check the internet connection and try Sync again.';
  }
  if (/abort|timeout|timed out/i.test(text)) {
    return 'Sync timed out. Try again on a stronger connection.';
  }
  if (/401|unauthorized|missing bearer|invalid token/i.test(text)) {
    return 'Sign-in expired. Sign in again, then Sync.';
  }
  if (/403|forbidden/i.test(text)) {
    return 'This account cannot sync that tournament.';
  }
  if (/indexeddb|databaseclosed|backing store/i.test(text)) {
    return 'Local data is locked. Close other Chess Alokas windows, then Sync again.';
  }

  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

export function reportSyncFailure(err: unknown): void {
  const original = err instanceof Error ? err.message : String(err ?? '');
  const wrapped = new Error(`Sync failed: ${syncErrorMessage(err)}`);
  console.error('[sync]', err);
  void import('@sentry/react').then((Sentry) => {
    Sentry.captureException(wrapped, { extra: { original } });
  });
}
