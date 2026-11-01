import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { redactUrl } from './lib/logRedaction.js';

const dsn = process.env['SENTRY_DSN']?.trim();
const isProd = process.env['NODE_ENV'] === 'production';

export const sentryEnabled = Boolean(dsn);

/** Removes what identifies or places a person, whatever the SDK collected by itself. */
export function scrubServerEvent<T extends Pick<ErrorEvent, 'request' | 'user'>>(event: T): T {
  if (event.request?.headers) {
    const headers = { ...event.request.headers } as Record<string, string>;
    for (const key of Object.keys(headers)) {
      if (/authorization|cookie|x-api-key/i.test(key)) {
        headers[key] = '[Filtered]';
      }
    }
    event.request.headers = headers;
  }
  if (event.request?.url) event.request.url = redactUrl(event.request.url);
  if (event.request?.query_string) delete event.request.query_string;
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT']?.trim() || (isProd ? 'production' : 'development'),
    release: process.env['SENTRY_RELEASE']?.trim() || undefined,
    tracesSampleRate: isProd ? 0.1 : 1.0,
    beforeSend: (event) => scrubServerEvent(event),
  });
  Sentry.setTag('runtime', 'api');
}

export { Sentry };
