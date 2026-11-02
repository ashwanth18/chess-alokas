/** The admin dashboard counts results people entered. Undoing a round logs rows, but enters none. */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './db.js';
import { adminPlugin } from './routes/admin.js';

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
    encrypted_password text,
    last_sign_in_at timestamptz,
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

describe('admin result-event numbers', () => {
  let sql: Sql;
  let app: FastifyInstance;
  let close: () => Promise<void>;

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
    app = Fastify();
    await app.register(adminPlugin);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await close?.();
    delete process.env['DATABASE_URL'];
  });

  async function counts() {
    const res = await app.inject({ method: 'GET', url: '/admin/overview' });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as {
      totals: { resultEventsLast7dByRole: Record<string, number> };
      growthByWeek: Array<{ resultEvents: number }>;
    };
    return {
      director: body.totals.resultEventsLast7dByRole['director'] ?? 0,
      thisWeek: body.growthByWeek.at(-1)?.resultEvents ?? 0,
    };
  }

  it('counts corrections, even one whose reason reads like an undo, and leaves out undone rounds', async () => {
    const store = new PostgresStore(sql);
    const owner = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${owner}, 'owner@example.com')`;
    const tournament = crypto.randomUUID();
    const category = crypto.randomUUID();
    const game = crypto.randomUUID();
    const pending = crypto.randomUUID();
    await sql`
      INSERT INTO tournaments (id, name, style, rounds, status, owner_id, confirmed_rounds, current_round)
      VALUES (${tournament}, 'Harbour Open', 'swiss', 5, 'in_progress', ${owner}, 1, 2)
    `;
    await sql`
      INSERT INTO categories (id, tournament_id, name, filter)
      VALUES (${category}, ${tournament}, 'Open', '{"logic":"and","rules":[]}')
    `;
    await sql`
      INSERT INTO games (id, tournament_id, category_id, round, board, result) VALUES
        (${game}, ${tournament}, ${category}, 1, 1, '1-0'),
        (${pending}, ${tournament}, ${category}, 2, 1, 'pending')
    `;
    const start = await counts();

    const pushed = await store.pushSync(
      [
        {
          entity: 'game',
          id: game,
          payload: {
            tournamentId: tournament,
            categoryId: category,
            round: 1,
            board: 1,
            result: '0-1',
            isBye: false,
            corrections: [
              {
                id: crypto.randomUUID(),
                previousResult: '1-0',
                result: '0-1',
                reason: 'Round 1 undone by mistake at the desk',
                at: new Date().toISOString(),
              },
            ],
          },
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
      ],
      owner,
    );
    expect(pushed.rejected).toEqual([]);
    const corrected = await counts();
    expect(corrected.director).toBe(start.director + 1);
    expect(corrected.thisWeek).toBe(start.thisWeek + 1);

    await store.undoRound(tournament, 2, { actorUserId: owner, actorName: 'Dee', reason: 'Round 1 corrected' });
    const logged = await sql`SELECT 1 FROM game_result_events WHERE game_id = ${pending}`;
    expect(logged).toHaveLength(1);
    expect(await counts()).toEqual(corrected);
  });
});
