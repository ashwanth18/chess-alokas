import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import postgres, { type Sql } from 'postgres';
import type { Store } from './db.js';
import { purgeAfterFrom } from './lib/privacyPurge.js';
import { DEMO_ACCOUNT_LOCKED_MESSAGE } from './demo/constants.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    user?: User;
    /** Lowercased email, set only when Supabase says the address is confirmed. */
    confirmedEmail?: string | null;
  }
}

let supabaseAuth: SupabaseClient | null = null;
let sessionsSql: Sql | null | undefined;

export function authEnabled(): boolean {
  if (process.env['AUTH_DISABLED'] === '1') return false;
  return Boolean(process.env['SUPABASE_URL'] && getSupabaseAnonOrSecret());
}

/** Test identities are honoured only in explicit demo mode, and never in production. */
function testIdentityAllowed(): boolean {
  return process.env['AUTH_DISABLED'] === '1' && process.env['NODE_ENV'] !== 'production';
}

/**
 * Production must verify real JWTs. Without this check a missing env var would quietly
 * turn every route public. The desktop sidecar and `pnpm dev` don't set NODE_ENV=production.
 */
export function assertAuthConfiguredForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] !== 'production') return;
  if (env['AUTH_DISABLED'] === '1') {
    throw new Error('Refusing to start: AUTH_DISABLED=1 is not allowed when NODE_ENV=production.');
  }
  const key =
    env['SUPABASE_ANON_KEY'] ||
    env['SUPABASE_PUBLISHABLE_KEY'] ||
    env['SUPABASE_SECRET_KEY'] ||
    env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!env['SUPABASE_URL'] || !key) {
    throw new Error(
      'Refusing to start: SUPABASE_URL and a Supabase key are required when NODE_ENV=production.',
    );
  }
}

function applyTestIdentity(request: FastifyRequest): void {
  if (!testIdentityAllowed()) return;
  const testUserId = request.headers['x-test-user-id'];
  if (typeof testUserId === 'string' && testUserId.trim()) {
    request.userId = testUserId.trim();
  }
  const testEmail = request.headers['x-test-user-email'];
  if (typeof testEmail === 'string' && testEmail.trim()) {
    request.confirmedEmail = testEmail.trim().toLowerCase();
  }
}

/** Fails closed: no confirmation timestamp from Supabase means no confirmed email. */
export function confirmedEmailOf(user: Pick<User, 'email' | 'email_confirmed_at'>): string | null {
  if (!user.email || !user.email_confirmed_at) return null;
  return user.email.trim().toLowerCase() || null;
}

function getSupabaseAnonOrSecret(): string | undefined {
  return (
    process.env['SUPABASE_ANON_KEY'] ||
    process.env['SUPABASE_PUBLISHABLE_KEY'] ||
    process.env['SUPABASE_SECRET_KEY'] ||
    process.env['SUPABASE_SERVICE_ROLE_KEY']
  );
}

function getAuthClient(): SupabaseClient | null {
  const url = process.env['SUPABASE_URL'];
  const key = getSupabaseAnonOrSecret();
  if (!url || !key) return null;
  if (!supabaseAuth) {
    supabaseAuth = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAuth;
}

export function getServiceSupabase(): SupabaseClient | null {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SECRET_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getDatabaseSql(): Sql | null {
  if (sessionsSql !== undefined) return sessionsSql;
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    sessionsSql = null;
    return null;
  }
  sessionsSql = postgres(dbUrl, { max: 2, prepare: false });
  return sessionsSql;
}

function getSessionsSql(): Sql | null {
  return getDatabaseSql();
}

/** After requireAuth: 403 unless profiles.is_platform_admin. No-op when AUTH_DISABLED. */
export async function requirePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!authEnabled()) {
    const testAdmin = request.headers['x-test-admin'];
    if (!testIdentityAllowed() || testAdmin === '0' || testAdmin === 'false') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Platform admin required' });
    }
    return;
  }
  if (!request.userId) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const sql = getDatabaseSql();
  if (!sql) {
    return reply.code(503).send({ error: 'Admin requires DATABASE_URL' });
  }
  try {
    const rows = await sql<{ is_platform_admin: boolean }[]>`
      SELECT is_platform_admin
      FROM profiles
      WHERE id = ${request.userId}::uuid
      LIMIT 1
    `;
    if (!rows[0]?.is_platform_admin) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Platform admin required' });
    }
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'Admin check failed' });
  }
}

function sessionIdFromBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { session_id?: string };
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled()) {
    applyTestIdentity(request);
    return;
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing Bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  const client = getAuthClient();
  if (!client) {
    return reply.code(503).send({ error: 'Auth not configured' });
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return reply.code(401).send({ error: 'Unauthorized', message: error?.message ?? 'Invalid token' });
  }
  request.user = data.user;
  request.userId = data.user.id;
  request.confirmedEmail = confirmedEmailOf(data.user);
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  if (!authEnabled()) {
    applyTestIdentity(request);
    return;
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return;
  const client = getAuthClient();
  if (!client) return;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) {
      request.user = data.user;
      request.userId = data.user.id;
      request.confirmedEmail = confirmedEmailOf(data.user);
    }
  } catch {
    /* ignore invalid optional token */
  }
}

