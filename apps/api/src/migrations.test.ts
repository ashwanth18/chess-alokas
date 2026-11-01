import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

/** Just enough of Supabase for the migrations to run: roles, auth schema, auth.uid(). */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
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
  -- Supabase's defaults: clients are granted everything and RLS does the limiting.
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

describe('database migrations', () => {
  let db: PGlite;

  /** Runs one statement the way PostgREST does for a signed-in user. */
  async function asUser(userId: string, sql: string): Promise<void> {
    await db.exec(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${userId}"}', true);
    `);
    try {
      await db.exec(sql);
      await db.exec('commit;');
    } catch (err) {
      await db.exec('rollback;');
      throw err;
    }
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pg_trgm } });
    await db.exec(SUPABASE_STUB);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      try {
        // PGlite doesn't ship pgcrypto; gen_random_uuid() is built into Postgres anyway.
        const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(
          /create extension if not exists "?pgcrypto"?\s*;/gi,
          '',
        );
        await db.exec(sql);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    await db.exec(`
      insert into auth.users (id, email) values
        ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com')
      on conflict do nothing;
      insert into public.profiles (id) values ('${USER_A}'), ('${USER_B}') on conflict do nothing;
      insert into public.organizations (id, name, slug, created_by)
      values ('${USER_A}', 'Org A', 'org-a', '${USER_A}');
    `);
  }, 120_000);

  it('every public table has row level security on', async () => {
    const { rows } = await db.query<{ tablename: string }>(`
      select tablename from pg_tables
      where schemaname = 'public' and rowsecurity = false
    `);
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('a signed-in user can read every table without a policy error', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    for (const { tablename } of rows) {
      // Permission denied is a valid outcome; a broken policy is not.
      await asUser(USER_A, `select count(*) from public."${tablename}"`).catch((err: Error) => {
        expect(err.message, tablename).toMatch(/permission denied/);
      });
    }
  });

  it('a user cannot make themselves platform admin', async () => {
    await expect(
      asUser(USER_A, `update public.profiles set is_platform_admin = true where id = '${USER_A}'`),
    ).rejects.toThrow(/permission denied/);
    const { rows } = await db.query<{ is_platform_admin: boolean }>(
      `select is_platform_admin from public.profiles where id = '${USER_A}'`,
    );
    expect(rows[0]?.is_platform_admin).toBe(false);
  });

  it('a user can still change their own display name', async () => {
    await asUser(USER_A, `update public.profiles set display_name = 'New' where id = '${USER_A}'`);
    const { rows } = await db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = '${USER_A}'`,
    );
    expect(rows[0]?.display_name).toBe('New');
  });

  it('the profile guard works even if the column grant comes back', async () => {
    await db.exec(`grant update (is_platform_admin) on public.profiles to authenticated;`);
    await asUser(USER_A, `update public.profiles set is_platform_admin = true where id = '${USER_A}'`);
    await db.exec(`revoke update (is_platform_admin) on public.profiles from authenticated;`);
    const { rows } = await db.query<{ is_platform_admin: boolean }>(
      `select is_platform_admin from public.profiles where id = '${USER_A}'`,
    );
    expect(rows[0]?.is_platform_admin).toBe(false);
  });

  it.each([
    ['verify their own organization', `update public.organizations set verification_status = 'verified', can_publish_global = true where id = '${USER_A}'`],
    ['add themselves to an organization', `insert into public.organization_members (organization_id, user_id, role) values ('${USER_A}', '${USER_B}', 'owner')`],
    ['approve their own registration', `update public.tournament_registrations set status = 'approved'`],
    ['write tournaments directly', `update public.tournaments set is_published_global = true`],
  ])('a user cannot %s', async (_label, sql) => {
    await expect(asUser(USER_A, sql)).rejects.toThrow(/permission denied/);
  });

  it('existing tournament owners keep unlimited private use without publishing rights', async () => {
    const backfill = readFileSync(
      path.join(MIGRATIONS_DIR, '028_lock_down_client_writes.sql'),
      'utf8',
    );
    const block = backfill.slice(backfill.indexOf('-- 4. Keep existing organizers working'));

    await db.exec(`
      insert into public.tournaments (id, name, style, rounds, status, owner_id)
      values ('33333333-3333-4333-8333-333333333333', 'Old Event', 'swiss', 5, 'draft', '${USER_B}');
    `);
    await db.exec(block);

    const { rows } = await db.query<{
      plan_tier: string;
      verification_status: string;
      can_publish_global: boolean;
      max_tournaments_quota: number | null;
    }>(`
      select o.plan_tier, o.verification_status, o.can_publish_global, o.max_tournaments_quota
      from public.tournaments t join public.organizations o on o.id = t.organization_id
      where t.id = '33333333-3333-4333-8333-333333333333'
    `);
    expect(rows[0]).toEqual({
      plan_tier: 'pro',
      verification_status: 'pending_review',
      can_publish_global: false,
      max_tournaments_quota: null,
    });
  });

  it('stamps server_updated_at itself, whatever updated_at the client sends', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await db.exec(`
      insert into public.tournaments (id, name, style, rounds, status, owner_id, updated_at, server_updated_at)
      values ('${id}', 'Offline', 'swiss', 5, 'draft', '${USER_A}', now() - interval '3 hours', now() - interval '3 hours');
    `);
    const { rows } = await db.query<{ recent: boolean }>(`
      select server_updated_at > now() - interval '1 minute' as recent
      from public.tournaments where id = '${id}'
    `);
    expect(rows[0]?.recent).toBe(true);
  });

  it('keeps email_sends away from clients', async () => {
    await expect(asUser(USER_A, 'select * from public.email_sends;')).rejects.toThrow(/denied/);
  });

  it('hides certificate templates with no tournament', async () => {
    await db.exec(`
      insert into public.certificate_templates (name, storage_path)
      values ('Global template', 'global.pdf');
    `);
    await db.exec(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${USER_A}"}', true);
    `);
    const { rows } = await db.query('select * from public.certificate_templates');
    await db.exec('rollback;');
    expect(rows).toEqual([]);
  });
});
