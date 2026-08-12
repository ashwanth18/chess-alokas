import * as Sentry from '@sentry/node';

const dsn = process.env['SENTRY_DSN']?.trim();
const isProd = process.env['NODE_ENV'] === 'production';

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT']?.trim() || (isProd ? 'production' : 'development'),
    release: process.env['SENTRY_RELEASE']?.trim() || undefined,
    tracesSampleRate: isProd ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = { ...event.request.headers } as Record<string, string>;
        for (const key of Object.keys(headers)) {
          if (/authorization|cookie|x-api-key/i.test(key)) {
            headers[key] = '[Filtered]';
          }
        }
        event.request.headers = headers;
      }
      return event;
    },
  });
  Sentry.setTag('runtime', 'api');
}

export { Sentry };
