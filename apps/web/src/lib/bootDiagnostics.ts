import * as Sentry from '@sentry/react';
import { sentryEnabled } from '../instrument';

export type BootIssueCode =
  | 'AUTH_SESSION_TIMEOUT'
  | 'AUTH_SESSION_FAILED'
  | 'AUTH_CALLBACK_TIMEOUT'
  | 'AUTH_NOT_CONFIGURED'
  | 'PAGE_LOAD_FAILED'
  | 'RENDERER_CRASH'
  | 'WINDOW_UNRESPONSIVE'
  | 'WINDOW_SHOW_TIMEOUT'
  | 'MAIN_UNCAUGHT'
  | 'BOOT_UI_STUCK'
  | 'INDEXEDDB_OPEN_FAILED';

export interface BootIssue {
  code: BootIssueCode | string;
  message: string;
  at: string;
  details?: string;
}

const STORAGE_KEY = 'chess-alokas-boot-issue';
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function isFresh(issue: BootIssue | null): BootIssue | null {
  if (!issue?.at) return issue;
  const ts = Date.parse(issue.at);
  if (!Number.isFinite(ts)) return issue;
  // Ignore leftovers from a previous day so a one-off crash doesn't stick on login.
  if (Date.now() - ts > 6 * 60 * 60 * 1000) return null;
  return issue;
}

export function getLastBootIssue(): BootIssue | null {
  if (typeof window === 'undefined') return null;
  const fromDesktop = isFresh(window.desktop?.getLastError?.() ?? null);
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const fromSession: BootIssue | null = raw ? isFresh(JSON.parse(raw) as BootIssue) : null;
    if (fromDesktop && fromSession) {
      return Date.parse(fromDesktop.at) >= Date.parse(fromSession.at) ? fromDesktop : fromSession;
    }
    return fromDesktop ?? fromSession;
  } catch {
    return fromDesktop;
  }
}

export function clearBootIssue() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function reportBootIssue(
  code: BootIssue['code'],
  message: string,
  details?: string,
): BootIssue {
  const issue: BootIssue = {
    code,
    message,
    details,
    at: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(issue));
  } catch {
    /* ignore */
  }
  window.desktop?.reportBootIssue?.(issue);
  if (sentryEnabled) {
    Sentry.captureMessage(`[${code}] ${message}`, {
      level: 'warning',
      tags: { boot_code: String(code) },
      extra: { details: details ?? '' },
    });
  } else {
    console.warn('[boot]', code, message, details ?? '');
  }
  emit();
  return issue;
}

export function subscribeBootIssue(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function formatBootIssue(issue: BootIssue): string {
  return [
    `Error: ${issue.code}`,
    issue.message,
    issue.details ? `Details: ${issue.details}` : null,
    `Time: ${issue.at}`,
  ]
    .filter(Boolean)
    .join('\n');
}
