import { resolveApiBaseUrl } from '../api/client';

export type AnalyticsRouteKey =
  | 'live'
  | 'live_player'
  | 'app_home'
  | 'tournament'
  | 'tournament_import'
  | 'certificates'
  | 'simulator'
  | 'account'
  | 'settings'
  | 'admin'
  | 'landing'
  | 'login'
  | 'signup';

type TrackArgs = {
  routeKey: AnalyticsRouteKey;
  path: string;
  tournamentId?: string | null;
  liveToken?: string | null;
};

let lastKey = '';
let lastAt = 0;

export function trackPageView(args: TrackArgs): void {
  const path = args.path.slice(0, 500);
  const dedupe = `${args.routeKey}|${path}`;
  const now = Date.now();
  if (dedupe === lastKey && now - lastAt < 2000) return;
  lastKey = dedupe;
  lastAt = now;

  const tournamentId =
    args.tournamentId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      args.tournamentId,
    )
      ? args.tournamentId
      : null;

  const payload = JSON.stringify({
    path,
    routeKey: args.routeKey,
    tournamentId,
    liveToken: args.liveToken ?? null,
  });

  const url = `${resolveApiBaseUrl()}/public/analytics/pageview`;
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

/** Map authenticated app paths to analytics route keys. */
export function routeKeyFromAppPath(pathname: string): AnalyticsRouteKey | null {
  if (pathname === '/app' || pathname === '/app/') return 'app_home';
  if (pathname.startsWith('/tournaments/new')) return null;
  if (/^\/tournaments\/[^/]+\/import/.test(pathname)) return 'tournament_import';
  if (/^\/tournaments\/[^/]+/.test(pathname)) return 'tournament';
  if (pathname.startsWith('/certificates')) return 'certificates';
  if (pathname.startsWith('/simulator')) return 'simulator';
  if (pathname.startsWith('/account')) return 'account';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  return null;
}
