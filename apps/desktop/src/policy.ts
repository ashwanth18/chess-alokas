/**
 * Pure security / reliability policy helpers. No Electron imports, so they can
 * be unit-tested with `node --test` (see apps/desktop/test).
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Exact file:// URL (no hash or query) of the app's index page. */
export function indexFileUrl(indexHtmlPath: string): string {
  return pathToFileURL(indexHtmlPath).href;
}

/** True only for the app index page itself; the hash carries the route. */
export function isAppPageUrl(url: string, indexUrl: string): boolean {
  try {
    const u = new URL(url);
    const idx = new URL(indexUrl);
    return u.protocol === 'file:' && u.host === '' && u.pathname === idx.pathname && u.search === '';
  } catch {
    return false;
  }
}

/** True when a file:// request resolves inside the web root (assets of the app). */
export function isInsideWebRoot(url: string, webRootUrl: string): boolean {
  try {
    const u = new URL(url);
    const rootHref = webRootUrl.endsWith('/') ? webRootUrl : `${webRootUrl}/`;
    const root = new URL(rootHref);
    return (
      u.protocol === 'file:' &&
      u.host === '' &&
      // URL parsing has already collapsed any ../ and %2e%2e segments.
      u.pathname.toLowerCase().startsWith(root.pathname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function sha256(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** CSP hashes for inline <script> blocks and inline on* attributes in index.html. */
export function inlineHashesFromHtml(raw: string): { scripts: string[]; handlers: string[] } {
  // The HTML parser turns CRLF into LF before the browser hashes inline code.
  const html = raw.replace(/\r\n?/g, '\n');
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1]) scripts.push(sha256(m[1]));
  }
  const handlers: string[] = [];
  for (const m of html.matchAll(/\son[a-z]+="([^"]*)"/gi)) {
    if (m[1]) handlers.push(sha256(m[1]));
  }
  return { scripts, handlers };
}

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp(args: {
  html: string;
  apiBaseUrl: string;
  supabaseUrl?: string | null;
  sentryDsn?: string | null;
}): string {
  const { scripts, handlers } = inlineHashesFromHtml(args.html);
  const scriptSrc = ["'self'", 'file:', ...scripts];
  if (handlers.length) scriptSrc.push("'unsafe-hashes'", ...handlers);

  const supabase = originOf(args.supabaseUrl);
  const connect = ["'self'", 'file:', 'blob:', 'data:'];
  const api = originOf(args.apiBaseUrl);
  if (api) connect.push(api);
  if (supabase) connect.push(supabase, supabase.replace(/^http/, 'ws'));
  const sentry = originOf(args.sentryDsn);
  if (sentry) connect.push(sentry);

  return [
    "default-src 'self' file:",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' file: 'unsafe-inline'",
    "font-src 'self' file: data:",
    "img-src 'self' file: data: blob: https:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' file: blob:",
    'frame-src blob:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Allows at most `max` automatic recoveries inside `windowMs`. */
export function createCrashGuard(max: number, windowMs: number, now: () => number = Date.now) {
  let hits: number[] = [];
  return {
    allow(): boolean {
      const t = now();
      hits = hits.filter((h) => t - h < windowMs);
      if (hits.length >= max) return false;
      hits.push(t);
      return true;
    },
    reset() {
      hits = [];
    },
  };
}

// ── IPC argument validation ────────────────────────────────────────────────

const MAX_PLAYERS = 10_000;
const MAX_GAMES = 500_000;

function fail(what: string): never {
  throw new Error(`Invalid pairing input: ${what}`);
}

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) fail(what);
  return v;
}

function optId(v: unknown, what: string): string | null {
  if (v === null || v === undefined) return null;
  return str(v, what, 128);
}

function optNum(v: unknown, what: string): number | null | undefined {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(what);
  return v;
}

function intIn(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(what);
  return v;
}

export type ValidDutchInput = {
  players: Array<{ id: string; name: string; rating?: number | null; seed?: number }>;
  pastGames: Array<{
    round: number;
    whiteId: string | null;
    blackId: string | null;
    result: string;
    isBye: boolean;
  }>;
  round: number;
  totalRounds?: number;
  initialColor?: 'W' | 'B';
};

/** Validates and copies only known fields, so nothing unexpected reaches the engine. */
export function validateDutchInput(raw: unknown): ValidDutchInput {
  if (!raw || typeof raw !== 'object') fail('not an object');
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input['players']) || input['players'].length > MAX_PLAYERS) fail('players');
  if (!Array.isArray(input['pastGames']) || input['pastGames'].length > MAX_GAMES) fail('pastGames');

  const players = (input['players'] as unknown[]).map((p) => {
    if (!p || typeof p !== 'object') fail('player');
    const r = p as Record<string, unknown>;
    const seed = optNum(r['seed'], 'player seed');
    return {
      id: str(r['id'], 'player id', 128),
      // Names may be odd after import; the TRF builder sanitises them.
      name: typeof r['name'] === 'string' ? r['name'].slice(0, 256) : fail('player name'),
      rating: optNum(r['rating'], 'player rating'),
      ...(seed == null ? {} : { seed }),
    };
  });

  const pastGames = (input['pastGames'] as unknown[]).map((g) => {
    if (!g || typeof g !== 'object') fail('game');
    const r = g as Record<string, unknown>;
    if (typeof r['isBye'] !== 'boolean') fail('game isBye');
    const result = r['result'] ?? '*';
    if (typeof result !== 'string' || result.length > 16) fail('game result');
    return {
      round: intIn(r['round'], 'game round', 0, 1000),
      whiteId: optId(r['whiteId'], 'game whiteId'),
      blackId: optId(r['blackId'], 'game blackId'),
      result,
      isBye: r['isBye'],
    };
  });

  const out: ValidDutchInput = {
    players,
    pastGames,
    round: intIn(input['round'], 'round', 1, 1000),
  };
  if (input['totalRounds'] !== undefined && input['totalRounds'] !== null) {
    out.totalRounds = intIn(input['totalRounds'], 'totalRounds', 1, 1000);
  }
  if (input['initialColor'] !== undefined && input['initialColor'] !== null) {
    if (input['initialColor'] !== 'W' && input['initialColor'] !== 'B') fail('initialColor');
    out.initialColor = input['initialColor'];
  }
  return out;
}

