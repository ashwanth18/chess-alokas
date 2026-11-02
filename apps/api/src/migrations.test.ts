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

  it('keeps NRIC numbers and file paths away from direct client reads', async () => {
    const { rows } = await db.query<{ anon: boolean; signed_in: boolean }>(`
      select has_column_privilege('anon', 'public.tournament_registrations', 'nric_number', 'select') as anon,
             has_column_privilege('authenticated', 'public.tournament_registrations', 'private_files', 'select') as signed_in
    `);
    expect(rows[0]).toEqual({ anon: false, signed_in: false });
    await expect(
      asUser(USER_A, `select nric_number from public.tournament_registrations`),
    ).rejects.toThrow(/permission denied/);
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

  describe('organization_invites', () => {
    const insert = (id: string, email: string, hash: string) => `
      insert into public.organization_invites (id, organization_id, email, role, token_hash, expires_at)
      values ('${id}', '${USER_A}', '${email}', 'director', '${hash}', now() + interval '7 days')
    `;

    it('clients can neither read nor write invites', async () => {
      await db.exec(insert('55555555-5555-4555-8555-555555555551', 'one@example.com', 'hash-1'));
      for (const sql of [
        'select * from public.organization_invites',
        `update public.organization_invites set role = 'owner'`,
        'delete from public.organization_invites',
        insert('55555555-5555-4555-8555-555555555552', 'two@example.com', 'hash-2'),
      ]) {
        await expect(asUser(USER_A, sql)).rejects.toThrow(/permission denied/);
      }
    });

    it('has no client policies', async () => {
      const { rows } = await db.query(
        `select policyname from pg_policies where tablename = 'organization_invites'`,
      );
      expect(rows).toEqual([]);
    });

    it('allows one open invite per address, and a new one once the old is closed', async () => {
      await db.exec(insert('55555555-5555-4555-8555-555555555553', 'three@example.com', 'hash-3'));
      await expect(
        db.exec(insert('55555555-5555-4555-8555-555555555554', 'three@example.com', 'hash-4')),
      ).rejects.toThrow(/uq_organization_invites_open/);
      await db.exec(`
        update public.organization_invites set revoked_at = now()
        where id = '55555555-5555-4555-8555-555555555553'
      `);
      await db.exec(insert('55555555-5555-4555-8555-555555555554', 'three@example.com', 'hash-4'));
    });

    it('stores addresses in lower case only', async () => {
      await expect(
        db.exec(insert('55555555-5555-4555-8555-555555555555', 'Mixed@Example.com', 'hash-5')),
      ).rejects.toThrow(/check/);
    });

    it('clients can neither read nor write roster consent records', async () => {
      await expect(asUser(USER_A, 'select * from public.roster_consent_confirmations')).rejects.toThrow(
        /permission denied/,
      );
    });

    it('removes live links and query strings from stored page paths', async () => {
      await db.exec(`
        insert into public.page_views (path, route_key) values
          ('/live/secret-token/tv?x=1', 'live'),
          ('/discover', 'discover')
      `);
      const file = readFileSync(
        path.join(MIGRATIONS_DIR, '032_consent_and_account_deletion.sql'),
        'utf8',
      );
      await db.exec(file.slice(file.indexOf('update public.page_views')));
      const { rows } = await db.query<{ path: string }>('select path from public.page_views order by path');
      expect(rows.map((r) => r.path)).toEqual(['/discover', '/live/[redacted]/tv']);
    });

    it('clients can neither read nor write access revocations', async () => {
      for (const sql of [
        'select * from public.tournament_access_revocations',
        `delete from public.tournament_access_revocations`,
      ]) {
        await expect(asUser(USER_A, sql)).rejects.toThrow(/permission denied/);
      }
    });

    it('a member cannot add themselves to the team through the members table', async () => {
      await expect(
        asUser(USER_B, `update public.organization_members set role = 'owner'`),
      ).rejects.toThrow(/permission denied/);
    });

    it('the backfill gives a creator with no row a real owner row and their email', async () => {
      const file = readFileSync(
        path.join(MIGRATIONS_DIR, '030_organization_invites.sql'),
        'utf8',
      );
      // Org A was inserted directly after the migrations ran, so it has no member row.
      await db.exec(file.slice(file.indexOf('-- The API treated a creator')));
      const { rows } = await db.query<{ role: string; email: string }>(
        `select role, email from public.organization_members
         where organization_id = '${USER_A}' and user_id = '${USER_A}'`,
      );
      expect(rows[0]).toEqual({ role: 'owner', email: 'a@example.com' });
    });
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

  describe('who can read and write what (033)', () => {
    const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const ORG_A = uuid(1);
    const ORG_B = uuid(2);
    const T_A = uuid(10);
    const T_B = uuid(11);
    const T_PERSONAL = uuid(12);
    const CREATOR_A = uuid(20);
    const OWNER_A = uuid(21);
    const ADMIN_A = uuid(22);
    const DIRECTOR_A = uuid(23);
    const ARBITER_A = uuid(24);
    const OWNER_ID_A = uuid(25);
    const DIRECTOR_B = uuid(26);
    const STRANGER = uuid(27);
    const PLATFORM_ADMIN = uuid(28);
    const CAT_A = uuid(30);
    const CAT_B = uuid(31);
    const PLAYER_A1 = uuid(32);
    const PLAYER_A2 = uuid(33);
    const PLAYER_B1 = uuid(34);
    const PLAYER_B2 = uuid(35);
    const GAME_A = uuid(36);
    const GAME_B = uuid(37);

    /** Every public table must be listed here. A new table fails until someone decides. */
    const ACCESS: Record<string, 'floor' | 'manager' | 'own' | 'organization' | 'api_only'> = {
      tournaments: 'floor',
      tournament_tables: 'floor',
      floor_alerts: 'floor',
      categories: 'manager',
      participants: 'manager',
      games: 'manager',
      game_cards: 'manager',
      game_result_events: 'manager',
      certificate_issues: 'manager',
      certificate_templates: 'manager',
      profiles: 'own',
      player_profiles: 'own',
      organizations: 'organization',
      organization_members: 'organization',
      tournament_registrations: 'api_only',
      organization_invites: 'api_only',
      tournament_access_revocations: 'api_only',
      roster_consent_confirmations: 'api_only',
      email_sends: 'api_only',
      page_views: 'api_only',
      product_events: 'api_only',
      fide_players: 'api_only',
      fide_players_staging: 'api_only',
      fide_import_meta: 'api_only',
      demo_accounts: 'api_only',
    };
    const FLOOR_TABLES = Object.keys(ACCESS).filter((t) => ACCESS[t] === 'floor');
    const MANAGER_TABLES = Object.keys(ACCESS).filter((t) => ACCESS[t] === 'manager');

    /** Everything that makes a table unsafe for clients, as one list of problems. */
    async function auditClientAccess(access: Record<string, string>): Promise<string[]> {
      const { rows: tables } = await db.query<{
        tablename: string;
        rowsecurity: boolean;
        authenticated_reads: boolean;
        anon_reads: boolean;
      }>(`
        select tablename, rowsecurity,
          has_any_column_privilege('authenticated', format('public.%I', tablename), 'SELECT') as authenticated_reads,
          has_any_column_privilege('anon', format('public.%I', tablename), 'SELECT') as anon_reads
        from pg_tables where schemaname = 'public' order by tablename
      `);
      const { rows: policies } = await db.query<{ tablename: string; cmd: string; policyname: string }>(
        `select tablename, cmd, policyname from pg_policies where schemaname = 'public'`,
      );
      const { rows: writeGrants } = await db.query<{ tablename: string; role: string; privilege: string }>(`
        select t.tablename, r.role, p.privilege
        from pg_tables t
        cross join (values ('anon'), ('authenticated')) r(role)
        cross join (values ('INSERT'), ('UPDATE')) p(privilege)
        where t.schemaname = 'public'
          and has_any_column_privilege(r.role, format('public.%I', t.tablename), p.privilege)
        union all
        select t.tablename, r.role, p.privilege
        from pg_tables t
        cross join (values ('anon'), ('authenticated')) r(role)
        cross join (values ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
        where t.schemaname = 'public'
          and has_table_privilege(r.role, format('public.%I', t.tablename), p.privilege)
      `);

      const problems: string[] = [];
      for (const table of tables) {
        const name = table.tablename;
        const kind = access[name];
        if (!kind) {
          problems.push(`${name}: not classified. Decide who may read it and add it to ACCESS.`);
          continue;
        }
        if (!table.rowsecurity) problems.push(`${name}: row level security is off`);
        if (table.anon_reads) problems.push(`${name}: signed-out clients have select`);
        const reads = policies.filter((p) => p.tablename === name && p.cmd === 'SELECT');
        if (kind === 'api_only') {
          if (table.authenticated_reads) problems.push(`${name}: API-only, but clients have select`);
          if (reads.length > 0) problems.push(`${name}: API-only, but has a read policy`);
        } else if (reads.length === 0) {
          problems.push(`${name}: clients have no read policy`);
        }
      }
      // A view has no row level security of its own, so clients must not reach one at all.
      const { rows: views } = await db.query<{ viewname: string }>(`
        with mine as materialized (select viewname from pg_views where schemaname = 'public')
        select viewname from mine
        where has_any_column_privilege('anon', format('public.%I', viewname), 'SELECT')
           or has_any_column_privilege('authenticated', format('public.%I', viewname), 'SELECT')
      `);
      for (const view of views) problems.push(`${view.viewname}: a view clients can read`);
      for (const policy of policies) {
        const profileWrite = policy.tablename === 'profiles' && ['INSERT', 'UPDATE'].includes(policy.cmd);
        if (policy.cmd !== 'SELECT' && !profileWrite) {
          problems.push(`${policy.tablename}: write policy ${policy.policyname} (${policy.cmd})`);
        }
      }
      for (const grant of writeGrants) {
        const displayName =
          grant.tablename === 'profiles' &&
          grant.role === 'authenticated' &&
          ['INSERT', 'UPDATE'].includes(grant.privilege);
        if (!displayName) problems.push(`${grant.tablename}: ${grant.role} has ${grant.privilege}`);
      }
      return problems;
    }

    async function asClient<T>(
      role: 'authenticated' | 'anon',
      userId: string | null,
      sql: string,
    ): Promise<T[]> {
      const claims = JSON.stringify(userId ? { role, sub: userId } : { role });
      await db.exec(`
        begin;
        set local role ${role};
        select set_config('request.jwt.claims', '${claims}', true);
      `);
      try {
        return (await db.query<T>(sql)).rows;
      } finally {
        await db.exec('rollback;');
      }
    }

    const scope = (table: string, tournamentId: string) =>
      table === 'tournaments' ? `id = '${tournamentId}'` : `tournament_id = '${tournamentId}'`;

    async function visibleRows(userId: string, table: string, tournamentId: string): Promise<number> {
      const rows = await asClient<{ n: number }>(
        'authenticated',
        userId,
        `select count(*)::int as n from public."${table}" where ${scope(table, tournamentId)}`,
      );
      return rows[0]!.n;
    }

    beforeAll(async () => {
      const people = [
        CREATOR_A, OWNER_A, ADMIN_A, DIRECTOR_A, ARBITER_A, OWNER_ID_A, DIRECTOR_B, STRANGER, PLATFORM_ADMIN,
      ];
      for (const id of people) {
        await db.exec(`
          insert into auth.users (id, email) values ('${id}', '${id}@example.com') on conflict do nothing;
          insert into public.profiles (id) values ('${id}') on conflict do nothing;
        `);
      }
      await db.exec(`
        update public.profiles set is_platform_admin = true where id = '${PLATFORM_ADMIN}';
        insert into public.organizations (id, name, slug, created_by) values
          ('${ORG_A}', 'Sweep A', 'sweep-a', '${CREATOR_A}'),
          ('${ORG_B}', 'Sweep B', 'sweep-b', '${DIRECTOR_B}');
        insert into public.organization_members (organization_id, user_id, role) values
          ('${ORG_A}', '${OWNER_A}', 'owner'),
          ('${ORG_A}', '${ADMIN_A}', 'admin'),
          ('${ORG_A}', '${DIRECTOR_A}', 'director'),
          ('${ORG_A}', '${ARBITER_A}', 'arbiter'),
          ('${ORG_B}', '${DIRECTOR_B}', 'director');
      `);
      for (const [tid, org, owner, cat, white, black, game] of [
        [T_A, ORG_A, OWNER_ID_A, CAT_A, PLAYER_A1, PLAYER_A2, GAME_A],
        [T_B, ORG_B, DIRECTOR_B, CAT_B, PLAYER_B1, PLAYER_B2, GAME_B],
      ] as const) {
        await db.exec(`
          insert into public.tournaments (id, name, style, rounds, status, owner_id, organization_id, arbiter_pin_hash)
          values ('${tid}', 'Sweep', 'swiss', 5, 'in_progress', '${owner}', '${org}', 'scrypt$x$y');
          insert into public.categories (id, tournament_id, name, filter)
          values ('${cat}', '${tid}', 'Open', '{"logic":"and","rules":[]}');
          insert into public.participants (id, tournament_id, name, age) values
            ('${white}', '${tid}', 'White Player', 10), ('${black}', '${tid}', 'Black Player', 11);
          insert into public.games (id, tournament_id, category_id, round, board, white_id, black_id, result)
          values ('${game}', '${tid}', '${cat}', 1, 1, '${white}', '${black}', '1-0');
          insert into public.game_cards (game_id, tournament_id, player_id, card_type, actor_role)
          values ('${game}', '${tid}', '${white}', 'warning', 'director');
          insert into public.game_result_events (game_id, tournament_id, result, actor_role)
          values ('${game}', '${tid}', '1-0', 'director');
          insert into public.tournament_tables (tournament_id, table_number, slug)
          values ('${tid}', 1, 'slug-${tid}');
          insert into public.floor_alerts (tournament_id, round, table_number, reason)
          values ('${tid}', 1, 1, 'Help');
          insert into public.certificate_issues (tournament_id, type, recipient_name, storage_path, content_sha256)
          values ('${tid}', 'participation', 'White Player', 'x.pdf', 'abc');
          insert into public.certificate_templates (tournament_id, name, storage_path)
          values ('${tid}', 'Template', 't.pdf');
          insert into public.tournament_registrations (tournament_id, submitted_by_user_id, player_snapshot)
          values ('${tid}', '${STRANGER}', '{"name":"Entrant"}');
        `);
      }
      await db.exec(`
        insert into public.tournaments (id, name, style, rounds, status, owner_id)
        values ('${T_PERSONAL}', 'Personal', 'swiss', 5, 'draft', '${STRANGER}');
      `);
    });

    it('has no table that a client could misuse', async () => {
      expect(await auditClientAccess(ACCESS)).toEqual([]);
    });

    it('a table added with no decision fails the audit', async () => {
      await db.exec(`
        create table public.zz_unclassified (id uuid primary key, tournament_id uuid);
        alter table public.zz_unclassified enable row level security;
      `);
      try {
        const problems = await auditClientAccess(ACCESS);
        expect(problems.join('\n')).toMatch(/zz_unclassified: not classified/);
        // Classified as readable, it still fails until it has a policy.
        const asManager = await auditClientAccess({ ...ACCESS, zz_unclassified: 'manager' });
        expect(asManager.join('\n')).toMatch(/zz_unclassified: clients have no read policy/);
      } finally {
        await db.exec('drop table public.zz_unclassified;');
      }
    });

    it('a table with row level security off fails the audit', async () => {
      await db.exec('create table public.zz_open (id uuid primary key);');
      try {
        const problems = await auditClientAccess({ ...ACCESS, zz_open: 'api_only' });
        expect(problems.join('\n')).toMatch(/zz_open: row level security is off/);
      } finally {
        await db.exec('drop table public.zz_open;');
      }
    });

    it('checks every tournament-owned table: none is missing from the sweep below', async () => {
      const { rows } = await db.query<{ table_name: string }>(`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'tournament_id'
      `);
      const apiOnly = Object.keys(ACCESS).filter((t) => ACCESS[t] === 'api_only');
      for (const { table_name } of rows) {
        expect(FLOOR_TABLES.concat(MANAGER_TABLES, apiOnly), table_name).toContain(table_name);
      }
    });

    describe.each([
      ['organization creator with no member row', CREATOR_A, { floor: 1, manager: 1 }],
      ['organization owner', OWNER_A, { floor: 1, manager: 1 }],
      ['organization admin', ADMIN_A, { floor: 1, manager: 1 }],
      ['organization director', DIRECTOR_A, { floor: 1, manager: 1 }],
      ['the tournament owner_id', OWNER_ID_A, { floor: 1, manager: 1 }],
      ['organization arbiter', ARBITER_A, { floor: 1, manager: 0 }],
      ['a director of another organization', DIRECTOR_B, { floor: 0, manager: 0 }],
      ['a signed-in stranger', STRANGER, { floor: 0, manager: 0 }],
      ['a platform admin', PLATFORM_ADMIN, { floor: 0, manager: 0 }],
    ] as const)('%s', (_label, userId, expected) => {
      it.each(FLOOR_TABLES)('reads the right rows of %s', async (table) => {
        // Proves the row is there, so a zero below means refused rather than empty.
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from public."${table}" where ${scope(table, T_A)}`,
        );
        expect(rows[0]!.n).toBe(1);
        expect(await visibleRows(userId, table, T_A)).toBe(expected.floor);
      });
      it.each(MANAGER_TABLES)('reads the right rows of %s', async (table) => {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from public."${table}" where ${scope(table, T_A)}`,
        );
        expect(rows[0]!.n).toBeGreaterThan(0);
        const seen = await visibleRows(userId, table, T_A);
        expect(seen > 0 ? 1 : 0).toBe(expected.manager);
      });
    });

    it('an arbiter reads no player record by any table', async () => {
      for (const table of ['participants', 'games', 'game_cards', 'game_result_events', 'certificate_issues']) {
        expect(await asClient('authenticated', ARBITER_A, `select * from public."${table}"`)).toEqual([]);
      }
      await expect(
        asClient('authenticated', ARBITER_A, 'select * from public.tournament_registrations'),
      ).rejects.toThrow(/permission denied/);
    });

    it('organization rows stay inside the organization', async () => {
      expect(
        await asClient('authenticated', DIRECTOR_B, `select id from public.organizations where id = '${ORG_A}'`),
      ).toEqual([]);
      expect(
        await asClient(
          'authenticated',
          DIRECTOR_B,
          `select user_id from public.organization_members where organization_id = '${ORG_A}'`,
        ),
      ).toEqual([]);
      expect(
        await asClient('authenticated', DIRECTOR_A, `select id from public.organizations where id = '${ORG_A}'`),
      ).toHaveLength(1);
    });

    it('a personal tournament is its owner\'s alone', async () => {
      expect(await visibleRows(STRANGER, 'tournaments', T_PERSONAL)).toBe(1);
      expect(await visibleRows(DIRECTOR_A, 'tournaments', T_PERSONAL)).toBe(0);
    });

    it('access ends when membership or the tournament does', async () => {
      await db.exec(`
        insert into public.organization_members (organization_id, user_id, role)
        values ('${ORG_A}', '${STRANGER}', 'director');
      `);
      expect(await visibleRows(STRANGER, 'participants', T_A)).toBeGreaterThan(0);
      await db.exec(`update public.organization_members set role = 'arbiter'
                     where organization_id = '${ORG_A}' and user_id = '${STRANGER}'`);
      expect(await visibleRows(STRANGER, 'participants', T_A)).toBe(0);
      await db.exec(`delete from public.organization_members
                     where organization_id = '${ORG_A}' and user_id = '${STRANGER}'`);
      expect(await visibleRows(STRANGER, 'tournaments', T_A)).toBe(0);

      await db.exec(`update public.tournaments set deleted_at = now() where id = '${T_A}'`);
      expect(await visibleRows(DIRECTOR_A, 'games', T_A)).toBe(0);
      await db.exec(`update public.tournaments set deleted_at = null where id = '${T_A}'`);
      expect(await visibleRows(DIRECTOR_A, 'games', T_A)).toBeGreaterThan(0);
    });

    it('a member row decides over being the creator', async () => {
      await db.exec(`
        insert into public.organization_members (organization_id, user_id, role)
        values ('${ORG_A}', '${CREATOR_A}', 'arbiter');
      `);
      expect(await visibleRows(CREATOR_A, 'participants', T_A)).toBe(0);
      expect(await visibleRows(CREATOR_A, 'tournaments', T_A)).toBe(1);
      await db.exec(`delete from public.organization_members
                     where organization_id = '${ORG_A}' and user_id = '${CREATOR_A}'`);
    });

    it('nobody reads the floor PIN hash or the live token directly', async () => {
      for (const column of ['arbiter_pin_hash', 'public_token']) {
        await expect(
          asClient('authenticated', OWNER_ID_A, `select ${column} from public.tournaments`),
        ).rejects.toThrow(/permission denied/);
      }
      const rows = await asClient<{ name: string }>(
        'authenticated',
        ARBITER_A,
        `select name, status from public.tournaments where id = '${T_A}'`,
      );
      expect(rows[0]?.name).toBe('Sweep');
    });

    it('signed-out clients read nothing from any table', async () => {
      const { rows } = await db.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public'`,
      );
      expect(rows.length).toBeGreaterThan(20);
      for (const { tablename } of rows) {
        await expect(asClient('anon', null, `select count(*) from public."${tablename}"`), tablename).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it('no client write works on any table', async () => {
      const { rows } = await db.query<{ tablename: string; column: string }>(`
        select t.tablename,
          (select quote_ident(c.column_name) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = t.tablename
           order by c.ordinal_position limit 1) as column
        from pg_tables t where t.schemaname = 'public'
      `);
      const actors: Array<['authenticated' | 'anon', string | null]> = [
        ['anon', null],
        ['authenticated', DIRECTOR_A],
        ['authenticated', OWNER_ID_A],
      ];
      for (const { tablename, column } of rows) {
        for (const [role, userId] of actors) {
          for (const sql of [
            `insert into public."${tablename}" default values`,
            `update public."${tablename}" set ${column} = ${column}`,
            `delete from public."${tablename}"`,
            `truncate public."${tablename}"`,
          ]) {
            await expect(asClient(role, userId, sql), `${tablename}: ${sql}`).rejects.toThrow(
              /permission denied|row-level security/,
            );
          }
        }
      }
    });

    it('the one client write left is your own display name', async () => {
      await asClient('authenticated', DIRECTOR_A, `update public.profiles set display_name = 'Mine' where id = '${DIRECTOR_B}'`);
      const { rows } = await db.query<{ display_name: string | null }>(
        `select display_name from public.profiles where id = '${DIRECTOR_B}'`,
      );
      expect(rows[0]?.display_name).not.toBe('Mine');
      const own = await asClient<{ display_name: string }>(
        'authenticated',
        DIRECTOR_A,
        `update public.profiles set display_name = 'Mine' where id = '${DIRECTOR_A}' returning display_name`,
      );
      expect(own[0]?.display_name).toBe('Mine');
    });

    describe('the helper', () => {
      it('is safe by construction', async () => {
        const { rows } = await db.query<{
          secdef: boolean;
          config: string[] | null;
          anon: boolean;
          public_role: boolean;
          authenticated: boolean;
        }>(`
          select p.prosecdef as secdef, p.proconfig as config,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
            exists (
              select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            ) as public_role
          from pg_proc p where p.proname = 'readable_tournament_ids'
        `);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ secdef: true, anon: false, public_role: false, authenticated: true });
        expect(rows[0]!.config?.join(',')).toMatch(/search_path=("")?$/);
      });

      it('takes no user id, so nobody can ask about someone else', async () => {
        const mine = await asClient<{ id: string }>(
          'authenticated',
          DIRECTOR_B,
          'select id from public.readable_tournament_ids() as id',
        );
        expect(mine.map((r) => r.id)).toEqual([T_B]);
      });

      it('with no user behind the token, returns nothing', async () => {
        expect(
          await asClient('authenticated', null, 'select id from public.readable_tournament_ids() as id'),
        ).toEqual([]);
      });

      it('every other SECURITY DEFINER function is pinned and closed to signed-out clients', async () => {
        const { rows } = await db.query<{ proname: string; config: string[] | null; anon: boolean }>(`
          select p.proname, p.proconfig as config, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
        `);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.anon, row.proname).toBe(false);
          expect(row.config?.join(',') ?? '', row.proname).toMatch(/search_path=/);
        }
      });

      it('runs once per query, not once per row', async () => {
        await db.exec(`
          begin;
          set local enable_seqscan = off;
          set local role authenticated;
          select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${DIRECTOR_A}"}', true);
        `);
        try {
          const { rows } = await db.query<{ 'QUERY PLAN': string }>(
            `explain select * from public.games where tournament_id = '${T_A}'`,
          );
          const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
          // Planned as one hashed subquery over an index scan: no call per row of games.
          expect(plan).toMatch(/hashed SubPlan/);
          expect(plan).toMatch(/Index Scan/);
          expect(plan).not.toMatch(/Seq Scan on games/);
        } finally {
          await db.exec('rollback;');
        }
      });

      it('every tournament-owned table has an index that starts with tournament_id', async () => {
        const { rows } = await db.query<{ table_name: string; indexed: boolean }>(`
          select c.table_name, exists (
            select 1 from pg_index i
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
            where i.indrelid = format('public.%I', c.table_name)::regclass
              and a.attname = 'tournament_id'
          ) as indexed
          from information_schema.columns c
          where c.table_schema = 'public' and c.column_name = 'tournament_id'
        `);
        const readable = rows.filter((r) => ACCESS[r.table_name] !== 'api_only');
        expect(readable.length).toBeGreaterThan(5);
        expect(readable.filter((r) => !r.indexed).map((r) => r.table_name)).toEqual([]);
      });
    });

    /**
     * Realtime can't run here. What it does per subscriber, per change, is run as the subscriber's
     * role with their JWT claims, check column privileges, then test the row against SELECT policies.
     * This checks each of those parts. deploy/DOKPLOY.md has the check to run against real Supabase.
     */
    describe('what Realtime needs from the database', () => {
      it.each(['games', 'game_cards'])('publishes %s', async (table) => {
        const { rows } = await db.query(
          `select 1 from pg_publication_tables where pubname = 'supabase_realtime'
           and schemaname = 'public' and tablename = '${table}'`,
        );
        expect(rows).toHaveLength(1);
      });

      it.each(['games', 'game_cards'])('lets subscribers select every column of %s', async (table) => {
        const { rows } = await db.query<{ column_name: string; selectable: boolean }>(`
          select column_name,
            has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'SELECT') as selectable
          from information_schema.columns where table_schema = 'public' and table_name = '${table}'
        `);
        expect(rows.filter((r) => !r.selectable)).toEqual([]);
      });

      it('an invited director passes on a game they did not create, and the filter column works', async () => {
        const rows = await asClient<{ id: string }>(
          'authenticated',
          DIRECTOR_A,
          `select id from public.games where tournament_id = '${T_A}' and id = '${GAME_A}'`,
        );
        expect(rows).toEqual([{ id: GAME_A }]);
      });

      it('another organization\'s director does not', async () => {
        expect(
          await asClient('authenticated', DIRECTOR_B, `select id from public.games where id = '${GAME_A}'`),
        ).toEqual([]);
      });
    });

    it('closes either receipts or certificates bucket if it was left public', async () => {
      const file = readFileSync(path.join(MIGRATIONS_DIR, '033_organization_aware_rls.sql'), 'utf8');
      await db.exec(`
        create schema storage;
        create table storage.buckets (id text primary key, public boolean not null);
        insert into storage.buckets values
          ('certificates', true), ('registration-receipts', true), ('avatars', true);
      `);
      try {
        await db.exec(file.slice(file.indexOf('-- 7. Storage')));
        const { rows } = await db.query<{ id: string; public: boolean }>(
          'select id, public from storage.buckets order by id',
        );
        expect(rows).toEqual([
          { id: 'avatars', public: true },
          { id: 'certificates', public: false },
          { id: 'registration-receipts', public: false },
        ]);
      } finally {
        await db.exec('drop schema storage cascade;');
      }
    });

    it('can run twice', async () => {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, '033_organization_aware_rls.sql'), 'utf8'));
      expect(await auditClientAccess(ACCESS)).toEqual([]);
    });
  });
});
