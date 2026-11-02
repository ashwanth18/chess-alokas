/**
 * The demo tenant against both stores, and against a database as production has it: every
 * migration through 032, then 036 alone. The rule throughout: real data is never touched.
 */
import { randomUUID } from 'node:crypto';
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
import { DEMO_NAME_SUFFIX, DEMO_ORG_SLUG, DemoGuardError } from './constants.js';
import { createMemoryDemoOps, type MemoryStoreInternals } from './memoryOps.js';
import { bbpPairingsAvailable } from '@chess-alokas/pairing-engine/bbp';
import { DEMO_LINKS, buildDemoPlan } from './plan.js';
import { createPostgresDemoOps } from './postgresOps.js';
import {
  demoDelete,
  demoDryRun,
  demoEmailOf,
  demoReset,
  demoSeed,
  demoSetListed,
  type DemoAuthAdmin,
  type DemoFileStore,
  type DemoRunContext,
} from './runner.js';
import { sampleQrPng, sampleReceiptPng } from './sampleImage.js';
import type { DemoOps } from './types.js';

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

const ENV = {
  DEMO_STAFF_PASSWORD: 'test-staff-password',
  DEMO_PLAYER_PASSWORD: 'test-player-password',
} as NodeJS.ProcessEnv;

async function freePort(): Promise<number> {
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

function fakeFiles() {
  const stored = new Set<string>();
  const removed: string[] = [];
  const files: DemoFileStore = {
    saveReceipt: async (t, r) => {
      const p = `${t}/${r}.png`;
      stored.add(p);
      return p;
    },
    saveCertificate: async (t, i) => {
      const p = `${t}/${i}.pdf`;
      stored.add(p);
      return p;
    },
    deleteReceipt: async (p) => {
      stored.delete(p);
      removed.push(p);
    },
    deleteCertificate: async (p) => {
      stored.delete(p);
      removed.push(p);
    },
  };
  return { files, stored, removed };
}

/** Migrations up to and including `through`, then any named ones. */
async function database(
  filter: (file: string) => boolean,
): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (!filter(file)) continue;
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
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
    sql,
    close: async () => {
      await sql.end({ timeout: 1 });
      await server.stop();
      await db.close();
    },
  };
}

function sqlAuth(sql: Sql): DemoAuthAdmin {
  return {
    findUserIdByEmail: async (email) => {
      const [row] = await sql<{ id: string }[]>`SELECT id::text AS id FROM auth.users WHERE email = ${email}`;
      return row?.id ?? null;
    },
    createUser: async ({ email, password }) => {
      const id = randomUUID();
      await sql`INSERT INTO auth.users (id, email, encrypted_password) VALUES (${id}, ${email}, ${password})`;
      return { id };
    },
    updatePassword: async (id, password) => {
      await sql`UPDATE auth.users SET encrypted_password = ${password} WHERE id = ${id}`;
    },
    deleteUser: async (id) => {
      await sql`DELETE FROM auth.users WHERE id = ${id}`;
    },
  };
}

describe('sample images', () => {
  it('are real PNG files', () => {
    for (const png of [
      sampleQrPng(),
      sampleReceiptPng({
        reference: 'DEMO-0001',
        payer: 'Aina Sofea binti Rashid',
        amountCents: 4000,
        currency: 'MYR',
        dateIso: '2026-11-02T00:00:00.000Z',
      }),
    ]) {
      expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(png.length).toBeGreaterThan(200);
    }
  });
});

