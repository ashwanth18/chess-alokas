import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';
import { generateArbiterPin, hashArbiterPin } from '../floor/pin.js';

type Opts = { store: Store };

async function assertOwner(
  store: Store,
  tournamentId: string,
  userId: string | undefined,
  reply: FastifyReply,
): Promise<boolean> {
  if (!userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  const ok = await store.isTournamentOwnedBy(tournamentId, userId);
  if (!ok) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export const floorPlugin: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { store } = opts;

  app.get<{ Params: { id: string } }>(
    '/tournaments/:id/floor/tables',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const tables = await store.listTables(id);
      const tournament = await store.getTournament(id);
      return {
        tables,
        tableCount: tournament?.tableCount ?? tables.length,
        arbiterPinRound: tournament?.arbiterPinRound ?? null,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/floor/prepare',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;

      const parsed = z
        .object({
          tableCount: z.number().int().positive().max(500),
          pinRound: z.number().int().positive(),
          rotatePin: z.boolean().default(true),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }

      try {
        const tournament = await store.getTournament(id);
        if (!tournament || tournament.deletedAt) {
          return reply.code(404).send({ error: 'Tournament not found' });
        }

        const tables = await store.ensureTables(id, parsed.data.tableCount);
        let arbiterPin: string | null = null;
        let arbiterPinRound = tournament.arbiterPinRound ?? null;

        if (parsed.data.rotatePin) {
          arbiterPin = generateArbiterPin();
          arbiterPinRound = parsed.data.pinRound;
          await store.setArbiterPin(id, hashArbiterPin(arbiterPin), arbiterPinRound);
        }

        return {
          tables,
          tableCount: Math.max(parsed.data.tableCount, tables.length),
          arbiterPin,
          arbiterPinRound,
        };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: err instanceof Error ? err.message : 'Floor prepare failed',
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/floor/rotate-pin',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;

      const parsed = z
        .object({ pinRound: z.number().int().positive() })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'pinRound required' });
      }

      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }

      const arbiterPin = generateArbiterPin();
      await store.setArbiterPin(id, hashArbiterPin(arbiterPin), parsed.data.pinRound);
      return { arbiterPin, arbiterPinRound: parsed.data.pinRound };
    },
  );
};