export interface AuthSessionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  refreshedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

async function deleteSupabaseUser(userId: string): Promise<{ error?: string }> {
  const service = getServiceSupabase();
  if (!service) return { error: 'Auth admin not configured' };
  const { error } = await service.auth.admin.deleteUser(userId);
  return error ? { error: error.message } : {};
}

export interface AuthPluginOptions {
  store: Store;
  /** The sign-in account itself. Replaced in tests, which have no Supabase. */
  deleteAuthUser?: (userId: string) => Promise<{ error?: string }>;
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const deleteAuthUser = opts.deleteAuthUser ?? deleteSupabaseUser;

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    if (authEnabled() && (!request.userId || !request.user)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if (!request.userId) {
      return { id: null, email: null, displayName: null, accountRole: null };
    }
    const service = getServiceSupabase();
    let displayName: string | null = null;
    if (service) {
      const { data } = await service
        .from('profiles')
        .select('display_name')
        .eq('id', request.userId)
        .maybeSingle();
      displayName = (data?.['display_name'] as string | null) ?? null;
    }
    return {
      id: request.userId,
      email: request.user?.email ?? null,
      displayName,
      accountRole: await opts.store.getAccountRole(request.userId),
    };
  });

  app.get('/me/sessions', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.userId) return reply.code(401).send({ error: 'Unauthorized' });
    const sql = getSessionsSql();
    if (!sql) {
      return {
        sessions: [] as AuthSessionRow[],
        unavailable: true,
        message:
          'Session list requires DATABASE_URL (auth.sessions). Use Sign out all devices instead.',
      };
    }
    const currentId = sessionIdFromBearer(request);
    try {
      const rows = await sql<
        {
          id: string;
          created_at: string;
          updated_at: string;
          refreshed_at: string | null;
          user_agent: string | null;
          ip: string | null;
        }[]
      >`
        SELECT id::text,
               created_at,
               updated_at,
               refreshed_at,
               user_agent,
               ip::text AS ip
        FROM auth.sessions
        WHERE user_id = ${request.userId}::uuid
        ORDER BY COALESCE(refreshed_at, updated_at, created_at) DESC
      `;
      const sessions: AuthSessionRow[] = rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        refreshedAt: r.refreshed_at,
        userAgent: r.user_agent,
        ip: r.ip,
        current: Boolean(currentId && r.id === currentId),
      }));
      return { sessions, unavailable: false };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Failed to list sessions' });
    }
  });

  app.delete<{ Params: { id: string } }>(
    '/me/sessions/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.userId) return reply.code(401).send({ error: 'Unauthorized' });
      const sessionId = request.params.id;
      const currentId = sessionIdFromBearer(request);
      if (currentId && sessionId === currentId) {
        return reply.code(400).send({
          error: 'Cannot revoke the current session here — use Sign out this browser instead.',
        });
      }
      const sql = getSessionsSql();
      if (!sql) return reply.code(503).send({ error: 'Session admin requires DATABASE_URL' });
      try {
        const deleted = await sql`
          DELETE FROM auth.sessions
          WHERE id = ${sessionId}::uuid AND user_id = ${request.userId}::uuid
          RETURNING id
        `;
        if (deleted.length === 0) return reply.code(404).send({ error: 'Session not found' });
        return reply.code(204).send();
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to revoke session' });
      }
    },
  );

  app.patch<{ Body: { displayName?: string } }>(
    '/me',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.userId) return reply.code(401).send({ error: 'Unauthorized' });
      const displayName =
        typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : '';
      const service = getServiceSupabase();
      if (!service) return reply.code(503).send({ error: 'Auth admin not configured' });
      const now = new Date().toISOString();
      const { error } = await service.from('profiles').upsert({
        id: request.userId,
        display_name: displayName || null,
        updated_at: now,
      });
      if (error) return reply.code(500).send({ error: error.message });
      return { ok: true, displayName: displayName || null };
    },
  );

  app.delete('/me', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.userId) return reply.code(401).send({ error: 'Unauthorized' });
    if (await opts.store.demo().isAccount(request.userId)) {
      return reply.code(403).send({ error: DEMO_ACCOUNT_LOCKED_MESSAGE, code: 'DEMO_ACCOUNT' });
    }
    if (!opts.deleteAuthUser && !getServiceSupabase()) {
      return reply.code(503).send({ error: 'Auth admin not configured' });
    }
    // Before the sign-in account goes: its foreign keys would erase the links this needs to follow.
    // If the next step fails, the person can try again, and this is safe to repeat.
    const outcome = await opts.store.prepareAccountDeletion(request.userId, purgeAfterFrom());
    const { error } = await deleteAuthUser(request.userId);
    if (error) {
      request.log.error({ userId: request.userId }, 'account deletion: sign-in removal failed');
      return reply.code(500).send({ error });
    }
    // Counts only. This is the record that it happened, and it names nobody.
    request.log.info({ ...outcome }, 'account deleted');
    return reply.code(204).send();
  });
};
