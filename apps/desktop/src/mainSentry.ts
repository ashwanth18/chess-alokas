import { randomUUID } from 'node:crypto';
import { app, net } from 'electron';
import log from 'electron-log/main';
import { readBuildConfig } from './buildConfig.js';
import { buildErrorEnvelope, parseDsn } from './policy.js';

/**
 * Main-process error reporting without PII, using Sentry's envelope endpoint
 * directly. Native minidumps are deliberately not collected: they contain
 * process memory, which here can include player data and tokens.
 */
export function reportMainError(code: string, message: string, stack?: string): void {
  try {
    const { sentryDsn } = readBuildConfig();
    const parsed = sentryDsn ? parseDsn(sentryDsn) : null;
    if (!parsed || !app.isPackaged || !app.isReady()) return;
    const body = buildErrorEnvelope({
      dsn: parsed.dsn,
      eventId: randomUUID().replace(/-/g, ''),
      code,
      message,
      stack,
      release: `desktop@v${app.getVersion()}`,
      environment: 'production',
      platform: process.platform,
      timestampMs: Date.now(),
    });
    void net
      .fetch(parsed.envelopeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body,
      })
      .then((res) => log.info('Main-process report sent', code, res.status))
      .catch((err: unknown) => {
        log.warn('Main-process report not sent', code, err instanceof Error ? err.message : String(err));
      });
  } catch (err) {
    log.warn('Main-process report failed', err instanceof Error ? err.message : String(err));
  }
}
