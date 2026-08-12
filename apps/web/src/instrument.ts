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
  next = next.replace(/arbiter[_-]?pin["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'arbiter_pin=[Filtered]');
  next = next.replace(/password["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'password=[Filtered]');
  return next;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() ||
      (isProd ? 'production' : 'development'),
    release: (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || undefined,
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
    ],
    beforeSend(event) {
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
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = String(scrubValue(ex.value));
        }
      }
      if (event.message) {
        event.message = String(scrubValue(event.message));
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
