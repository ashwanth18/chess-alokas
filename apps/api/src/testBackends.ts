/**
 * Test support: every API route over MemoryStore, or over the real PostgresStore on PGlite with the
 * whole migration chain applied. Not imported by the server.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multipart from '@fastify/multipart';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Organization, Tournament } from '@chess-alokas/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { authPlugin } from './auth.js';
import {
  MemoryCertificateIssueStore,
  PostgresCertificateIssueStore,
  type CertificateIssueStore,
} from './certificates/store.js';
import { MemoryStore, PostgresStore, type Store } from './db.js';
import { certificatesPlugin } from './routes/certificates.js';
import { floorPlugin } from './routes/floor.js';
import { importPlugin } from './routes/import.js';
import { organizationsPlugin } from './routes/organizations.js';
import { pairingPlugin } from './routes/pairing.js';
import { playerProfilesPlugin } from './routes/playerProfiles.js';
import { publicLivePlugin } from './routes/publicLive.js';
import { publicTablesPlugin } from './routes/publicTables.js';
import { registrationsPlugin } from './routes/registrations.js';
import { resultCorrectionsPlugin } from './routes/resultCorrections.js';
import { syncPlugin } from './routes/sync.js';
import { teamPlugin } from './routes/team.js';
import { tournamentsPlugin } from './routes/tournaments.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

export interface TestBackend {
  store: Store;
  certs: CertificateIssueStore;
  addUser(id: string): Promise<void>;
  addMember(organizationId: string, userId: string, role: string): Promise<void>;
  close(): Promise<void>;
}

export async function memoryBackend(): Promise<TestBackend> {
  const store = new MemoryStore();
  const members = (store as unknown as { organizationMembers: Map<string, unknown> })
    .organizationMembers;
  return {
    store,
    certs: new MemoryCertificateIssueStore(),
    addUser: async () => undefined,
    addMember: async (organizationId, userId, role) => {
      members.set(`${organizationId}:${userId}`, {
        organizationId,
        userId,
        role,
        createdAt: new Date().toISOString(),
      });
    },
    close: async () => undefined,
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function postgresBackend(): Promise<TestBackend> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const sql: Sql = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, {
    max: 1,
    prepare: false,
    ssl: false,
    onnotice: () => undefined,
  });
  return {
    store: new PostgresStore(sql),
    certs: new PostgresCertificateIssueStore(sql),
    addUser: async (id) => {
      await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${`${id}@example.com`})`;
    },
    addMember: async (organizationId, userId, role) => {
      await sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (${organizationId}, ${userId}, ${role})
      `;
    },
    close: async () => {
      await sql.end({ timeout: 1 });
      await server.stop();
      await db.close();
    },
  };
}

export const TEST_STORES = [
  ['MemoryStore', memoryBackend],
  ['PostgresStore', postgresBackend],
] as const;

export interface TestApp {
  app: FastifyInstance;
  /** Every route the server registered, for sweeps that must not miss a new one. */
  routes: Array<{ method: string; url: string }>;
  call(
    user: string | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any }>;
  newUser(): Promise<string>;
  verifiedOrg(owner: string): Promise<Organization>;
  seedTournament(owner: string, organizationId: string, extra?: Partial<Tournament>): Promise<Tournament>;
  close(): Promise<void>;
}

export async function buildTestApp(backend: TestBackend): Promise<TestApp> {
  process.env['AUTH_DISABLED'] = '1';
  const certDir = mkdtempSync(path.join(tmpdir(), 'chess-alokas-sweep-'));
  process.env['CERTIFICATES_DIR'] = certDir;
  process.env['RECEIPTS_DIR'] = path.join(certDir, 'receipts');
  delete process.env['RESEND_API_KEY'];

  const { store } = backend;
  const app = Fastify();
  const routes: TestApp['routes'] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && method !== 'OPTIONS') routes.push({ method, url: route.url });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    void reply.code(statusCode).send({ error: (error as Error).message });
  });
  await app.register(multipart);
  await app.register(tournamentsPlugin, { store });
  await app.register(importPlugin, { store });
  await app.register(pairingPlugin, { store });
  await app.register(resultCorrectionsPlugin, { store });
  await app.register(syncPlugin, { store });
  await app.register(certificatesPlugin, { store, certificateStore: backend.certs });
  await app.register(publicTablesPlugin, { store });
  await app.register(publicLivePlugin, { store });
  await app.register(floorPlugin, { store });
  await app.register(organizationsPlugin, { store });
  await app.register(authPlugin, { store, deleteAuthUser: async () => ({}) });
  await app.register(teamPlugin, { store });
  await app.register(playerProfilesPlugin, { store });
  await app.register(registrationsPlugin, { store });

  const call: TestApp['call'] = async (user, method, url, payload, headers = {}) => {
    const res = await app.inject({
      method,
      url,
      payload: payload as never,
      headers: { ...(user ? { 'x-test-user-id': user } : {}), ...headers },
    });
    let body: unknown = res.body;
    try {
      body = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body };
  };

  return {
    app,
    routes,
    call,
    newUser: async () => {
      const id = crypto.randomUUID();
      await backend.addUser(id);
      return id;
    },
    verifiedOrg: async (owner) => {
      const res = await call(owner, 'POST', '/organizations', {
        name: `Org ${crypto.randomUUID()}`,
      });
      if (res.status !== 201) throw new Error(`Could not create an organization: ${res.status}`);
      const updated = await store.adminUpdateOrganization(res.body.organization.id, {
        verificationStatus: 'verified',
        planTier: 'pro',
        maxTournamentsQuota: null,
        maxPlayersPerTournament: null,
        canPublishGlobal: true,
        canAcceptPaidRegistrations: true,
      });
      return updated!;
    },
    seedTournament: (owner, organizationId, extra = {}) =>
      store.createTournament({
        id: crypto.randomUUID(),
        name: 'Seeded',
        style: 'swiss',
        rounds: 5,
        status: 'in_progress',
        currentRound: 1,
        confirmedRounds: 0,
        mixCategories: false,
        prizePlaces: 3,
        awardScope: 'per_category',
        sharedPlaces: true,
        tableCount: 0,
        publicEnabled: false,
        ownerId: owner,
        organizationId,
        updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        ...extra,
      }),
    close: async () => {
      await app.close();
      rmSync(certDir, { recursive: true, force: true });
    },
  };
}
