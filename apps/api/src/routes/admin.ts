import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseSql, requireAuth, requirePlatformAdmin } from '../auth.js';

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
    certificateIssuesByStatus: Record<string, number>;
    gameCardsByType: Record<string, number>;
    resultEventsLast7dByRole: Record<string, number>;
  };
  recentTournaments: Array<{
    id: string;
    name: string;
    status: string;
    ownerEmail: string | null;
    participantCount: number;
    publicEnabled: boolean;
    currentRound: number;
    updatedAt: string;
  }>;
};

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
            ) AS floor_tournaments
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

        const recent = await sql<
          {
            id: string;
            name: string;
            status: string;
            owner_email: string | null;
            participant_count: string;
            public_enabled: boolean;
            current_round: number;
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
            tournaments: Number(totalsRow?.tournaments ?? 0),
            tournamentsByStatus,
            publicLiveEnabled: Number(totalsRow?.public_live ?? 0),
            participants: Number(totalsRow?.participants ?? 0),
            games: Number(totalsRow?.games ?? 0),
            gamesPending: Number(totalsRow?.games_pending ?? 0),
            gamesFinished: Number(totalsRow?.games_finished ?? 0),
            floorTournaments: Number(totalsRow?.floor_tournaments ?? 0),
            certificateIssuesByStatus,
            gameCardsByType,
            resultEventsLast7dByRole,
          },
          recentTournaments: recent.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            ownerEmail: t.owner_email,
            participantCount: Number(t.participant_count),
            publicEnabled: t.public_enabled,
            currentRound: t.current_round,
            updatedAt: t.updated_at,
          })),
        };

        return overview;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Admin overview failed';
        return reply.code(500).send({ error: message });
      }
    },
  );
};
