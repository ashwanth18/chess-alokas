import * as Sentry from '@sentry/react';
import { sentryEnabled } from '../instrument';

export function buildSupportInfo(opts: {
  email?: string | null;
  displayName?: string | null;
}): string {
  const isDesktop = Boolean(window.desktop?.isDesktop);
  const version =
    (isDesktop && window.desktop?.getAppVersion?.()) ||
    (import.meta.env.VITE_APP_VERSION as string | undefined) ||
    'unknown';
  const lastEventId = sentryEnabled ? Sentry.lastEventId() : null;

  return [
    'Chess Alokas support info',
    `Runtime: ${isDesktop ? 'desktop' : 'web'}`,
    isDesktop && window.desktop?.platform ? `Platform: ${window.desktop.platform}` : null,
    `Version: ${version}`,
    opts.email ? `Email: ${opts.email}` : null,
    opts.displayName ? `Name: ${opts.displayName}` : null,
    `URL: ${typeof location !== 'undefined' ? location.href : 'n/a'}`,
    `Sentry: ${sentryEnabled ? 'enabled' : 'disabled'}`,
    lastEventId ? `Last Sentry event: ${lastEventId}` : null,
    `Time: ${new Date().toISOString()} (UTC)`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function copySupportInfo(opts: {
  email?: string | null;
  displayName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = buildSupportInfo(opts);
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not copy to clipboard' };
  }
}
