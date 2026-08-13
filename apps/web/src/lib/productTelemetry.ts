import { resolveApiBaseUrl } from '../api/client';

export type ProductEventName = 'download_click' | 'desktop_launch' | 'desktop_heartbeat';

type ProductEventArgs = {
  name: ProductEventName;
  assetId?: string | null;
  os?: string | null;
  arch?: string | null;
  appVersion?: string | null;
};

const INSTALL_KEY = 'chess-alokas-install-id';
const HEARTBEAT_KEY = 'chess-alokas-last-heartbeat';

function anonymousInstallId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

function clientOs(): string | null {
  if (typeof navigator === 'undefined') return null;
  if (window.desktop?.platform === 'win32') return 'windows';
  if (window.desktop?.platform === 'darwin') return 'macos';
  if (window.desktop?.platform === 'linux') return 'linux';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  return null;
}

function clientArch(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  const arch = (
    navigator as Navigator & { userAgentData?: { architecture?: string } }
  ).userAgentData?.architecture?.toLowerCase();
  if (arch === 'arm' || ua.includes('arm64') || ua.includes('aarch64')) return 'arm64';
  if (arch === 'x86' || ua.includes('win64') || ua.includes('x64') || ua.includes('amd64')) {
    return 'x64';
  }
  return null;
}

function localeAndZone(): { locale: string | null; timezone: string | null } {
  let locale: string | null = null;
  let timezone: string | null = null;
  try {
    locale = navigator.language?.slice(0, 32) || null;
  } catch {
    /* ignore */
  }
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64) || null;
  } catch {
    /* ignore */
  }
  return { locale, timezone };
}

export function trackProductEvent(args: ProductEventArgs): void {
  const { locale, timezone } = localeAndZone();
  const isDesktop = Boolean(window.desktop?.isDesktop);
  const payload = JSON.stringify({
    name: args.name,
    assetId: args.assetId ?? null,
    runtime: isDesktop ? 'desktop' : 'web',
    os: args.os ?? clientOs(),
    arch: args.arch ?? clientArch(),
    appVersion:
      args.appVersion ??
      (isDesktop ? window.desktop?.getAppVersion?.() : undefined) ??
      (import.meta.env.VITE_APP_VERSION as string | undefined) ??
      null,
    locale,
    timezone,
    installId: anonymousInstallId(),
  });

  const url = `${resolveApiBaseUrl()}/public/analytics/event`;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    /* fall through */
  }

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    /* ignore */
  });
}

/** Once per app version for first launch, then at most daily. */
export function trackDesktopPresence(): void {
  if (!window.desktop?.isDesktop) return;
  const version = window.desktop.getAppVersion?.() || 'unknown';
  const launchKey = `chess-alokas-launch-sent:${version}`;
  try {
    if (!localStorage.getItem(launchKey)) {
      localStorage.setItem(launchKey, '1');
      trackProductEvent({ name: 'desktop_launch', appVersion: version });
      localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
      return;
    }
    const last = Number(localStorage.getItem(HEARTBEAT_KEY) || '0');
    if (Date.now() - last < 20 * 60 * 60 * 1000) return;
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    trackProductEvent({ name: 'desktop_heartbeat', appVersion: version });
  } catch {
    trackProductEvent({ name: 'desktop_heartbeat', appVersion: version });
  }
}
