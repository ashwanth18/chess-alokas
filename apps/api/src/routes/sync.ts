import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { SyncPushRequestSchema } from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const syncPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  app.get<{ Querystring: { since?: string } }>(
    '/sync/pull',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { since } = request.query;
      if (!since) {
        return reply.code(400).send({ error: 'Missing required query param: since' });
      }
      if (isNaN(Date.parse(since))) {
        return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
      }
      const data = await store.pullSince(since, request.userId ?? null);
      return { ...data, serverTime: new Date().toISOString() };
    },
  );

  app.post<{ Body: unknown }>(
    '/sync/push',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = SyncPushRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      try {
        await store.pushSync(parsed.data.items, request.userId ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync push failed';
        const status =
          err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
            ? err.statusCode
            : 500;
        return reply.code(status).send({ error: message, message });
      }
      return reply.code(200).send({
        accepted: parsed.data.items.length,
        serverTime: new Date().toISOString(),
      });
    },
  );

  app.get<{ Querystring: { since?: string } }>(
    '/sync',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { since } = request.query;
      if (!since) {
        return reply.code(400).send({ error: 'Missing required query param: since' });
      }
      if (isNaN(Date.parse(since))) {
        return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
      }
      const data = await store.pullSince(since, request.userId ?? null);
      return { ...data, serverTime: new Date().toISOString() };
    },
  );

  app.post<{ Body: unknown }>('/sync', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = SyncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    await store.pushSync(parsed.data.items, request.userId ?? null);
    return reply.code(200).send({
      accepted: parsed.data.items.length,
      serverTime: new Date().toISOString(),
    });
  });
};