export function validateBootIssue(
  raw: unknown,
): { code: string; message: string; details?: string; at?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['code'] !== 'string' || typeof r['message'] !== 'string') return null;
  if (!r['code'] || !r['message']) return null;
  return {
    code: r['code'].slice(0, 64),
    message: r['message'].slice(0, 500),
    details: typeof r['details'] === 'string' ? r['details'].slice(0, 4000) : undefined,
    at: typeof r['at'] === 'string' ? r['at'].slice(0, 40) : undefined,
  };
}

// ── Backup file names ──────────────────────────────────────────────────────

const SNAPSHOT_NAME = /^snapshot-\d{8}-\d{6}-\d{3}-[a-z-]{1,24}\.json$/;

export function isSnapshotName(name: unknown): name is string {
  return typeof name === 'string' && SNAPSHOT_NAME.test(name);
}

export function snapshotName(reason: string, at: Date): string {
  const safe = reason.toLowerCase().replace(/[^a-z-]/g, '').slice(0, 24) || 'auto';
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-` +
    `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}-${p(at.getMilliseconds(), 3)}`;
  return `snapshot-${stamp}-${safe}.json`;
}

/** Names to delete so only the newest `keep` remain. Names sort chronologically. */
export function snapshotsToPrune(names: string[], keep: number): string[] {
  const sorted = names.filter(isSnapshotName).sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

// ── Crash reporting scrubber ───────────────────────────────────────────────

/** Removes paths, emails, tokens and public-link secrets from report text. */
export function scrubReportText(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"')]+/gi, '<home>')
    .replace(/\/(?:Users|home)\/[^/\s"')]+/g, '<home>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [Filtered]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, '[jwt]')
    .replace(/\/live\/[A-Za-z0-9_-]+/g, '/live/[Filtered]')
    .replace(/\/t\/[A-Za-z0-9_-]+/g, '/t/[Filtered]');
}

export function parseDsn(dsn: string): { envelopeUrl: string; publicKey: string; dsn: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) return null;
    return {
      envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
      dsn,
    };
  } catch {
    return null;
  }
}

/** Minimal Sentry envelope. Deliberately has no user or device name. */
export function buildErrorEnvelope(args: {
  dsn: string;
  eventId: string;
  code: string;
  message: string;
  stack?: string;
  release: string;
  environment: string;
  platform: string;
  timestampMs: number;
}): string {
  const event = {
    event_id: args.eventId,
    timestamp: args.timestampMs / 1000,
    platform: 'node',
    level: 'error',
    logger: 'desktop-main',
    release: args.release,
    environment: args.environment,
    server_name: 'desktop',
    tags: { runtime: 'desktop-main', code: args.code, desktop_platform: args.platform },
    exception: {
      values: [{ type: args.code, value: scrubReportText(args.message).slice(0, 1000) }],
    },
    extra: args.stack ? { stack: scrubReportText(args.stack).slice(0, 8000) } : undefined,
  };
  return [
    JSON.stringify({
      event_id: args.eventId,
      dsn: args.dsn,
      sent_at: new Date(args.timestampMs).toISOString(),
    }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}