describe('on a database as production has it: through 032, then 036 alone', () => {
  let sql: Sql;
  let close: () => Promise<void>;
  let ops: DemoOps;
  let ctx: DemoRunContext;
  const lines: string[] = [];
  const fake = fakeFiles();
  const realUser = randomUUID();
  const realOrg = randomUUID();
  const realTournament = randomUUID();
  const realParticipant = randomUUID();
  const realProfile = randomUUID();

  beforeAll(async () => {
    ({ sql, close } = await database((file) => file <= '032_z' || file.startsWith('036_')));
    ops = createPostgresDemoOps(sql);
    ctx = {
      ops,
      auth: sqlAuth(sql),
      files: fake.files,
      env: ENV,
      log: (line) => lines.push(line),
      style: 'swiss',
    };
    await sql`INSERT INTO auth.users (id, email) VALUES (${realUser}, 'real@example.com')`;
    await sql`
      INSERT INTO organizations (id, name, slug, verification_status, plan_tier, can_publish_global, created_by)
      VALUES (${realOrg}, 'Real Academy', 'real-academy', 'verified', 'pro', true, ${realUser})
    `;
    await sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${realOrg}, ${realUser}, 'owner')
    `;
    await sql`
      INSERT INTO tournaments (id, name, style, rounds, status, owner_id, organization_id, updated_at, is_published_global, public_slug)
      VALUES (${realTournament}, 'Real Open', 'swiss', 5, 'ready', ${realUser}, ${realOrg}, now(), true, 'real-open')
    `;
    await sql`
      INSERT INTO player_profiles (id, account_user_id, full_name, created_at, updated_at)
      VALUES (${realProfile}, ${realUser}, 'Real Player', now(), now())
    `;
    await sql`
      INSERT INTO participants (id, tournament_id, name, age, player_profile_id, updated_at)
      VALUES (${realParticipant}, ${realTournament}, 'Real Player', 10, ${realProfile}, now())
    `;
  }, 180_000);

  afterAll(async () => {
    await close?.();
  });

  async function realRows() {
    const [row] = await sql<Record<string, string>[]>`
      SELECT
        (SELECT name FROM organizations WHERE id = ${realOrg}) AS org,
        (SELECT name FROM tournaments WHERE id = ${realTournament} AND deleted_at IS NULL) AS tournament,
        (SELECT name FROM participants WHERE id = ${realParticipant}) AS participant,
        (SELECT player_profile_id::text FROM participants WHERE id = ${realParticipant}) AS link,
        (SELECT full_name FROM player_profiles WHERE id = ${realProfile}) AS profile,
        (SELECT email FROM auth.users WHERE id = ${realUser}) AS email
    `;
    return row;
  }
  const REAL = {
    org: 'Real Academy',
    tournament: 'Real Open',
    participant: 'Real Player',
    profile: 'Real Player',
    email: 'real@example.com',
  };

  it('a dry run writes nothing, and proves the SQL against this schema', async () => {
    lines.length = 0;
    await demoDryRun(ctx);
    expect(lines.join('\n')).toContain('Would create account');
    expect(lines.join('\n')).toContain('Rolled back');
    expect(lines.join('\n')).toContain('Form builder fields (034): no');
    const [counts] = await sql<{ orgs: number; users: number; demo: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM organizations WHERE is_demo) AS orgs,
             (SELECT COUNT(*)::int FROM auth.users) AS users,
             (SELECT COUNT(*)::int FROM demo_accounts) AS demo
    `;
    expect(counts).toEqual({ orgs: 0, users: 1, demo: 0 });
    expect(fake.stored.size).toBe(0);
  }, 120_000);

  it('seeds, leaving out what this schema has no column for', async () => {
    lines.length = 0;
    await demoSeed(ctx);
    const report = lines.join('\n');
    expect(report).toContain('Form builder fields (034): no');
    expect(report).toContain('lock on auth.users: on');
    expect(report).not.toContain('test-staff-password');
    expect(report).not.toContain('test-player-password');

    const [org] = await sql<Record<string, unknown>[]>`
      SELECT name, slug, verification_status, plan_tier, can_publish_global FROM organizations WHERE is_demo
    `;
    expect(org).toEqual({
      name: 'Akademi Catur Demo',
      slug: DEMO_ORG_SLUG,
      verification_status: 'verified',
      plan_tier: 'pro',
      can_publish_global: true,
    });
    const names = await sql<{ name: string }[]>`
      SELECT name FROM tournaments WHERE id IN (SELECT id FROM demo_tournament_ids) AND deleted_at IS NULL
    `;
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const { name } of names) expect(name.endsWith(DEMO_NAME_SUFFIX)).toBe(true);
    expect(fake.stored.size).toBeGreaterThan(20);
    expect(await realRows()).toMatchObject(REAL);
  }, 120_000);

  it('builds Round 4 of 7 from real pairings, with some results in', async () => {
    const [t] = await sql<{ id: string; current_round: number; rounds: number; confirmed_rounds: number; arbiter_pin_hash: string }[]>`
      SELECT id::text AS id, current_round, rounds, confirmed_rounds, arbiter_pin_hash
      FROM tournaments WHERE public_slug = ${DEMO_LINKS.slugs.inProgress}
    `;
    expect(t).toMatchObject({ current_round: 4, rounds: 7, confirmed_rounds: 3 });
    expect(t!.arbiter_pin_hash).toMatch(/^scrypt\$/);
    const players = await sql`SELECT id FROM participants WHERE tournament_id = ${t!.id}`;
    expect(players.length).toBeGreaterThanOrEqual(38);
    const round4 = await sql<{ result: string; is_bye: boolean }[]>`
      SELECT result, is_bye FROM games WHERE tournament_id = ${t!.id} AND round = 4
    `;
    const played = round4.filter((g) => !g.is_bye);
    expect(played.some((g) => g.result === 'pending')).toBe(true);
    expect(played.some((g) => g.result !== 'pending')).toBe(true);
    const earlier = await sql`
      SELECT id FROM games WHERE tournament_id = ${t!.id} AND round < 4 AND result = 'pending'
    `;
    expect(earlier.length).toBe(0);
    const corrections = await sql`
      SELECT note FROM game_result_events
      WHERE tournament_id = ${t!.id} AND actor_role = 'director' AND note IS NOT NULL
    `;
    expect(corrections.length).toBe(1);
    const alerts = await sql`SELECT id FROM floor_alerts WHERE tournament_id = ${t!.id} AND resolved_at IS NULL`;
    expect(alerts.length).toBe(1);
  });

  it('a second seed changes nothing', async () => {
    const before = await sql`SELECT id FROM tournaments ORDER BY id`;
    lines.length = 0;
    await demoSeed(ctx);
    expect(lines.join('\n')).toContain('already here');
    expect(await sql`SELECT id FROM tournaments ORDER BY id`).toEqual(before);
  });

  it('the switch hides demo events from the query every feed uses, without a re-seed', async () => {
    // The same conditions as the API already deployed: it knows nothing about is_demo.
    const feed = () => sql<{ name: string }[]>`
      SELECT t.name FROM tournaments t JOIN organizations o ON o.id = t.organization_id
      WHERE t.deleted_at IS NULL AND t.is_published_global = true
        AND o.verification_status = 'verified' AND o.can_publish_global = true
    `;
    expect((await feed()).some((t) => t.name.endsWith(DEMO_NAME_SUFFIX))).toBe(true);
    await demoSetListed(ctx, false);
    const hidden = await feed();
    expect(hidden.map((t) => t.name)).toEqual(['Real Open']);
    await demoReset(ctx);
    expect((await feed()).map((t) => t.name)).toEqual(['Real Open']);
    await demoSetListed(ctx, true);
    expect((await feed()).some((t) => t.name.endsWith(DEMO_NAME_SUFFIX))).toBe(true);
  }, 120_000);

  it('blocks demo email, invites and crossing over, even for an API that does not know about them', async () => {
    const [demoEvent] = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM tournaments WHERE public_slug = ${DEMO_LINKS.slugs.kualaLumpur}
    `;
    const accounts = await ops.listAccounts();
    const parent = accounts.find((a) => a.label === 'parent')!;
    const org = await ops.getOrganization();

    await expect(sql`
      INSERT INTO email_sends (scope_key, kind, tournament_id, recipient_count)
      VALUES ('org:x', 'bulk', ${demoEvent!.id}, 3)
    `).rejects.toThrow(/do not send email/);
    await expect(sql`
      INSERT INTO organization_invites (id, organization_id, email, role, token_hash, expires_at)
      VALUES (${randomUUID()}, ${org!.id}, 'someone@example.com', 'arbiter', ${randomUUID()}, now() + interval '1 day')
    `).rejects.toThrow(/does not send invites/);
    await expect(sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${org!.id}, ${realUser}, 'arbiter')
    `).rejects.toThrow(/only mix/);
    await expect(sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${realOrg}, ${parent.userId}, 'arbiter')
    `).rejects.toThrow(/only mix/);
    await expect(sql`
      INSERT INTO tournament_registrations (id, tournament_id, submitted_by_user_id, player_snapshot, created_at, updated_at)
      VALUES (${randomUUID()}, ${demoEvent!.id}, ${realUser}, ${sql.json({ name: 'A real parent' })}, now(), now())
    `).rejects.toThrow(/demo event/);
    await expect(sql`
      INSERT INTO tournament_registrations (id, tournament_id, player_snapshot, created_at, updated_at)
      VALUES (${randomUUID()}, ${demoEvent!.id}, ${sql.json({ name: 'Nobody signed in' })}, now(), now())
    `).rejects.toThrow(/demo event/);
    await expect(sql`
      INSERT INTO tournament_registrations (id, tournament_id, submitted_by_user_id, player_snapshot, created_at, updated_at)
      VALUES (${randomUUID()}, ${realTournament}, ${parent.userId}, ${sql.json({ name: 'Demo child' })}, now(), now())
    `).rejects.toThrow(/cannot enter real/);

    // Real activity is unaffected.
    await sql`
      INSERT INTO email_sends (scope_key, kind, tournament_id, recipient_count)
      VALUES ('org:real', 'bulk', ${realTournament}, 3)
    `;
    const realEntry = randomUUID();
    await sql`
      INSERT INTO tournament_registrations (id, tournament_id, submitted_by_user_id, player_snapshot, created_at, updated_at)
      VALUES (${realEntry}, ${realTournament}, ${realUser}, ${sql.json({ name: 'A real parent' })}, now(), now())
    `;
    await sql`DELETE FROM tournament_registrations WHERE id = ${realEntry}`;
  });

  it('locks shared accounts, and leaves real accounts alone', async () => {
    const [owner] = await sql<{ user_id: string }[]>`
      SELECT user_id::text AS user_id FROM demo_accounts WHERE label = 'owner'
    `;
    const id = owner!.user_id;
    await expect(sql`UPDATE auth.users SET encrypted_password = 'taken' WHERE id = ${id}`).rejects.toThrow(/Demo accounts cannot/);
    await expect(sql`UPDATE auth.users SET email = 'me@example.com' WHERE id = ${id}`).rejects.toThrow(/Demo accounts cannot/);
    await expect(sql`UPDATE auth.users SET email_change = 'me@example.com' WHERE id = ${id}`).rejects.toThrow(/Demo accounts cannot/);
    await expect(sql`DELETE FROM auth.users WHERE id = ${id}`).rejects.toThrow(/cannot be deleted/);
    // A sign-in still updates the row, and metadata isn't a credential.
    await sql`UPDATE auth.users SET raw_user_meta_data = '{"display_name":"x"}' WHERE id = ${id}`;

    await sql`UPDATE auth.users SET encrypted_password = 'new-real' WHERE id = ${realUser}`;
    const [real] = await sql<{ encrypted_password: string }[]>`
      SELECT encrypted_password FROM auth.users WHERE id = ${realUser}
    `;
    expect(real!.encrypted_password).toBe('new-real');
  });

  it('a reset sets passwords through the lock, and relocks', async () => {
    await demoReset(ctx);
    const [owner] = await sql<{ encrypted_password: string; until: Date | null }[]>`
      SELECT u.encrypted_password, d.credentials_unlocked_until AS until
      FROM auth.users u JOIN demo_accounts d ON d.user_id = u.id WHERE d.label = 'owner'
    `;
    expect(owner!.encrypted_password).toBe('test-staff-password');
    expect(owner!.until).toBeNull();
  }, 120_000);

  it('a reset rebuilds demo data, leaves tombstones for old devices, and restores visitors’ edits', async () => {
    const [before] = await sql<{ id: string; name: string }[]>`
      SELECT id::text AS id, name FROM tournaments WHERE public_slug = ${DEMO_LINKS.slugs.inProgress}
    `;
    const org = await ops.getOrganization();
    await sql`UPDATE organizations SET name = 'Vandalised' WHERE id = ${org!.id}`;
    await sql`UPDATE tournaments SET name = 'Vandalised' WHERE id = ${before!.id}`;

    await demoReset(ctx);

    const [fresh] = await sql<{ id: string; name: string }[]>`
      SELECT id::text AS id, name FROM tournaments WHERE public_slug = ${DEMO_LINKS.slugs.inProgress}
    `;
    expect(fresh!.id).not.toBe(before!.id);
    expect(fresh!.name.endsWith(DEMO_NAME_SUFFIX)).toBe(true);
    const [tombstone] = await sql<{ deleted_at: Date | null; public_slug: string | null }[]>`
      SELECT deleted_at, public_slug FROM tournaments WHERE id = ${before!.id}
    `;
    expect(tombstone!.deleted_at).not.toBeNull();
    expect(tombstone!.public_slug).toBeNull();
    const children = await sql`SELECT id FROM participants WHERE tournament_id = ${before!.id}`;
    expect(children.length).toBe(0);
    const [restored] = await sql<{ name: string; id: string }[]>`
      SELECT name, id::text AS id FROM organizations WHERE is_demo
    `;
    expect(restored).toEqual({ name: 'Akademi Catur Demo', id: org!.id });
    expect(await realRows()).toMatchObject(REAL);
  }, 120_000);

  it('the guard stops a reset when anything real is in scope, and changes nothing', async () => {
    const tournaments = () => sql`SELECT id FROM tournaments WHERE deleted_at IS NULL ORDER BY id`;
    const before = await tournaments();
    const org = await ops.getOrganization();

    // A person who isn't a demo account inside the demo organization.
    await sql.begin(async (s) => {
      await s`SELECT set_config('app.demo_seed', 'on', true)`;
      await s`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${org!.id}, ${realUser}, 'arbiter')`;
    });
    await expect(demoReset(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    await expect(demoDelete(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    await sql`DELETE FROM organization_members WHERE organization_id = ${org!.id} AND user_id = ${realUser}`;

    // Someone flags a second organization.
    await sql`UPDATE organizations SET is_demo = true WHERE id = ${realOrg}`;
    await expect(demoDelete(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    await sql`UPDATE organizations SET is_demo = false WHERE id = ${realOrg}`;

    // A real entry linked to a demo profile.
    const [profile] = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM player_profiles
      WHERE account_user_id IN (SELECT user_id FROM demo_accounts) LIMIT 1
    `;
    await sql`UPDATE participants SET player_profile_id = ${profile!.id} WHERE id = ${realParticipant}`;
    await expect(demoDelete(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    await sql`UPDATE participants SET player_profile_id = ${realProfile} WHERE id = ${realParticipant}`;

    expect(await tournaments()).toEqual(before);
    expect(await realRows()).toMatchObject({ ...REAL, link: realProfile });
  }, 120_000);

  it('demo:delete removes everything demo, files and accounts included, and nothing real', async () => {
    await demoDelete(ctx);
    const [counts] = await sql<Record<string, number>[]>`
      SELECT
        (SELECT COUNT(*)::int FROM organizations WHERE is_demo) AS orgs,
        (SELECT COUNT(*)::int FROM organizations WHERE slug = ${DEMO_ORG_SLUG}) AS slugs,
        (SELECT COUNT(*)::int FROM demo_accounts) AS accounts,
        (SELECT COUNT(*)::int FROM auth.users WHERE email LIKE '%alokas-demo.invalid') AS users,
        (SELECT COUNT(*)::int FROM tournaments) AS tournaments,
        (SELECT COUNT(*)::int FROM participants) AS participants,
        (SELECT COUNT(*)::int FROM player_profiles) AS profiles
    `;
    expect(counts).toEqual({
      orgs: 0,
      slugs: 0,
      accounts: 0,
      users: 0,
      tournaments: 1,
      participants: 1,
      profiles: 1,
    });
    expect(fake.stored.size).toBe(0);
    expect(await realRows()).toMatchObject({ ...REAL, link: realProfile });
  }, 120_000);

  it('seeds again after a delete, and refuses a real organization holding the slug', async () => {
    await sql`
      INSERT INTO organizations (id, name, slug, verification_status, plan_tier)
      VALUES (${randomUUID()}, 'Someone Real', ${DEMO_ORG_SLUG}, 'verified', 'pro')
    `;
    await expect(demoSeed(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    await sql`DELETE FROM organizations WHERE slug = ${DEMO_ORG_SLUG}`;
    await demoSeed(ctx);
    expect((await ops.getOrganization())?.slug).toBe(DEMO_ORG_SLUG);
    await demoDelete(ctx);
  }, 120_000);

  it('asks for passwords, and refuses short ones', async () => {
    const bare = { ...ctx, env: {} as NodeJS.ProcessEnv };
    await expect(demoSeed(bare)).rejects.toThrow(/DEMO_STAFF_PASSWORD is required/);
    const weak = { ...ctx, env: { DEMO_STAFF_PASSWORD: 'short', DEMO_PLAYER_PASSWORD: 'short' } as NodeJS.ProcessEnv };
    await expect(demoSeed(weak)).rejects.toThrow(/at least 12/);
    expect(demoEmailOf('owner', {})).toBe('demo-owner@alokas-demo.invalid');
  });
});

