import type { FastifyPluginAsync, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { SyncPushRequestSchema } from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const syncPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  async function handlePull(
    request: FastifyRequest<{ Querystring: { since?: string } }>,
    reply: FastifyReply,
  ) {
    const { since } = request.query;
    if (!since) {
      return reply.code(400).send({ error: 'Missing required query param: since' });
    }
    if (isNaN(Date.parse(since))) {
      return reply.code(400).send({ error: '"since" must be a valid ISO datetime string' });
    }
    const data = await store.pullSince(since, request.userId ?? null);
    return { ...data, serverTime: new Date().toISOString() };
  }

  async function handlePush(request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
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
  }

  // '/sync/pull' + '/sync/push' are current; '/sync' (GET/POST) is kept as an
  // alias for older clients. Both names share one handler each so a fix
  // (like the push error-status mapping above) can't drift between them.
  app.get<{ Querystring: { since?: string } }>(
    '/sync/pull',
    { preHandler: requireAuth },
    handlePull,
  );
  app.post<{ Body: unknown }>('/sync/push', { preHandler: requireAuth }, handlePush);
  app.get<{ Querystring: { since?: string } }>('/sync', { preHandler: requireAuth }, handlePull);
  app.post<{ Body: unknown }>('/sync', { preHandler: requireAuth }, handlePush);
};
