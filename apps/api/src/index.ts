import './sentry.js';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createStore } from './db.js';
import { authPlugin } from './auth.js';
import { tournamentsPlugin } from './routes/tournaments.js';
import { importPlugin } from './routes/import.js';
import { pairingPlugin } from './routes/pairing.js';
import { syncPlugin } from './routes/sync.js';
import { certificatesPlugin } from './routes/certificates.js';
import { publicTablesPlugin } from './routes/publicTables.js';
import { publicLivePlugin } from './routes/publicLive.js';
import { floorPlugin } from './routes/floor.js';
import { adminPlugin } from './routes/admin.js';
import { publicAnalyticsPlugin } from './routes/publicAnalytics.js';
import { Sentry, sentryEnabled } from './sentry.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024,
});

app.addHook('onRequest', async (request) => {
  if (!sentryEnabled) return;
  Sentry.setTag('route', request.routeOptions.url ?? request.url);
});

app.addHook('preHandler', async (request) => {
  if (!sentryEnabled) return;
  if (request.userId) {
    Sentry.setUser({
      id: request.userId,
      email: request.user?.email ?? undefined,
    });
  }
});

// Capture 500s only (not 401/403) — free-tier noise control
app.setErrorHandler((error, request, reply) => {
  const statusCode =
    typeof (error as { statusCode?: number }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;

  if (sentryEnabled && statusCode >= 500) {
    Sentry.captureException(error);
  }

  if (statusCode >= 500) {
    request.log.error(error);
  } else {
    request.log.info({ err: error }, 'request error');
  }

  const message =
    statusCode >= 500
      ? 'Internal Server Error'
      : error instanceof Error
        ? error.message
        : 'Request failed';

  void reply.code(statusCode).send({
    error: message,
    message,
  });
});

const store = createStore();

await app.register(cors, { origin: true });

await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

await app.register(authPlugin);
await app.register(tournamentsPlugin, { store });
await app.register(importPlugin, { store });
await app.register(pairingPlugin, { store });
await app.register(syncPlugin, { store });
await app.register(certificatesPlugin, { store });
await app.register(publicTablesPlugin, { store });
await app.register(publicLivePlugin, { store });
await app.register(floorPlugin, { store });
await app.register(adminPlugin);
await app.register(publicAnalyticsPlugin);

app.get('/health', async () => {
  const mode = process.env['DATABASE_URL'] ? 'postgres' : 'memory';
  const storage =
    process.env['SUPABASE_URL'] &&
    (process.env['SUPABASE_SECRET_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'])
      ? 'supabase'
      : 'local';
  const auth =
    process.env['AUTH_DISABLED'] === '1'
      ? 'disabled'
      : process.env['SUPABASE_URL']
        ? 'enabled'
        : 'disabled';
  return { ok: true, mode, storage, auth, sentry: sentryEnabled };
});

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    if (sentryEnabled) Sentry.captureException(err);
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`chess-alokas api listening at ${address}`);
});
