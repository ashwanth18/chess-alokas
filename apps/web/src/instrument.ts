import * as Sentry from '@sentry/react';

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) ||
  import.meta.env.VITE_DESKTOP === '1';

const isProd = import.meta.env.PROD;

function scrubValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let next = value;
  next = next.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [Filtered]');
  next = next.replace(/\/live\/[A-Za-z0-9_\-]+/gi, '/live/[Filtered]');
  next = next.replace(/\/t\/[A-Za-z0-9_\-]+/gi, '/t/[Filtered]');
  next = next.replace(/(\/|%2F)invite(\/|%2F)[A-Za-z0-9_\-]+/gi, '/invite/[Filtered]');
  next = next.replace(/arbiter[_-]?pin["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'arbiter_pin=[Filtered]');
  next = next.replace(/password["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'password=[Filtered]');
  next = next.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]');
  next = next.replace(/\b\d{6}-?\d{2}-?\d{4}\b/g, '[nric]');
  // Windows / macOS / Linux home folders carry the person's account name.
  next = next.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"')]+/gi, '$1[user]');
  next = next.replace(/(\/(?:Users|home)\/)[^/\s"')]+/g, '$1[user]');
  return next;
}

function scrubUrlFields(data: Record<string, unknown> | undefined) {
  if (!data) return;
  for (const key of ['url', 'from', 'to', 'http.url', 'http.query', 'url.full', 'url.path']) {
    if (key in data) data[key] = scrubValue(data[key]);
  }
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  // Console output can hold names and emails, and is not needed to triage errors.
  if (crumb.category === 'console') return null;
  if (crumb.message) crumb.message = String(scrubValue(crumb.message));
  scrubUrlFields(crumb.data as Record<string, unknown> | undefined);
  return crumb;
}

function scrubStackPaths(event: Sentry.Event) {
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = String(scrubValue(ex.value));
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = String(scrubValue(frame.filename));
      if (frame.abs_path) frame.abs_path = String(scrubValue(frame.abs_path));
    }
  }
}

function scrubRequest(event: Sentry.Event) {
  scrubUrlFields(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  if (event.request?.headers) {
    const headers = { ...event.request.headers };
    for (const key of Object.keys(headers)) {
      if (/authorization|cookie|x-api-key/i.test(key)) {
        headers[key] = '[Filtered]';
      }
    }
    event.request.headers = headers;
  }
  if (event.request?.url) {
    event.request.url = String(scrubValue(event.request.url));
  }
}

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() ||
      (isProd ? 'production' : 'development'),
    release: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || undefined,
    sendDefaultPii: false,
    // Free-tier: errors + light tracing only — no Session Replay / profiling / logs product
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: isProd ? 0.1 : 1.0,
    tracePropagationTargets: [
      'localhost',
      /^https:\/\/chess-manager\.alokas\.com/i,
      /^\//,
    ],
    ignoreErrors: [
      'Failed to fetch',
      'Load failed',
      'NetworkError',
      'Network request failed',
      /AbortError/i,
      /ResizeObserver loop/i,
      // Classified as INDEXEDDB_OPEN_FAILED via reportBootIssue — avoid duplicate crash noise.
      /DatabaseClosedError/i,
      /Internal error opening backing store/i,
    ],
    beforeBreadcrumb(crumb) {
      return scrubBreadcrumb(crumb);
    },
    beforeSend(event) {
      scrubRequest(event);
      scrubStackPaths(event);
      if (event.message) {
        event.message = String(scrubValue(event.message));
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs
          .map((crumb) => scrubBreadcrumb(crumb))
          .filter((crumb): crumb is Sentry.Breadcrumb => crumb !== null);
      }
      if (event.user) {
        // Only the opaque id ever leaves the device.
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      return event;
    },
    beforeSendTransaction(event) {
      scrubRequest(event);
      if (event.transaction) event.transaction = String(scrubValue(event.transaction));
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      for (const span of event.spans ?? []) {
        if (span.description) span.description = String(scrubValue(span.description));
        scrubUrlFields(span.data as Record<string, unknown> | undefined);
      }
      return event;
    },
  });

  Sentry.setTag('runtime', isDesktop ? 'desktop' : 'web');
  if (isDesktop && typeof window !== 'undefined' && window.desktop) {
    if (window.desktop.platform) {
      Sentry.setTag('desktop_platform', window.desktop.platform);
    }
    try {
      const ver = window.desktop.getAppVersion?.();
      if (ver) Sentry.setTag('desktop_version', ver);
    } catch {
      /* ignore */
    }
  }
}

export { Sentry };
export const sentryEnabled = Boolean(dsn);