describe.skipIf(!bbpPairingsAvailable())('FIDE Dutch pairings through bbpPairings', () => {
  it('pairs every demo tournament, with a withdrawal and byes', async () => {
    const account = (label: string) => ({ userId: randomUUID(), email: `${label}@x.invalid`, label });
    const plan = await buildDemoPlan({
      now: new Date('2026-11-02T08:00:00.000Z'),
      organizationId: randomUUID(),
      accounts: {
        owner: account('owner'),
        director: account('director'),
        arbiter: account('arbiter'),
        parent: account('parent'),
        teen: account('teen'),
      },
      capabilities: { formBuilder: false, credentialLock: true },
      style: 'dutch',
    });
    expect(plan.summary.engine).toBe('dutch');
    const live = plan.tournaments[0]!;
    for (const round of [1, 2, 3, 4]) {
      const seen = new Set<string>();
      for (const game of live.games.filter((g) => g.round === round)) {
        for (const id of [game.whiteId, game.blackId]) {
          if (!id) continue;
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(38);
    }
  }, 120_000);
});

describe('MemoryStore ops', () => {
  function memoryInternals(): MemoryStoreInternals {
    return {
      tournaments: new Map(),
      organizations: new Map(),
      organizationMembers: new Map(),
      organizationInvites: new Map(),
      playerProfiles: new Map(),
      participants: new Map(),
      categories: new Map(),
      games: new Map(),
      tables: new Map(),
      gameCards: new Map(),
      registrations: new Map(),
      certificateIssues: new Map(),
      floorAlerts: new Map(),
      pinMeta: new Map(),
      resultEvents: [],
    };
  }

  function memoryAuth(): DemoAuthAdmin {
    const users = new Map<string, string>();
    return {
      findUserIdByEmail: async (email) => users.get(email) ?? null,
      createUser: async ({ email }) => {
        const id = randomUUID();
        users.set(email, id);
        return { id };
      },
      updatePassword: async () => undefined,
      deleteUser: async (id) => {
        for (const [email, value] of users) if (value === id) users.delete(email);
      },
    };
  }

  it('seeds, resets and deletes without touching a real organization or tournament', async () => {
    const internals = memoryInternals();
    const realId = randomUUID();
    const realOrgId = randomUUID();
    internals.organizations.set(realOrgId, { id: realOrgId, slug: 'real', name: 'Real' } as never);
    internals.tournaments.set(realId, { id: realId, name: 'Real', organizationId: realOrgId } as never);
    internals.participants.set('p', { tournamentId: realId });
    const fake = fakeFiles();
    const ctx: DemoRunContext = {
      ops: createMemoryDemoOps(internals),
      auth: memoryAuth(),
      files: fake.files,
      env: ENV,
      log: () => undefined,
      style: 'swiss',
    };
    await demoSeed(ctx);
    expect(internals.tournaments.size).toBeGreaterThan(5);
    const org = await ctx.ops.getOrganization();
    expect(org?.canPublishGlobal).toBe(true);
    await demoSetListed(ctx, false);
    await demoReset(ctx);
    expect((await ctx.ops.getOrganization())?.canPublishGlobal).toBe(false);

    internals.organizations.set(realOrgId, { ...internals.organizations.get(realOrgId)!, isDemo: true });
    await expect(demoDelete(ctx)).rejects.toBeInstanceOf(DemoGuardError);
    internals.organizations.set(realOrgId, { ...internals.organizations.get(realOrgId)!, isDemo: false });

    await demoDelete(ctx);
    expect([...internals.tournaments.keys()]).toEqual([realId]);
    expect(internals.participants.size).toBe(1);
    expect(internals.organizations.size).toBe(1);
    expect(fake.stored.size).toBe(0);
  }, 60_000);
});
