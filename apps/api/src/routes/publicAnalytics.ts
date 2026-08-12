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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
};
