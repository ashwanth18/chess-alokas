import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseSql, requireAuth, requirePlatformAdmin } from '../auth.js';
import {
  clearStaleFideImportLock,
  getFideImportStatus,
  isFideImportRunning,
  startFideImport,
} from '../fide/importList.js';

export type AdminAccountRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  tournamentCount: number;
  participantCount: number;
  isPlatformAdmin: boolean;
};

export type AdminWeekBucket = {
  weekStart: string;
  users: number;
  resultEvents: number;
  pageViews: number;
  certificates: number;
};

export type AdminOverview = {
  accounts: AdminAccountRow[];
  totals: {
    users: number;
    tournaments: number;
    tournamentsByStatus: Record<string, number>;
    publicLiveEnabled: number;
    participants: number;
    games: number;
    gamesPending: number;
    gamesFinished: number;
    floorTournaments: number;
    tournamentsWithCertificates: number;
    certificateIssuesByStatus: Record<string, number>;
    gameCardsByType: Record<string, number>;
    resultEventsLast7dByRole: Record<string, number>;
  };
  adoption: {
    publicLivePct: number;
    floorTablesPct: number;
    certificatesPct: number;
  };
  growthByWeek: AdminWeekBucket[];
  pageViews: {
    last7d: number;
    last30d: number;
    byRouteKeyLast7d: Record<string, number>;
    byDayLast14d: Array<{ day: string; count: number }>;
    topLiveHashesLast7d: Array<{ hashPrefix: string; count: number }>;
  };
  recentTournaments: Array<{
    id: string;
    name: string;
    status: string;
    ownerEmail: string | null;
    participantCount: number;
    publicEnabled: boolean;
    currentRound: number;
    createdAt: string;
    completedAt: string | null;
    updatedAt: string;
  }>;
  /** IANA timezone hint for clients; timestamps are always UTC ISO. */
  timestampsAreUtc: true;
};

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export const adminPlugin: FastifyPluginAsync = async (app) => {
  app.get(
    '/admin/overview',
    { preHandler: [requireAuth, requirePlatformAdmin] },
    async (_request, reply) => {
      const sql = getDatabaseSql();
      if (!sql) {
        return reply.code(503).send({ error: 'Admin requires DATABASE_URL' });
      }

      try {
        const accounts = await sql<
          {
            id: string;
            email: string | null;
            display_name: string | null;
            created_at: string;
            last_sign_in_at: string | null;
            tournament_count: string;
            participant_count: string;
            is_platform_admin: boolean;
          }[]
        >`
          SELECT
            p.id::text AS id,
            u.email,
            p.display_name,
            p.created_at,
            u.last_sign_in_at,
            p.is_platform_admin,
            (
              SELECT COUNT(*)::text
              FROM tournaments t
              WHERE t.owner_id = p.id AND t.deleted_at IS NULL
            ) AS tournament_count,
            (
              SELECT COUNT(*)::text
              FROM participants pt
              JOIN tournaments t ON t.id = pt.tournament_id
              WHERE t.owner_id = p.id
                AND t.deleted_at IS NULL
                AND pt.deleted_at IS NULL
            ) AS participant_count
          FROM profiles p
          JOIN auth.users u ON u.id = p.id
          ORDER BY p.created_at ASC
        `;

        const statusRows = await sql<{ status: string; count: string }[]>`
          SELECT status, COUNT(*)::text AS count
          FROM tournaments
          WHERE deleted_at IS NULL
          GROUP BY status
        `;

        const [totalsRow] = await sql<
          {
            users: string;
            tournaments: string;
            public_live: string;
            participants: string;
            games: string;
            games_pending: string;
            games_finished: string;
            floor_tournaments: string;
            tournaments_with_certs: string;
          }[]
        >`
          SELECT
            (SELECT COUNT(*)::text FROM profiles) AS users,
            (SELECT COUNT(*)::text FROM tournaments WHERE deleted_at IS NULL) AS tournaments,
            (
              SELECT COUNT(*)::text
              FROM tournaments
              WHERE deleted_at IS NULL AND public_enabled = true
            ) AS public_live,
            (
              SELECT COUNT(*)::text
              FROM participants
              WHERE deleted_at IS NULL
            ) AS participants,
            (
              SELECT COUNT(*)::text
              FROM games
              WHERE deleted_at IS NULL
            ) AS games,
            (
              SELECT COUNT(*)::text
              FROM games
              WHERE deleted_at IS NULL AND result = 'pending'
            ) AS games_pending,
            (
              SELECT COUNT(*)::text
              FROM games
              WHERE deleted_at IS NULL AND result <> 'pending'
            ) AS games_finished,
            (
              SELECT COUNT(*)::text
              FROM tournaments
              WHERE deleted_at IS NULL AND COALESCE(table_count, 0) > 0
            ) AS floor_tournaments,
            (
              SELECT COUNT(DISTINCT tournament_id)::text
              FROM certificate_issues
            ) AS tournaments_with_certs
        `;

        const certRows = await sql<{ status: string; count: string }[]>`
          SELECT status, COUNT(*)::text AS count
          FROM certificate_issues
          GROUP BY status
        `;

        const cardRows = await sql<{ card_type: string; count: string }[]>`
          SELECT card_type, COUNT(*)::text AS count
          FROM game_cards
          WHERE deleted_at IS NULL
          GROUP BY card_type
        `;

        const eventRows = await sql<{ actor_role: string; count: string }[]>`
          SELECT actor_role, COUNT(*)::text AS count
          FROM game_result_events
          WHERE created_at >= now() - interval '7 days'
          GROUP BY actor_role
        `;

        // tournaments/participants have no created_at — use event-style growth proxies
        const growthRows = await sql<
          {
            week_start: string;
            users: string;
            result_events: string;
            page_views: string;
            certificates: string;
          }[]
        >`
          WITH weeks AS (
            SELECT generate_series(
              date_trunc('week', now() - interval '7 weeks'),
              date_trunc('week', now()),
              interval '1 week'
            )::date AS week_start
          )
          SELECT
            w.week_start::text AS week_start,
            (
              SELECT COUNT(*)::text
              FROM profiles p
              WHERE date_trunc('week', p.created_at)::date = w.week_start
            ) AS users,
            (
              SELECT COUNT(*)::text
              FROM game_result_events e
              WHERE date_trunc('week', e.created_at)::date = w.week_start
            ) AS result_events,
            (
              SELECT COUNT(*)::text
              FROM page_views pv
              WHERE date_trunc('week', pv.created_at)::date = w.week_start
            ) AS page_views,
            (
              SELECT COUNT(*)::text
              FROM certificate_issues c
              WHERE date_trunc('week', c.created_at)::date = w.week_start
            ) AS certificates
          FROM weeks w
          ORDER BY w.week_start ASC
        `;

        const [pvTotals] = await sql<{ last7d: string; last30d: string }[]>`
          SELECT
            (
              SELECT COUNT(*)::text
              FROM page_views
              WHERE created_at >= now() - interval '7 days'
            ) AS last7d,
            (
              SELECT COUNT(*)::text
              FROM page_views
              WHERE created_at >= now() - interval '30 days'
            ) AS last30d
        `;

        const pvByRoute = await sql<{ route_key: string; count: string }[]>`
          SELECT route_key, COUNT(*)::text AS count
          FROM page_views
          WHERE created_at >= now() - interval '7 days'
          GROUP BY route_key
          ORDER BY COUNT(*) DESC
        `;

        const pvByDay = await sql<{ day: string; count: string }[]>`
          WITH days AS (
            SELECT generate_series(
              (current_date - 13)::timestamp,
              current_date::timestamp,
              interval '1 day'
            )::date AS day
          )
          SELECT
            d.day::text AS day,
            (
              SELECT COUNT(*)::text
              FROM page_views pv
              WHERE pv.created_at::date = d.day
            ) AS count
          FROM days d
          ORDER BY d.day ASC
        `;

        const topLive = await sql<{ hash_prefix: string; count: string }[]>`
          SELECT left(live_token_hash, 8) AS hash_prefix, COUNT(*)::text AS count
          FROM page_views
          WHERE created_at >= now() - interval '7 days'
            AND live_token_hash IS NOT NULL
          GROUP BY live_token_hash
          ORDER BY COUNT(*) DESC
          LIMIT 5
        `;

        const recent = await sql<
          {
            id: string;
            name: string;
            status: string;
            owner_email: string | null;
            participant_count: string;
            public_enabled: boolean;
            current_round: number;
            created_at: string;
            completed_at: string | null;
            updated_at: string;
          }[]
        >`
          SELECT
            t.id::text AS id,
            t.name,
            t.status,
            u.email AS owner_email,
            (
              SELECT COUNT(*)::text
              FROM participants pt
              WHERE pt.tournament_id = t.id AND pt.deleted_at IS NULL
            ) AS participant_count,
            COALESCE(t.public_enabled, false) AS public_enabled,
            COALESCE(t.current_round, 0) AS current_round,
            t.created_at,
            t.completed_at,
            t.updated_at
          FROM tournaments t
          LEFT JOIN auth.users u ON u.id = t.owner_id
          WHERE t.deleted_at IS NULL
          ORDER BY t.updated_at DESC
          LIMIT 20
        `;

        const tournamentsByStatus: Record<string, number> = {};
        for (const row of statusRows) {
          tournamentsByStatus[row.status] = Number(row.count);
        }

        const certificateIssuesByStatus: Record<string, number> = {};
        for (const row of certRows) {
          certificateIssuesByStatus[row.status] = Number(row.count);
        }

        const gameCardsByType: Record<string, number> = {};
        for (const row of cardRows) {
          gameCardsByType[row.card_type] = Number(row.count);
        }

        const resultEventsLast7dByRole: Record<string, number> = {};
        for (const row of eventRows) {
          resultEventsLast7dByRole[row.actor_role] = Number(row.count);
        }

        const byRouteKeyLast7d: Record<string, number> = {};
        for (const row of pvByRoute) {
          byRouteKeyLast7d[row.route_key] = Number(row.count);
        }

        const tournamentCount = Number(totalsRow?.tournaments ?? 0);
        const publicLive = Number(totalsRow?.public_live ?? 0);
        const floorTournaments = Number(totalsRow?.floor_tournaments ?? 0);
        const withCerts = Number(totalsRow?.tournaments_with_certs ?? 0);

        const overview: AdminOverview = {
          accounts: accounts.map((a) => ({
            id: a.id,
            email: a.email,
            displayName: a.display_name,
            createdAt: a.created_at,
            lastSignInAt: a.last_sign_in_at,
            tournamentCount: Number(a.tournament_count),
            participantCount: Number(a.participant_count),
            isPlatformAdmin: a.is_platform_admin,
          })),
          totals: {
            users: Number(totalsRow?.users ?? 0),
            tournaments: tournamentCount,
            tournamentsByStatus,
            publicLiveEnabled: publicLive,
            participants: Number(totalsRow?.participants ?? 0),
            games: Number(totalsRow?.games ?? 0),
            gamesPending: Number(totalsRow?.games_pending ?? 0),
            gamesFinished: Number(totalsRow?.games_finished ?? 0),
            floorTournaments,
            tournamentsWithCertificates: withCerts,
            certificateIssuesByStatus,
            gameCardsByType,
            resultEventsLast7dByRole,
          },
          adoption: {
            publicLivePct: pct(publicLive, tournamentCount),
            floorTablesPct: pct(floorTournaments, tournamentCount),
            certificatesPct: pct(withCerts, tournamentCount),
          },
          growthByWeek: growthRows.map((g) => ({
            weekStart: g.week_start,
            users: Number(g.users),
            resultEvents: Number(g.result_events),
            pageViews: Number(g.page_views),
            certificates: Number(g.certificates),
          })),
          pageViews: {
            last7d: Number(pvTotals?.last7d ?? 0),
            last30d: Number(pvTotals?.last30d ?? 0),
            byRouteKeyLast7d,
            byDayLast14d: pvByDay.map((d) => ({
              day: d.day,
              count: Number(d.count),
            })),
            topLiveHashesLast7d: topLive.map((t) => ({
              hashPrefix: t.hash_prefix,
              count: Number(t.count),
            })),
          },
          recentTournaments: recent.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            ownerEmail: t.owner_email,
            participantCount: Number(t.participant_count),
            publicEnabled: t.public_enabled,
            currentRound: t.current_round,
            createdAt: t.created_at,
            completedAt: t.completed_at,
            updatedAt: t.updated_at,
          })),
          timestampsAreUtc: true,
        };

        return overview;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Admin overview failed';
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.get(
    '/admin/fide/status',
    { preHandler: [requireAuth, requirePlatformAdmin] },
    async (_request, reply) => {
      const sql = getDatabaseSql();
      if (!sql) {
        return reply.code(503).send({ error: 'FIDE status requires DATABASE_URL' });
      }
      try {
        return await getFideImportStatus(sql);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'FIDE status failed';
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.post(
    '/admin/fide/refresh',
    { preHandler: [requireAuth, requirePlatformAdmin] },
    async (_request, reply) => {
      const sql = getDatabaseSql();
      if (!sql) {
        return reply.code(503).send({ error: 'FIDE refresh requires DATABASE_URL' });
      }
      await clearStaleFideImportLock(sql);
      if (isFideImportRunning()) {
        return reply.code(202).send({
          started: false,
          message: 'FIDE import already running',
          ...(await getFideImportStatus(sql)),
        });
      }
      const started = startFideImport(sql);
      if (!started) {
        return reply.code(202).send({
          started: false,
          message: 'FIDE import already running',
          ...(await getFideImportStatus(sql)),
        });
      }
      return reply.code(202).send({
        started: true,
        message: 'FIDE import started — poll /admin/fide/status',
        ...(await getFideImportStatus(sql)),
      });
    },
  );
};
