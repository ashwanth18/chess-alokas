import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDatabaseSql } from '../auth.js';

const ALLOWED_ROUTE_KEYS = new Set([
  'live',
  'live_player',
  'app_home',
  'tournament',
  'tournament_import',
  'certificates',
  'simulator',
  'account',
  'settings',
  'admin',
  'landing',
  'login',
  'signup',
]);

const BodySchema = z.object({
  path: z.string().min(1).max(500),
  routeKey: z.string().min(1).max(64),
  tournamentId: z.string().uuid().optional().nullable(),
  liveToken: z.string().min(8).max(128).optional().nullable(),
});

const ALLOWED_EVENTS = new Set(['download_click', 'desktop_launch', 'desktop_heartbeat']);
const ALLOWED_ASSETS = new Set([
  'win-setup',
  'win-portable',
  'mac-arm64',
  'mac-x64',
  'linux-appimage',
]);
const ALLOWED_OS = new Set(['windows', 'macos', 'linux', 'android', 'ios']);
const ALLOWED_ARCH = new Set(['x64', 'arm64']);

const EventSchema = z.object({
  name: z.string().min(1).max(64),
  assetId: z.string().max(64).optional().nullable(),
  runtime: z.enum(['web', 'desktop']).optional(),
  os: z.string().max(32).optional().nullable(),
  arch: z.string().max(16).optional().nullable(),
  appVersion: z.string().max(64).optional().nullable(),
  locale: z.string().max(32).optional().nullable(),
  timezone: z.string().max(64).optional().nullable(),
  installId: z.string().max(80).optional().nullable(),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function countryFromHeaders(headers: Record<string, unknown>): string | null {
  const keys = [
    'cf-ipcountry',
    'cloudfront-viewer-country',
    'x-vercel-ip-country',
    'x-country-code',
    'x-geo-country',
  ];
  for (const key of keys) {
    const raw = headers[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && /^[a-z]{2}$/i.test(value) && value.toUpperCase() !== 'XX') {
      return value.toUpperCase();
    }
  }
  return null;
}

function osFromUa(ua: string | null): string | null {
  if (!ua) return null;
  const l = ua.toLowerCase();
  if (l.includes('windows')) return 'windows';
  if (l.includes('mac os') || l.includes('macintosh')) return 'macos';
  if (l.includes('android')) return 'android';
  if (l.includes('iphone') || l.includes('ipad')) return 'ios';
  if (l.includes('linux')) return 'linux';
  return null;
}

function referrerHost(header: string | undefined): string | null {
  if (!header) return null;
  try {
    return new URL(header).host.slice(0, 200) || null;
  } catch {
    return null;
  }
}

export const publicAnalyticsPlugin: FastifyPluginAsync = async (app) => {
  app.post('/public/analytics/pageview', async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid pageview payload' });
    }
    const { path, routeKey, tournamentId, liveToken } = parsed.data;
    if (!ALLOWED_ROUTE_KEYS.has(routeKey)) {
      return reply.code(400).send({ error: 'Unknown routeKey' });
    }

    const sql = getDatabaseSql();
    if (!sql) {
      return reply.code(204).send();
    }

    const ua = request.headers['user-agent'];
    const userAgent = typeof ua === 'string' ? ua.slice(0, 400) : null;
    const ref = referrerHost(
      typeof request.headers.referer === 'string' ? request.headers.referer : undefined,
    );
    const tokenHash = liveToken ? hashToken(liveToken) : null;

    try {
      await sql`
        INSERT INTO page_views (path, route_key, tournament_id, live_token_hash, referrer_host, user_agent)
        VALUES (
          ${path.slice(0, 500)},
          ${routeKey},
          ${tournamentId ?? null}::uuid,
          ${tokenHash},
          ${ref},
          ${userAgent}
        )
      `;
    } catch (err) {
      request.log.warn({ err }, 'pageview insert failed');
    }
    return reply.code(204).send();
  });

  app.post('/public/analytics/event', async (request, reply) => {
    const parsed = EventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid event payload' });
    }
    const body = parsed.data;
    if (!ALLOWED_EVENTS.has(body.name)) {
      return reply.code(400).send({ error: 'Unknown event' });
    }
    if (body.assetId && !ALLOWED_ASSETS.has(body.assetId)) {
      return reply.code(400).send({ error: 'Unknown asset' });
    }

    const sql = getDatabaseSql();
    if (!sql) {
      return reply.code(204).send();
    }

    const ua = request.headers['user-agent'];
    const userAgent = typeof ua === 'string' ? ua.slice(0, 400) : null;
    const os =
      body.os && ALLOWED_OS.has(body.os) ? body.os : osFromUa(userAgent);
    const arch = body.arch && ALLOWED_ARCH.has(body.arch) ? body.arch : null;
    const runtime = body.runtime === 'desktop' ? 'desktop' : 'web';
    const country = countryFromHeaders(request.headers as Record<string, unknown>);
    const installHash = body.installId ? hashToken(body.installId) : null;

    try {
      await sql`
        INSERT INTO product_events (
          event_name, asset_id, runtime, os, arch, app_version,
          country, locale, timezone, install_id_hash, user_agent
        )
        VALUES (
          ${body.name},
          ${body.assetId ?? null},
          ${runtime},
          ${os},
          ${arch},
          ${body.appVersion?.slice(0, 64) ?? null},
          ${country},
          ${body.locale?.slice(0, 32) ?? null},
          ${body.timezone?.slice(0, 64) ?? null},
          ${installHash},
          ${userAgent}
        )
      `;
    } catch (err) {
      request.log.warn({ err }, 'product event insert failed');
    }
    return reply.code(204).send();
  });
};
