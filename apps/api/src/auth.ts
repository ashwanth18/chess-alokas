import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    user?: User;
  }
}

let supabaseAuth: SupabaseClient | null = null;

export function authEnabled(): boolean {
  if (process.env['AUTH_DISABLED'] === '1') return false;
  return Boolean(process.env['SUPABASE_URL'] && getSupabaseAnonOrSecret());
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

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled()) return;

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
}

export const authPlugin: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    if (authEnabled() && (!request.userId || !request.user)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if (!request.userId || !request.user) {
      return { id: null, email: null, displayName: null, identities: [] };
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
      email: request.user.email ?? null,
      displayName,
      identities: (request.user.identities ?? []).map((i) => ({
        provider: i.provider,
        identityId: i.identity_id,
      })),
    };
  });

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
    const service = getServiceSupabase();
    if (!service) return reply.code(503).send({ error: 'Auth admin not configured' });

    const now = new Date().toISOString();
    await service
      .from('tournaments')
      .update({ deleted_at: now, updated_at: now })
      .eq('owner_id', request.userId);

    const { error } = await service.auth.admin.deleteUser(request.userId);
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(204).send();
  });
};
