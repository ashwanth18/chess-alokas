/** True when an error message means the server could not be reached (not that it refused). */
export function isNetworkFailure(raw: unknown): boolean {
  const text = raw instanceof Error ? raw.message : String(raw ?? '');
  // 5xx from a proxy or a restarting API: retry rather than treat it as the server refusing.
  if (/request failed \(5\d\d\)/i.test(text)) return true;
  return /abort|timeout|timed out|failed to fetch|networkerror|network request|network error|load failed|offline/i.test(
    text,
  );
}
