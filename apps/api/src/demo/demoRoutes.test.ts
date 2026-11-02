/**
 * The demo tenant as people meet it: through the real routes, on both stores, with every migration.
 * The same responses the web app and the phone app read.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Organization, Tournament } from '@chess-alokas/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authPlugin } from '../auth.js';
import { MemoryCertificateIssueStore, PostgresCertificateIssueStore } from '../certificates/store.js';
import { MemoryStore, PostgresStore, type Store } from '../db.js';
import { sendResendEmail } from '../lib/resend.js';
import { certificatesPlugin } from '../routes/certificates.js';
import { organizationsPlugin } from '../routes/organizations.js';
import { playerProfilesPlugin } from '../routes/playerProfiles.js';
import { publicLivePlugin } from '../routes/publicLive.js';
import { publicTablesPlugin } from '../routes/publicTables.js';
import { registrationsPlugin } from '../routes/registrations.js';
import { teamPlugin } from '../routes/team.js';
import { DEMO_NAME_SUFFIX, demoEmailDomain } from './constants.js';
import { isDemoPageView } from './guards.js';
import { DEMO_LINKS } from './plan.js';
import {
  demoDelete,
  demoReset,
  demoSeed,
  demoSetListed,
  type DemoAuthAdmin,
  type DemoFileStore,
  type DemoRunContext,
} from './runner.js';

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
  create function auth.role() returns text language sql stable as $$
    select current_setting('request.jwt.claims', true)::jsonb->>'role'
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function auth.role() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

interface Backend {
  store: Store;
  certs: MemoryCertificateIssueStore | PostgresCertificateIssueStore;
  auth: DemoAuthAdmin;
  addUser(id: string, email: string): Promise<void>;
  close(): Promise<void>;
}

function memoryBackend(): Promise<Backend> {
  const users = new Map<string, string>();
  return Promise.resolve({
    store: new MemoryStore(),
    certs: new MemoryCertificateIssueStore(),
    auth: {
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
    },
    addUser: async () => undefined,
    close: async () => undefined,
  });
}

async function postgresBackend(): Promise<Backend> {
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
    auth: {
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
    },
    addUser: async (id, email) => {
      await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${email})`;
    },
    close: async () => {
      await sql.end({ timeout: 1 });
      await server.stop();
      await db.close();
    },
  };
}

const files: DemoFileStore = {
  saveReceipt: async (t, r) => `${t}/${r}.png`,
  saveCertificate: async (t, i) => `${t}/${i}.pdf`,
  deleteReceipt: async () => undefined,
  deleteCertificate: async () => undefined,
};

describe.each([
  ['MemoryStore', memoryBackend],
  ['PostgresStore', postgresBackend],
] as const)('%s', (_name, make) => {
  let backend: Backend;
  let store: Store;
  let app: FastifyInstance;
  let ctx: DemoRunContext;
  let certDir: string;
  const realUser = randomUUID();
  const deleted: string[] = [];

  const as = (userId: string | null) => (userId ? { 'x-test-user-id': userId } : {});

  async function accountId(label: string): Promise<string> {
    return (await store.demo().listAccounts()).find((a) => a.label === label)!.userId;
  }

  async function discover(query = '', userId: string | null = null) {
    const res = await app.inject({
      method: 'GET',
      url: `/public/events${query}`,
      headers: as(userId),
    });
    expect(res.statusCode).toBe(200);
    return res.json().events as Array<{ name: string; isDemo?: boolean; distanceKm: number | null }>;
  }

  beforeAll(async () => {
    process.env['AUTH_DISABLED'] = '1';
    delete process.env['RESEND_API_KEY'];
    certDir = mkdtempSync(path.join(tmpdir(), 'chess-alokas-demo-'));
    process.env['CERTIFICATES_DIR'] = certDir;
    backend = await make();
    store = backend.store;
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      void reply.code(statusCode).send({ error: (error as Error).message });
    });
    await app.register(authPlugin, {
      store,
      deleteAuthUser: async (id) => {
        deleted.push(id);
        return {};
      },
    });
    await app.register(certificatesPlugin, { store, certificateStore: backend.certs });
    await app.register(publicLivePlugin, { store });
    await app.register(publicTablesPlugin, { store });
    await app.register(organizationsPlugin, { store });
    await app.register(teamPlugin, { store });
    await app.register(playerProfilesPlugin, { store });
    await app.register(registrationsPlugin, { store });

    ctx = {
      ops: store.demo(),
      auth: backend.auth,
      files,
      env: {
        DEMO_STAFF_PASSWORD: 'test-staff-password',
        DEMO_PLAYER_PASSWORD: 'test-player-password',
      } as NodeJS.ProcessEnv,
      log: () => undefined,
      style: 'swiss',
    };

    await backend.addUser(realUser, 'real@example.com');
    const now = new Date().toISOString();
    const org: Organization = {
      id: randomUUID(),
      name: 'Real Academy',
      slug: 'real-academy',
      verificationStatus: 'verified',
      planTier: 'pro',
      eventCreditsRemaining: 0,
      canPublishGlobal: true,
      canAcceptPaidRegistrations: true,
      createdAt: now,
      updatedAt: now,
    };
    await store.createOrganization(org, realUser, 'real@example.com');
    await store.createTournament({
      id: randomUUID(),
      name: 'Real Open',
      style: 'swiss',
      rounds: 5,
      status: 'ready',
      currentRound: 0,
      organizationId: org.id,
      ownerId: realUser,
      publicSlug: 'real-open',
      isPublishedGlobal: true,
      registrationOpen: true,
      updatedAt: now,
    } as Tournament);
    await demoSeed(ctx);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await backend?.close();
    rmSync(certDir, { recursive: true, force: true });
  });

  it('Discover shows demo events to everyone while the switch is on, marked isDemo and in the name', async () => {
    const events = await discover();
    const demo = events.filter((e) => e.isDemo);
    expect(demo.length).toBe(4);
    for (const e of demo) expect(e.name.endsWith(DEMO_NAME_SUFFIX)).toBe(true);
    expect(events.find((e) => e.name === 'Real Open')?.isDemo).toBeUndefined();
  });

  it('with the switch off, the public feed is clean, but demo=1 and demo accounts still see them', async () => {
    await demoSetListed(ctx, false);
    const parent = await accountId('parent');
    expect((await discover()).map((e) => e.name)).toEqual(['Real Open']);
    expect((await discover('', realUser)).map((e) => e.name)).toEqual(['Real Open']);
    expect((await discover('?demo=1')).filter((e) => e.isDemo).length).toBe(4);
    expect((await discover('', parent)).filter((e) => e.isDemo).length).toBe(4);

    const direct = await app.inject({ method: 'GET', url: `/public/events/${DEMO_LINKS.slugs.kualaLumpur}` });
    expect(direct.statusCode).toBe(200);
    expect(direct.json().event.isDemo).toBe(true);
    await demoSetListed(ctx, true);
  });

  it('near Cheltenham, the UK event comes first', async () => {
    const events = await discover('?lat=51.9&lng=-2.08&radiusKm=25');
    expect(events.map((e) => e.name)).toEqual([`Cheltenham Rapid Morning${DEMO_NAME_SUFFIX}`]);
    expect(events[0]!.distanceKm).toBeLessThan(25);
  });

  it('the Registration open event looks right on the public page', async () => {
    const res = await app.inject({ method: 'GET', url: `/public/events/${DEMO_LINKS.slugs.kualaLumpur}` });
    const { event, categories, participants } = res.json();
    expect(event.maxParticipants).toBe(64);
    expect(event.entryFeeCents).toBeGreaterThan(0);
    expect(event.registrationOpen).toBe(true);
    expect(Date.parse(event.registrationDeadline)).toBeGreaterThan(Date.now() + 8 * 86_400_000);
    expect(event.paymentInstructions).toContain('DEMO ONLY');
    expect(categories.length).toBe(2);
    expect(participants.length).toBeGreaterThan(10);
  });

  it('the organizer queue has pending, waitlisted, approved and rejected entries, with receipts', async () => {
    const owner = await accountId('owner');
    const [detail] = [await store.getTournamentBySlugOrId(DEMO_LINKS.slugs.kualaLumpur)];
    const res = await app.inject({
      method: 'GET',
      url: `/tournaments/${detail!.id}/registrations`,
      headers: as(owner),
    });
    expect(res.statusCode).toBe(200);
    const regs = res.json().registrations as Array<{ status: string; hasReceipt: boolean }>;
    for (const status of ['pending', 'waitlisted', 'approved', 'rejected']) {
      expect(regs.some((r) => r.status === status)).toBe(true);
    }
    expect(regs.some((r) => r.hasReceipt)).toBe(true);
    expect(regs.some((r) => r.status === 'pending' && !r.hasReceipt)).toBe(true);
  });

  it('the live page and Matchday show a real board, colour and opponent', async () => {
    const live = await app.inject({ method: 'GET', url: `/public/live/${DEMO_LINKS.liveToken}` });
    expect(live.statusCode).toBe(200);
    const body = live.json();
    expect(body.tournament.currentRound).toBe(4);
    expect(body.tournament.rounds).toBe(7);
    expect(body.players.length).toBeGreaterThanOrEqual(38);

    const parent = await accountId('parent');
    const teen = await accountId('teen');
    const profiles = (await store.listPlayerProfiles(parent)).sort((a, b) => a.fullName.localeCompare(b.fullName));
    expect(profiles.map((p) => p.fullName)).toEqual(['Aina Sofea binti Rashid', 'Haziq Danial bin Rashid']);

    const dashboard = async (userId: string, profileId?: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/player/dashboard${profileId ? `?profileId=${profileId}` : ''}`,
        headers: as(userId),
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    };

    const aina = await dashboard(parent, profiles[0]!.id);
    const match = aina.liveMatches[0];
    expect(match.round).toBe(4);
    expect(match.board).toBeGreaterThan(0);
    expect(['white', 'black']).toContain(match.color);
    expect(match.opponentName).toBeTruthy();
    expect(match.result).toBe('pending');
    expect(aina.tournaments.length).toBe(3);
    expect(aina.certificates.length).toBe(2);
    expect(aina.stats.gamesPlayed).toBeGreaterThan(5);

    const haziq = await dashboard(parent, profiles[1]!.id);
    expect(haziq.liveMatches[0].result === 'pending' && !haziq.liveMatches[0].isBye).toBe(false);

    const priya = await dashboard(teen);
    expect(priya.selectedProfile.fullName).toBe('Priya a/p Selvam');
    expect(priya.liveMatches[0].result).toBe('pending');
    expect(priya.certificates.length).toBe(2);
  });

  it('Matchday shows only the event being played, not upcoming ones', async () => {
    const teen = await accountId('teen');
    const res = await app.inject({ method: 'GET', url: '/player/dashboard', headers: as(teen) });
    expect(res.json().liveMatches.map((m: { round: number }) => m.round)).toEqual([4]);
  });

  it('the demo PIN opens a table, even for someone signed in, and a result can be entered', async () => {
    const live = (await store.getTournamentByPublicToken(DEMO_LINKS.liveToken))!;
    const games = await store.listGames(live.id, { round: 4 });
    const open = games.find((g) => g.result === 'pending' && !g.isBye)!;
    const table = (await store.listTables(live.id)).find((t) => t.tableNumber === open.board)!;
    const session = await app.inject({
      method: 'POST',
      url: `/public/tables/${table.slug}/session`,
      payload: { pin: '246810', arbiterName: 'Hakim' },
    });
    expect(session.statusCode).toBe(200);
    const token = session.json().token as string;
    const view = await app.inject({
      method: 'GET',
      url: `/public/tables/${table.slug}`,
      headers: { authorization: 'Bearer someone-signed-in', 'x-arbiter-session': token },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().sessionOk).toBe(true);
    expect(view.json().whiteName).toBeTruthy();
    const wrong = await app.inject({
      method: 'POST',
      url: `/public/tables/${table.slug}/session`,
      payload: { pin: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('demo events take entries only from demo accounts, and demo accounts only enter demo events', async () => {
    const parent = await accountId('parent');
    const enter = (slug: string, userId: string | null) =>
      app.inject({
        method: 'POST',
        url: `/public/events/${slug}/register`,
        headers: as(userId),
        payload: { name: 'Somebody Typed This' },
      });
    const signedOut = await enter(DEMO_LINKS.slugs.penang, null);
    expect(signedOut.statusCode).toBe(403);
    expect(signedOut.json().code).toBe('DEMO_EVENT');
    expect((await enter(DEMO_LINKS.slugs.penang, realUser)).statusCode).toBe(403);
    expect((await enter('real-open', parent)).statusCode).toBe(403);
    expect((await enter(DEMO_LINKS.slugs.penang, parent)).statusCode).toBe(201);
    expect((await enter('real-open', realUser)).statusCode).toBe(201);
  });

  it('sends no email for the demo tenant, and says so', async () => {
    process.env['RESEND_API_KEY'] = 'test-key';
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const owner = await accountId('owner');
      const domain = demoEmailDomain();
      const completed = (await store.getTournamentByPublicToken(DEMO_LINKS.completedToken))!;
      const issued = await app.inject({
        method: 'POST',
        url: `/tournaments/${completed.id}/certificates/issue`,
        headers: as(owner),
        payload: {
          items: [
            {
              type: 'participation',
              recipientName: 'Demo Pawn',
              recipientEmail: 'someone-real@example.com',
              pdfBase64: Buffer.from('%PDF-1.4 demo').toString('base64'),
            },
          ],
        },
      });
      expect(issued.statusCode).toBe(201);
      const issueId = issued.json().issues[0].id as string;
      const quota = await app.inject({
        method: 'GET',
        url: `/tournaments/${completed.id}/certificates/email-quota`,
        headers: as(owner),
      });
      expect(quota.json()).toMatchObject({ demo: true, canSend: true });
      const bulk = await app.inject({
        method: 'POST',
        url: `/tournaments/${completed.id}/certificates/email`,
        headers: as(owner),
        payload: { issueIds: [issueId] },
      });
      expect(bulk.statusCode).toBe(200);
      expect(bulk.json()).toMatchObject({ simulated: true, sent: 0, failed: 0 });
      expect(bulk.json().results).toEqual([
        expect.objectContaining({ id: issueId, status: 'simulated' }),
      ]);
      expect(bulk.json().message).toContain('no email was sent');

      const test = await app.inject({
        method: 'POST',
        url: `/tournaments/${completed.id}/certificates/email-test`,
        headers: { ...as(owner), 'x-test-user-email': `demo-owner@${domain}` },
        payload: { to: 'someone-real@example.com' },
      });
      expect(test.json()).toMatchObject({ simulated: true, sent: false });

      const orgId = (await store.demo().getOrganization())!.id;
      const invite = await app.inject({
        method: 'POST',
        url: `/organizations/${orgId}/invites`,
        headers: as(owner),
        payload: { email: 'someone-real@example.com', role: 'arbiter' },
      });
      expect(invite.statusCode).toBe(403);
      expect(invite.json().code).toBe('DEMO_ORGANIZATION');

      expect(await sendResendEmail({ to: `anyone@${domain}`, subject: 's', html: 'h' })).toMatchObject({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      delete process.env['RESEND_API_KEY'];
    }
  });

  it('demo accounts cannot be deleted, create organizations or accept invites', async () => {
    const parent = await accountId('parent');
    const del = await app.inject({ method: 'DELETE', url: '/me', headers: as(parent) });
    expect(del.statusCode).toBe(403);
    expect(del.json().code).toBe('DEMO_ACCOUNT');
    expect(deleted).toEqual([]);

    const org = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: as(parent),
      payload: { name: 'A Real Sounding Academy' },
    });
    expect(org.statusCode).toBe(403);

    const accept = await app.inject({
      method: 'POST',
      url: '/invites/accept',
      headers: { ...as(parent), 'x-test-user-email': 'demo-parent@alokas-demo.invalid' },
      payload: { token: 'a'.repeat(40) },
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json().code).toBe('DEMO_ACCOUNT');
  });

  it('demo organizations stay out of the admin list, and demo pages out of analytics', async () => {
    const admin = await store.listAllOrganizationsForAdmin();
    expect(admin.map((o) => o.name)).toEqual(['Real Academy']);

    const live = (await store.getTournamentByPublicToken(DEMO_LINKS.liveToken))!;
    expect(await isDemoPageView(store, { path: '/live/x', liveToken: DEMO_LINKS.liveToken })).toBe(true);
    expect(await isDemoPageView(store, { path: '/x', tournamentId: live.id })).toBe(true);
    expect(await isDemoPageView(store, { path: `/register/${DEMO_LINKS.slugs.penang}` })).toBe(true);
    expect(await isDemoPageView(store, { path: '/discover?demo=1' })).toBe(true);
    expect(await isDemoPageView(store, { path: '/register/real-open' })).toBe(false);
    expect(await isDemoPageView(store, { path: '/discover' })).toBe(false);
  });

  it('a reset undoes a visitor, and demo:delete leaves real data as it was', async () => {
    const owner = await accountId('owner');
    const orgId = (await store.demo().getOrganization())!.id;
    await app.inject({
      method: 'PATCH',
      url: `/organizations/${orgId}`,
      headers: as(owner),
      payload: { name: 'Vandalised' },
    });
    await demoReset(ctx);
    expect((await store.getOrganization(orgId))?.name).toBe('Akademi Catur Demo');
    expect((await store.getOrganization(orgId))?.isDemo).toBe(true);

    const pull = await store.pullSince('2020-01-01T00:00:00.000Z', owner);
    const removed = pull.tournaments.filter((t) => t.deletedAt);
    expect(removed.length).toBeGreaterThanOrEqual(6);
    expect(pull.tournaments.filter((t) => !t.deletedAt).length).toBe(6);

    await demoDelete(ctx);
    expect((await discover()).map((e) => e.name)).toEqual(['Real Open']);
    expect((await store.listAllOrganizationsForAdmin()).map((o) => o.name)).toEqual(['Real Academy']);
    expect(await store.demo().getOrganization()).toBeNull();
    expect(await store.demo().listAccounts()).toEqual([]);
    const realEntries = await store.listTournamentRegistrations(
      (await store.getTournamentBySlugOrId('real-open'))!.id,
    );
    expect(realEntries.map((r) => r.playerSnapshot.name)).toEqual(['Somebody Typed This']);
  }, 120_000);
});
