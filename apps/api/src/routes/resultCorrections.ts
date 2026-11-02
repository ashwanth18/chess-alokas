import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';

type Opts = { store: Store };

/**
 * The history of a result, and undoing the newest round. Corrections themselves travel through
 * POST /sync/push, online or offline, so there is one set of rules for them: see syncEngine.ts.
 * Directors, admins and owners only. Arbiters and floor sessions get nothing here.
 */
export const resultCorrectionsPlugin: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { store } = opts;

  /** No user id means local demo mode, as in routes/tournaments.ts. requireAuth rejects it otherwise. */
  async function assertManager(
    tournamentId: string,
    userId: string | undefined,
    reply: FastifyReply,
  ): Promise<boolean> {
    if (!userId || (await store.isTournamentOwnedBy(tournamentId, userId))) return true;
    await reply.code(403).send({ error: 'Forbidden' });
    return false;
  }

  app.get<{ Params: { id: string } }>(
    '/games/:id/history',
    { preHandler: requireAuth },
    async (request, reply) => {
      const game = await store.getGame(request.params.id);
      if (!game) return reply.code(404).send({ error: 'Game not found' });
      if (!(await assertManager(game.tournamentId, request.userId, reply))) return;
      return { events: await store.listGameResultEvents(game.id) };
    },
  );

  const UndoBodySchema = z.object({
    reason: z.string().trim().max(200).optional(),
    actorName: z.string().trim().max(80).optional(),
  });

  app.post<{ Params: { id: string; round: string }; Body: unknown }>(
    '/tournaments/:id/rounds/:round/undo',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if (!(await assertManager(id, request.userId, reply))) return;

      const round = Number(request.params.round);
      const parsed = UndoBodySchema.safeParse(request.body ?? {});
      if (!Number.isInteger(round) || round < 1 || !parsed.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }
      return store.undoRound(id, round, {
        actorUserId: request.userId ?? null,
        actorName: parsed.data.actorName || 'Director',
        reason: parsed.data.reason,
      });
    },
  );
};
