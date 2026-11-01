const STORAGE_KEY = 'alokas:authReturnTo';
/** Long enough to find a confirmation email, short enough not to surprise someone next week. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Only a path inside this app. Anything else would make the sign-in page an open redirect. */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Browsers treat a backslash as a slash, and control characters can hide either.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(raw)) return null;
  return raw;
}

export function loginPathFor(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function signupPathFor(returnTo: string): string {
  return `/signup?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Kept in storage because an email confirmation link comes back in a new tab. */
export function rememberReturnTo(path: string, now = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, at: now }));
  } catch {
    /* Private window: the query string still covers same-tab sign-in. */
  }
}

export function clearReturnTo(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function peekReturnTo(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: string; at?: number };
    if (typeof parsed.at !== 'number' || now - parsed.at > MAX_AGE_MS) {
      clearReturnTo();
      return null;
    }
    return safeReturnTo(parsed.path);
  } catch {
    return null;
  }
}

/** Where sign-in should lead: the page's own query string, else what an earlier page stored. */
export function resolveReturnTo(search: string): string | null {
  const fromQuery = safeReturnTo(new URLSearchParams(search).get('returnTo'));
  if (fromQuery) {
    rememberReturnTo(fromQuery);
    return fromQuery;
  }
  return peekReturnTo();
}
