import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { SyncPushRequestSchema } from '@chess-alokas/shared';
import type { Store } from '../db.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const syncPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  // -------------------------------------------------------------------------
  // GET /sync?since=<ISO datetime>
  // Returns all entities (including soft-deleted) updated after `since`.
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { since?: string } }>('/sync', async (request, reply) => {
    const { since } = request.query;
    if (!since) {
      return reply.code(400).send({ error: 'Missing required query param: since' });
    }

    // Validate that `since` is a parseable date
    const sinceMs = Date.parse(since);
    if (isNaN(sinceMs)) {
      return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
    }

    return store.pullSince(since);
  });

  // -------------------------------------------------------------------------
  // POST /sync
  // Body: SyncPushRequestSchema – apply LWW upserts for all items.
  // -------------------------------------------------------------------------
  app.post<{ Body: unknown }>('/sync', async (request, reply) => {
    const parsed = SyncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    await store.pushSync(parsed.data.items);
    return reply.code(200).send({ ok: true, applied: parsed.data.items.length });
  });
};
