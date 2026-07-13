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

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024,
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
  return { ok: true, mode, storage, auth };
});

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`chess-alokas api listening at ${address}`);
});
