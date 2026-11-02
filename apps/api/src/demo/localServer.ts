/**
 * The demo tenant with no cloud at all: PGlite with the real migrations, and a small stand-in for
 * Supabase's sign-in, admin and storage endpoints. For trying the demo commands and the web app on
 * this computer. It is not Supabase, so it proves nothing about Supabase's own behaviour.
 *
 *   pnpm --filter @chess-alokas/api exec tsx src/demo/localServer.ts [--production-schema]
 *
 * --production-schema applies migrations through 032, then 036 alone.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres from 'postgres';

const PG_PORT = Number(process.env['DEMO_LOCAL_PG_PORT'] ?? 55433);
const AUTH_PORT = Number(process.env['DEMO_LOCAL_AUTH_PORT'] ?? 54331);
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
    phone text,
    email_change text default '',
    phone_change text default '',
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb
  );
  create table auth.sessions (
    id uuid primary key,
    user_id uuid references auth.users(id) on delete cascade,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    refreshed_at timestamptz,
    user_agent text,
    ip text
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

interface UserRow {
  id: string;
  email: string;
  encrypted_password: string | null;
  raw_user_meta_data: Record<string, unknown>;
  raw_app_meta_data: Record<string, unknown>;
}

const productionSchema = process.argv.includes('--production-schema');

const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
await db.exec(SUPABASE_STUB);
for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (productionSchema && !(file <= '032_z' || file.startsWith('036_'))) continue;
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}
const pgServer = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1', maxConnections: 30 });
await pgServer.start();
const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, {
  max: 1,
  prepare: false,
  ssl: false,
  onnotice: () => undefined,
});

const storage = new Map<string, { contentType: string; bytes: Buffer }>();

function userJson(u: UserRow) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    app_metadata: u.raw_app_meta_data ?? {},
    user_metadata: u.raw_user_meta_data ?? {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    identities: [],
  };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sessionFor(u: UserRow) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sessionId = randomUUID();
  const token = `${base64url({ alg: 'none' })}.${base64url({ sub: u.id, exp, session_id: sessionId, email: u.email, role: 'authenticated' })}.local`;
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${u.id}`,
    user: userJson(u),
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function userFromToken(req: IncomingMessage): Promise<UserRow | null> {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub?: string };
    if (!payload.sub) return null;
    const [row] = await sql<UserRow[]>`SELECT * FROM auth.users WHERE id = ${payload.sub}`;
    return row ?? null;
  } catch {
    return null;
  }
}

const authServer = createServer((req, res) => {
  void handle(req, res).catch((err: Error) => {
    send(res, 500, { message: `Database error: ${err.message}`, msg: err.message });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${AUTH_PORT}`);
  const route = url.pathname;
  const raw = await readBody(req);
  const json = (): Record<string, unknown> => {
    try {
      return JSON.parse(raw.toString() || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  if (route === '/auth/v1/admin/users' && req.method === 'GET') {
    const rows = await sql<UserRow[]>`SELECT * FROM auth.users ORDER BY email`;
    return send(res, 200, { users: rows.map(userJson), aud: 'authenticated' });
  }
  if (route === '/auth/v1/admin/users' && req.method === 'POST') {
    const body = json();
    if (body['email_confirm'] !== true) return send(res, 400, { msg: 'stub expects email_confirm' });
    const id = randomUUID();
    await sql`
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
      VALUES (${id}, ${String(body['email'])}, ${String(body['password'])}, now(),
              ${sql.json((body['user_metadata'] ?? {}) as never)}, ${sql.json((body['app_metadata'] ?? {}) as never)})
    `;
    const [row] = await sql<UserRow[]>`SELECT * FROM auth.users WHERE id = ${id}`;
    return send(res, 200, userJson(row!));
  }
  const adminMatch = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(route);
  if (adminMatch && req.method === 'PUT') {
    await sql`UPDATE auth.users SET encrypted_password = ${String(json()['password'])} WHERE id = ${adminMatch[1]!}`;
    const [row] = await sql<UserRow[]>`SELECT * FROM auth.users WHERE id = ${adminMatch[1]!}`;
    return send(res, 200, userJson(row!));
  }
  if (adminMatch && req.method === 'DELETE') {
    await sql`DELETE FROM auth.users WHERE id = ${adminMatch[1]!}`;
    return send(res, 200, {});
  }
  if (route === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    const body = json();
    if (grant === 'refresh_token') {
      const id = String(body['refresh_token']).replace('refresh-', '');
      const [row] = await sql<UserRow[]>`SELECT * FROM auth.users WHERE id = ${id}`;
      return row ? send(res, 200, sessionFor(row)) : send(res, 400, { msg: 'Invalid refresh token' });
    }
    const [row] = await sql<UserRow[]>`SELECT * FROM auth.users WHERE email = ${String(body['email'])}`;
    if (!row || row.encrypted_password !== body['password']) {
      return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    return send(res, 200, sessionFor(row));
  }
  if (route === '/auth/v1/user') {
    const user = await userFromToken(req);
    if (!user) return send(res, 401, { msg: 'invalid token' });
    if (req.method === 'PUT') {
      const body = json();
      if (body['password']) {
        await sql`UPDATE auth.users SET encrypted_password = ${String(body['password'])} WHERE id = ${user.id}`;
      }
      if (body['email']) {
        await sql`UPDATE auth.users SET email_change = ${String(body['email'])} WHERE id = ${user.id}`;
      }
    }
    return send(res, 200, userJson(user));
  }
  if (route === '/auth/v1/logout') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (route.startsWith('/rest/v1/profiles')) {
    const user = await userFromToken(req);
    const [row] = user
      ? await sql`SELECT display_name, is_platform_admin FROM profiles WHERE id = ${user.id}`
      : [];
    return send(res, 200, row ? [row] : []);
  }
  if (route.startsWith('/rest/v1/')) return send(res, 200, []);

  const bucketMatch = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(route);
  if (bucketMatch) return send(res, 200, { id: bucketMatch[1], name: bucketMatch[1] });
  const objectMatch = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(route);
  if (objectMatch && (req.method === 'POST' || req.method === 'PUT')) {
    // The client sends multipart form data, which isn't worth parsing here: the bytes are enough
    // for counting, and a local download serves whatever arrived.
    storage.set(`${objectMatch[1]}/${objectMatch[2]}`, {
      contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
      bytes: raw,
    });
    return send(res, 200, { Key: objectMatch[2] });
  }
  if (objectMatch && req.method === 'GET') {
    const found = storage.get(`${objectMatch[1]}/${objectMatch[2]}`);
    if (!found) return send(res, 404, { message: 'Object not found' });
    res.writeHead(200, { 'Content-Type': found.contentType });
    res.end(found.bytes);
    return;
  }
  const removeMatch = /^\/storage\/v1\/object\/([^/]+)$/.exec(route);
  if (removeMatch && req.method === 'DELETE') {
    const prefixes = (json()['prefixes'] ?? []) as string[];
    for (const prefix of prefixes) storage.delete(`${removeMatch[1]}/${prefix}`);
    return send(res, 200, []);
  }
  if (route === '/__stub/storage') return send(res, 200, { objects: storage.size });
  send(res, 404, { msg: `stub: no route ${req.method} ${route}` });
}

authServer.listen(AUTH_PORT, '127.0.0.1', () => {
  console.log(`READY schema=${productionSchema ? 'through-032+036' : 'all'}`);
  console.log(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`);
  console.log(`SUPABASE_URL=http://127.0.0.1:${AUTH_PORT}`);
  console.log('SUPABASE_SECRET_KEY=local-stub  (a placeholder: this stand-in checks no keys)');
});
