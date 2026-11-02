/** Admin metrics and page views with a demo tenant present: only real data counts. */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../db.js';
import { adminPlugin } from '../routes/admin.js';
import { publicAnalyticsPlugin } from '../routes/publicAnalytics.js';
import { DEMO_LINKS } from './plan.js';
import { demoSeed, type DemoRunContext } from './runner.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    encrypted_password text,
    last_sign_in_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select current_setting('request.jwt.claims', true)::jsonb->>'role'
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function auth.role() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

describe('admin overview and analytics', () => {
  let sql: Sql;
  let app: FastifyInstance;
  let close: () => Promise<void>;
  const realUser = randomUUID();
  const realTournament = randomUUID();
  const realParticipant = randomUUID();

  beforeAll(async () => {
    process.env['AUTH_DISABLED'] = '1';
    const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
    await db.exec(SUPABASE_STUB);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    }
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const free = typeof address === 'object' && address ? address.port : 0;
        probe.close(() => resolve(free));
      });
    });
    const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 5 });
    await server.start();
    const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    // getDatabaseSql reads this the first time it is used.
    process.env['DATABASE_URL'] = url;
    sql = postgres(url, { max: 1, prepare: false, ssl: false, onnotice: () => undefined });
    close = async () => {
      await sql.end({ timeout: 1 });
      await server.stop();
      await db.close();
    };

    await sql`INSERT INTO auth.users (id, email) VALUES (${realUser}, 'real@example.com')`;
    await sql`
      INSERT INTO tournaments (id, name, style, rounds, status, owner_id, updated_at, public_enabled, public_token)
      VALUES (${realTournament}, 'Real Open', 'swiss', 5, 'ready', ${realUser}, now(), true, 'real-live-token')
    `;
    await sql`
      INSERT INTO participants (id, tournament_id, name, age, updated_at)
      VALUES (${realParticipant}, ${realTournament}, 'Real Player', 10, now())
    `;

    const store = new PostgresStore(sql);
    const users = new Map<string, string>();
    const ctx: DemoRunContext = {
      ops: store.demo(),
      auth: {
        findUserIdByEmail: async (email) => users.get(email) ?? null,
        createUser: async ({ email }) => {
          const id = randomUUID();
          users.set(email, id);
          await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${email})`;
          return { id };
        },
        updatePassword: async () => undefined,
        deleteUser: async () => undefined,
      },
      files: {
        saveReceipt: async (t, r) => `${t}/${r}.png`,
        saveCertificate: async (t, i) => `${t}/${i}.pdf`,
        deleteReceipt: async () => undefined,
        deleteCertificate: async () => undefined,
      },
      env: {
        DEMO_STAFF_PASSWORD: 'test-staff-password',
        DEMO_PLAYER_PASSWORD: 'test-player-password',
      } as NodeJS.ProcessEnv,
      log: () => undefined,
      style: 'swiss',
    };
    await demoSeed(ctx);

    app = Fastify();
    await app.register(adminPlugin);
    await app.register(publicAnalyticsPlugin, { store });
    // The overview also asks GitHub for download counts, which isn't under test.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env['DATABASE_URL'];
    await app?.close();
    await close?.();
  });

  it('counts only real people and tournaments', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/overview', headers: { 'x-test-admin': '1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts.map((a: { email: string }) => a.email)).toEqual(['real@example.com']);
    expect(body.totals.users).toBe(1);
    expect(body.totals.tournaments).toBe(1);
    expect(body.totals.participants).toBe(1);
    expect(body.totals.games).toBe(0);
    expect(body.totals.publicLiveEnabled).toBe(1);
    expect(body.totals.tournamentsWithCertificates).toBe(0);
    expect(body.totals.certificateIssuesByStatus).toEqual({});
    expect(body.totals.gameCardsByType).toEqual({});
    expect(body.totals.resultEventsLast7dByRole).toEqual({});
    expect(body.recentTournaments.map((t: { name: string }) => t.name)).toEqual(['Real Open']);
    const week = body.growthByWeek.reduce(
      (sum: { users: number; events: number }, w: { users: number; resultEvents: number }) => ({
        users: sum.users + w.users,
        events: sum.events + w.resultEvents,
      }),
      { users: 0, events: 0 },
    );
    expect(week).toEqual({ users: 1, events: 0 });
  });

  it('page views of demo pages are not recorded, and real ones are', async () => {
    const view = (payload: object) =>
      app.inject({ method: 'POST', url: '/public/analytics/pageview', payload });
    const count = async () =>
      Number((await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM page_views`)[0]!.n);
    expect(await count()).toBe(0);

    await view({ path: '/live/x', routeKey: 'live', liveToken: DEMO_LINKS.liveToken });
    await view({ path: `/register/${DEMO_LINKS.slugs.kualaLumpur}`, routeKey: 'event_register' });
    await view({ path: '/discover?demo=1', routeKey: 'discover' });
    expect(await count()).toBe(0);

    await view({ path: '/live/real-live-token', routeKey: 'live', liveToken: 'real-live-token' });
    await view({ path: '/discover', routeKey: 'discover' });
    expect(await count()).toBe(2);
  });
});
