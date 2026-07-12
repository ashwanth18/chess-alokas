import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { SyncPushRequestSchema } from '@chess-alokas/shared';
import type { Store } from '../db.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const syncPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  // -------------------------------------------------------------------------
  // GET /sync/pull?since=<ISO datetime>
  // Returns all entities (including soft-deleted) updated after `since`.
  // -------------------------------------------------------------------------
  app.get<{ Querystring: { since?: string } }>('/sync/pull', async (request, reply) => {
    const { since } = request.query;
    if (!since) {
      return reply.code(400).send({ error: 'Missing required query param: since' });
    }

    const sinceMs = Date.parse(since);
    if (isNaN(sinceMs)) {
      return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
    }

    const data = await store.pullSince(since);
    return {
      ...data,
      serverTime: new Date().toISOString(),
    };
  });

  // -------------------------------------------------------------------------
  // POST /sync/push
  // Body: SyncPushRequestSchema – apply LWW upserts for all items.
  // -------------------------------------------------------------------------
  app.post<{ Body: unknown }>('/sync/push', async (request, reply) => {
    const parsed = SyncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    try {
      await store.pushSync(parsed.data.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync push failed';
      const status =
        err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
          ? err.statusCode
          : 500;
      return reply.code(status).send({ error: message, message });
    }
    const serverTime = new Date().toISOString();
    return reply.code(200).send({
      accepted: parsed.data.items.length,
      serverTime,
    });
  });

  // Legacy aliases (older clients / README)
  app.get<{ Querystring: { since?: string } }>('/sync', async (request, reply) => {
    const { since } = request.query;
    if (!since) {
      return reply.code(400).send({ error: 'Missing required query param: since' });
    }
    const sinceMs = Date.parse(since);
    if (isNaN(sinceMs)) {
      return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
    }
    const data = await store.pullSince(since);
    return { ...data, serverTime: new Date().toISOString() };
  });

  app.post<{ Body: unknown }>('/sync', async (request, reply) => {
    const parsed = SyncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    await store.pushSync(parsed.data.items);
    return reply.code(200).send({
      accepted: parsed.data.items.length,
      serverTime: new Date().toISOString(),
    });
  });
};
