import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createStore } from './db.js';
import { tournamentsPlugin } from './routes/tournaments.js';
import { importPlugin } from './routes/import.js';
import { pairingPlugin } from './routes/pairing.js';
import { syncPlugin } from './routes/sync.js';

const PORT = 3001;

const app = Fastify({ logger: true });

const store = createStore();

await app.register(cors, { origin: true });

await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
});

// Route plugins
await app.register(tournamentsPlugin, { store });
await app.register(importPlugin, { store });
await app.register(pairingPlugin, { store });
await app.register(syncPlugin, { store });

// Health check
app.get('/health', async () => {
  const mode = process.env['DATABASE_URL'] ? 'postgres' : 'memory';
  return { ok: true, mode };
});

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`chess-alokas api listening at ${address}`);
});
