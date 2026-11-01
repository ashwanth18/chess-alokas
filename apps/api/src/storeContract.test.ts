/**
 * The security and sync rules, run through the real routes against both stores. The
 * Postgres half runs the real PostgresStore on PGlite with every migration applied, so
 * SQL, triggers and transactions are exercised as well as the application logic.
 *
 * PGlite is one backend behind a one-connection pool, so "concurrent" requests here
 * interleave only at transaction boundaries. These tests prove the logic and that the
 * locking SQL is valid; they can't prove row-lock behaviour between real backends.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Game, Organization, Participant, Tournament } from '@chess-alokas/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertAuthConfiguredForProduction, confirmedEmailOf, requireAuth } from './auth.js';
import {
  MemoryCertificateIssueStore,
  PostgresCertificateIssueStore,
  type CertificateIssueStore,
} from './certificates/store.js';
import { MemoryStore, PostgresStore, type Store } from './db.js';
import { certificatesPlugin } from './routes/certificates.js';
import { floorPlugin } from './routes/floor.js';
import { organizationsPlugin } from './routes/organizations.js';
import { hashInviteToken, teamPlugin } from './routes/team.js';
import { pairingPlugin } from './routes/pairing.js';
import { publicLivePlugin } from './routes/publicLive.js';
import { playerProfilesPlugin } from './routes/playerProfiles.js';
import { publicTablesPlugin } from './routes/publicTables.js';
import { registrationsPlugin } from './routes/registrations.js';
import { syncPlugin } from './routes/sync.js';
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

interface Backend {
  store: Store;
  certs: CertificateIssueStore;
  addUser(id: string): Promise<void>;
  addMember(orgId: string, userId: string, role: string): Promise<void>;
  auditEvents(gameId: string): Promise<Array<{ result: string; note: string | null }>>;
  /** Makes a tournament look last written a day ago, so it sits behind a recent sync cursor. */
  ageTournament(id: string): Promise<void>;
  close(): Promise<void>;
}

async function memoryBackend(): Promise<Backend> {
  const store = new MemoryStore();
  const internals = store as unknown as {
    organizationMembers: Map<string, unknown>;
    tournaments: { stamps: Map<string, string> };
    resultEvents: Array<{ gameId: string; result: string; note: string | null }>;
  };
  return {
    store,
    certs: new MemoryCertificateIssueStore(),
    addUser: async () => undefined,
    addMember: async (organizationId, userId, role) => {
      internals.organizationMembers.set(`${organizationId}:${userId}`, {
        organizationId,
        userId,
        role,
        createdAt: new Date().toISOString(),
      });
    },
    auditEvents: async (gameId) => internals.resultEvents.filter((e) => e.gameId === gameId),
    ageTournament: async (id) => {
      internals.tournaments.stamps.set(id, new Date(Date.now() - 86_400_000).toISOString());
    },
    close: async () => undefined,
  };
}

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

async function postgresBackend(): Promise<Backend> {
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
  // One connection: anything inside a transaction that wrongly uses the outer pool hangs,
  // so these tests also catch queries that escape their transaction.
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
    addMember: async (orgId, userId, role) => {
      await sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (${orgId}, ${userId}, ${role})
      `;
    },
    auditEvents: async (gameId) =>
      sql<{ result: string; note: string | null }[]>`
        SELECT result, note FROM game_result_events WHERE game_id = ${gameId}
      `,
    ageTournament: async (id) => {
      // A trigger stamps server_updated_at on every write.
      await sql`ALTER TABLE tournaments DISABLE TRIGGER USER`;
      await sql`UPDATE tournaments SET server_updated_at = now() - interval '1 day' WHERE id = ${id}`;
      await sql`ALTER TABLE tournaments ENABLE TRIGGER USER`;
    },
    close: async () => {
      await sql.end({ timeout: 1 });
      await server.stop();
      await db.close();
    },
  };
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;
/** MemoryStore can finish two writes in one millisecond, and an equal timestamp is a no-op. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');

describe.each([
  ['MemoryStore', memoryBackend],
  ['PostgresStore', postgresBackend],
] as const)('%s', (_name, makeBackend) => {
  let backend: Backend;
  let store: Store;
  let app: FastifyInstance;
  let certDir: string;

  beforeAll(async () => {
    process.env['AUTH_DISABLED'] = '1';
    certDir = mkdtempSync(path.join(tmpdir(), 'chess-alokas-certs-'));
    process.env['CERTIFICATES_DIR'] = certDir;
    delete process.env['RESEND_API_KEY'];
    backend = await makeBackend();
    store = backend.store;
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      void reply.code(statusCode).send({ error: (error as Error).message });
    });
    await app.register(tournamentsPlugin, { store });
    await app.register(pairingPlugin, { store });
    await app.register(syncPlugin, { store });
    await app.register(certificatesPlugin, { store, certificateStore: backend.certs });
    await app.register(publicTablesPlugin, { store });
    await app.register(publicLivePlugin, { store });
    await app.register(floorPlugin, { store });
    await app.register(organizationsPlugin, { store });
    await app.register(teamPlugin, { store });
    await app.register(playerProfilesPlugin, { store });
    await app.register(registrationsPlugin, { store });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await backend?.close();
    rmSync(certDir, { recursive: true, force: true });
  });

  async function newUser(): Promise<string> {
    const id = crypto.randomUUID();
    await backend.addUser(id);
    return id;
  }

  async function call(
    user: string | null,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method,
      url,
      payload: payload as never,
      headers: { ...(user ? { 'x-test-user-id': user } : {}), ...headers },
    });
    let body: any = res.body;
    try {
      body = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body };
  }

  /** A client that reads rejected[] (`strict` off). */
  const push = (user: string, items: unknown[]) =>
    call(user, 'POST', '/sync/push', { clientId: 'test', items, reportRejections: true });
  /** A client from before rejected[] existed. */
  const legacyPush = (user: string, items: unknown[]) =>
    call(user, 'POST', '/sync/push', { clientId: 'test', items });

  const tournamentItem = (id: string, extra: Record<string, unknown> = {}, updatedAt = iso()) => ({
    entity: 'tournament',
    id,
    payload: { name: 'Pushed', style: 'swiss', rounds: 5, status: 'draft', ...extra },
    updatedAt,
    deletedAt: null as string | null,
  });
  const participantItem = (tournamentId: string, extra: Record<string, unknown> = {}) => ({
    entity: 'participant',
    id: crypto.randomUUID(),
    payload: { tournamentId, name: 'Player', age: 10, ...extra },
    updatedAt: iso(),
    deletedAt: null as string | null,
  });

  function tournamentRow(owner: string | null, extra: Partial<Tournament> = {}): Tournament {
    return {
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
      organizationId: null,
      updatedAt: iso(-HOUR),
      ...extra,
    };
  }

  async function seedTournament(owner: string | null, extra: Partial<Tournament> = {}) {
    if (owner === null) {
      return store.createTournament(tournamentRow(null, extra));
    }
    // Direct seeding, so tests aren't limited by the one-tournament no-org allowance.
    const orgId = extra.organizationId ?? (await verifiedOrg(owner)).id;
    return store.createTournament(tournamentRow(owner, { organizationId: orgId, ...extra }));
  }

  async function seedPlayer(tournamentId: string, extra: Partial<Participant> = {}) {
    return store.createParticipant({
      id: crypto.randomUUID(),
      tournamentId,
      name: 'Seeded Player',
      age: 10,
      gender: null,
      rating: null,
      club: null,
      customFields: {},
      categoryIds: [],
      updatedAt: iso(-HOUR),
      ...extra,
    } as Participant);
  }

  async function seedBoard(tournamentId: string, extra: Partial<Game> = {}) {
    const category = await store.createCategory({
      id: crypto.randomUUID(),
      tournamentId,
      name: 'Open',
      filter: { logic: 'and', rules: [] },
      sortOrder: 0,
      prizePlaces: null,
      updatedAt: iso(-HOUR),
    });
    const white = await seedPlayer(tournamentId, { name: 'White' });
    const black = await seedPlayer(tournamentId, { name: 'Black' });
    const game = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId,
      categoryId: category.id,
      round: 1,
      board: 1,
      whiteId: white.id,
      blackId: black.id,
      result: 'pending',
      isBye: false,
      updatedAt: iso(-HOUR),
      ...extra,
    });
    const syncPayload = {
      tournamentId,
      categoryId: category.id,
      round: game.round,
      board: game.board,
      whiteId: white.id,
      blackId: black.id,
      result: 'pending',
      isBye: false,
    };
    return { category, white, black, game, syncPayload };
  }

  async function makeOrg(owner: string, name = `Org ${crypto.randomUUID()}`): Promise<Organization> {
    const res = await call(owner, 'POST', '/organizations', { name });
    expect(res.status).toBe(201);
    return res.body.organization;
  }

  /** Verified Pro organization: no quota in the way of whatever the test is about. */
  async function verifiedOrg(owner: string, patch: Partial<Organization> = {}) {
    const org = await makeOrg(owner);
    const updated = await store.adminUpdateOrganization(org.id, {
      verificationStatus: 'verified',
      planTier: 'pro',
      maxTournamentsQuota: null,
      maxPlayersPerTournament: null,
      canPublishGlobal: true,
      canAcceptPaidRegistrations: true,
      ...patch,
    });
    return updated!;
  }

  describe('team: invites and members', () => {
    const emailOf = (user: string) => `${user}@example.com`;
    const as = (user: string) => ({ 'x-test-user-email': emailOf(user) });
    const freshEmail = () => `${crypto.randomUUID()}@example.com`;
    const since = (offsetMs: number) => `/sync/pull?since=${encodeURIComponent(iso(offsetMs))}`;

    async function invite(actor: string, orgId: string, email: string, role: string) {
      return call(actor, 'POST', `/organizations/${orgId}/invites`, { email, role });
    }

    const tokenOf = (inviteUrl: string) => inviteUrl.slice(inviteUrl.lastIndexOf('/') + 1);

    async function join(actor: string, orgId: string, role: string): Promise<string> {
      const user = await newUser();
      const sent = await invite(actor, orgId, emailOf(user), role);
      expect(sent.status).toBe(201);
      const accepted = await call(
        user,
        'POST',
        '/invites/accept',
        { token: tokenOf(sent.body.inviteUrl) },
        as(user),
      );
      expect(accepted.status).toBe(200);
      return user;
    }

    async function orgWithOwner() {
      const owner = await newUser();
      return { owner, org: await verifiedOrg(owner) };
    }

    async function orgTournament(user: string, orgId: string): Promise<string> {
      const created = await call(user, 'POST', '/tournaments', {
        name: 'Club Open',
        organizationId: orgId,
      });
      expect(created.status).toBe(201);
      return created.body.id;
    }

    it('takes someone from invite to member, once, and stores only a hash of the token', async () => {
      const { owner, org } = await orgWithOwner();
      const user = await newUser();
      const sent = await invite(owner, org.id, emailOf(user).toUpperCase(), 'director');
      expect(sent.status).toBe(201);
      expect(sent.body.emailStatus).toBe('not_configured');
      expect(sent.body.invite.email).toBe(emailOf(user));
      expect(JSON.stringify(sent.body.invite)).not.toMatch(/tokenHash|token_hash/);
      const token = tokenOf(sent.body.inviteUrl);
      expect(token.length).toBeGreaterThanOrEqual(40);
      expect(await store.findOrganizationInviteByTokenHash(token)).toBeNull();
      expect(
        (await store.findOrganizationInviteByTokenHash(hashInviteToken(token)))?.invite.id,
      ).toBe(sent.body.invite.id);

      const listed = await call(owner, 'GET', `/organizations/${org.id}/invites`);
      expect(listed.body.invites).toHaveLength(1);
      expect(listed.body.invites[0].status).toBe('pending');

      const accepted = await call(user, 'POST', '/invites/accept', { token }, as(user));
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ ok: true, role: 'director', alreadyMember: false });

      const members = await call(owner, 'GET', `/organizations/${org.id}/members`);
      expect(members.body.yourRole).toBe('owner');
      expect(members.body.members.find((m: { userId: string }) => m.userId === user).email).toBe(
        emailOf(user),
      );
      expect((await call(owner, 'GET', `/organizations/${org.id}/invites`)).body.invites).toEqual([]);

      const again = await call(user, 'POST', '/invites/accept', { token }, as(user));
      expect(again.status).toBe(410);
      expect(again.body.code).toBe('used');
    });

    it('the public lookup masks the address and says how the viewer stands', async () => {
      const { owner, org } = await orgWithOwner();
      const user = await newUser();
      const sent = await invite(owner, org.id, emailOf(user), 'arbiter');
      const token = tokenOf(sent.body.inviteUrl);
      const lookup = (who: string | null, headers: Record<string, string> = {}) =>
        call(who, 'POST', '/public/invites/lookup', { token }, headers);

      const anon = await lookup(null);
      expect(anon.status).toBe(200);
      expect(anon.body).toMatchObject({
        status: 'pending',
        organizationName: org.name,
        role: 'arbiter',
        viewer: 'signed_out',
      });
      expect(JSON.stringify(anon.body)).not.toContain(user);
      expect(JSON.stringify(anon.body)).not.toMatch(/organizationId|invitedBy/);
      expect((await lookup(user)).body.viewer).toBe('unconfirmed');
      expect((await lookup(user, as(user))).body.viewer).toBe('match');
      const other = await newUser();
      expect((await lookup(other, as(other))).body.viewer).toBe('wrong_email');
      const missing = await call(null, 'POST', '/public/invites/lookup', { token: 'x'.repeat(43) });
      expect(missing.status).toBe(404);
    });

    it('refuses a different or unconfirmed address, and leaves the invite usable', async () => {
      const { owner, org } = await orgWithOwner();
      const user = await newUser();
      const other = await newUser();
      const sent = await invite(owner, org.id, emailOf(user), 'admin');
      const token = tokenOf(sent.body.inviteUrl);

      const wrong = await call(other, 'POST', '/invites/accept', { token }, as(other));
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('wrong_email');
      const unconfirmed = await call(user, 'POST', '/invites/accept', { token });
      expect(unconfirmed.status).toBe(403);
      expect(unconfirmed.body.code).toBe('email_unconfirmed');
      expect(await store.getOrganizationMemberRole(org.id, other)).toBeNull();

      expect((await call(user, 'POST', '/invites/accept', { token }, as(user))).status).toBe(200);
    });

    it('refuses expired and revoked invites, and an old link after a resend', async () => {
      const { owner, org } = await orgWithOwner();
      const user = await newUser();
      const sent = await invite(owner, org.id, emailOf(user), 'director');
      const oldToken = tokenOf(sent.body.inviteUrl);

      const resent = await call(
        owner,
        'POST',
        `/organizations/${org.id}/invites/${sent.body.invite.id}/resend`,
        { sendEmail: false },
      );
      expect(resent.status).toBe(200);
      expect(resent.body.emailStatus).toBe('skipped');
      expect(tokenOf(resent.body.inviteUrl)).not.toBe(oldToken);
      const dead = await call(user, 'POST', '/invites/accept', { token: oldToken }, as(user));
      expect(dead.status).toBe(404);

      const expiredToken = crypto.randomUUID() + crypto.randomUUID();
      await store.rotateOrganizationInvite(
        org.id,
        sent.body.invite.id,
        hashInviteToken(expiredToken),
        iso(-HOUR),
      );
      const expired = await call(user, 'POST', '/invites/accept', { token: expiredToken }, as(user));
      expect(expired.status).toBe(410);
      expect(expired.body.code).toBe('expired');

      // An expired invite doesn't block a new one for the same address.
      const replacement = await invite(owner, org.id, emailOf(user), 'director');
      expect(replacement.status).toBe(201);
      const removed = await call(
        owner,
        'DELETE',
        `/organizations/${org.id}/invites/${replacement.body.invite.id}`,
      );
      expect(removed.status).toBe(204);
      const revoked = await call(
        user,
        'POST',
        '/invites/accept',
        { token: tokenOf(replacement.body.inviteUrl) },
        as(user),
      );
      expect(revoked.status).toBe(410);
      expect(revoked.body.code).toBe('revoked');
    });

    it('allows one open invite per address, and none for a member', async () => {
      const { owner, org } = await orgWithOwner();
      const email = freshEmail();
      expect((await invite(owner, org.id, email, 'arbiter')).status).toBe(201);
      expect((await invite(owner, org.id, email, 'admin')).status).toBe(409);
      const member = await join(owner, org.id, 'arbiter');
      expect((await invite(owner, org.id, emailOf(member), 'admin')).status).toBe(409);
    });

    it('an accepted invite does not change the role of an existing member', async () => {
      const { owner, org } = await orgWithOwner();
      const user = await newUser();
      await backend.addMember(org.id, user, 'admin');
      const sent = await invite(owner, org.id, emailOf(user), 'arbiter');
      const res = await call(
        user,
        'POST',
        '/invites/accept',
        { token: tokenOf(sent.body.inviteUrl) },
        as(user),
      );
      expect(res.body).toMatchObject({ role: 'admin', alreadyMember: true });
      expect(await store.getOrganizationMemberRole(org.id, user)).toBe('admin');
    });

    it('lets only owners and admins manage the team, and never above their own role', async () => {
      const { owner, org } = await orgWithOwner();
      const admin = await join(owner, org.id, 'admin');
      const director = await join(owner, org.id, 'director');
      const arbiter = await join(owner, org.id, 'arbiter');
      const members = `/organizations/${org.id}/members`;

      expect((await invite(admin, org.id, freshEmail(), 'owner')).status).toBe(403);
      expect((await invite(admin, org.id, freshEmail(), 'admin')).status).toBe(201);
      expect((await invite(owner, org.id, freshEmail(), 'owner')).status).toBe(201);
      for (const user of [director, arbiter]) {
        expect((await invite(user, org.id, freshEmail(), 'arbiter')).status).toBe(403);
        expect((await call(user, 'GET', `/organizations/${org.id}/invites`)).status).toBe(403);
        expect((await call(user, 'GET', members)).status).toBe(200);
        expect((await call(user, 'PATCH', `${members}/${arbiter}`, { role: 'owner' })).status).toBe(403);
        expect((await call(user, 'DELETE', `${members}/${owner}`)).status).toBe(403);
      }

      expect((await call(admin, 'PATCH', `${members}/${director}`, { role: 'owner' })).status).toBe(403);
      expect((await call(admin, 'PATCH', `${members}/${admin}`, { role: 'owner' })).status).toBe(403);
      expect((await call(admin, 'PATCH', `${members}/${owner}`, { role: 'arbiter' })).status).toBe(403);
      expect((await call(admin, 'DELETE', `${members}/${owner}`)).status).toBe(403);
      expect((await call(admin, 'PATCH', `${members}/${director}`, { role: 'arbiter' })).status).toBe(200);
      expect(await store.getOrganizationMemberRole(org.id, director)).toBe('arbiter');
      expect((await call(admin, 'DELETE', `${members}/${director}`)).status).toBe(204);
      expect(await store.getOrganizationMemberRole(org.id, director)).toBeNull();
    });

    it('an admin cannot resend or revoke an invite for an owner', async () => {
      const { owner, org } = await orgWithOwner();
      const admin = await join(owner, org.id, 'admin');
      const sent = await invite(owner, org.id, freshEmail(), 'owner');
      const path = `/organizations/${org.id}/invites/${sent.body.invite.id}`;
      expect((await call(admin, 'POST', `${path}/resend`, {})).status).toBe(403);
      expect((await call(admin, 'DELETE', path)).status).toBe(403);
    });

    it('keeps other organizations out', async () => {
      const a = await orgWithOwner();
      const b = await orgWithOwner();
      const sent = await invite(a.owner, a.org.id, freshEmail(), 'director');
      const inviteId = sent.body.invite.id;
      const orgA = `/organizations/${a.org.id}`;

      const attempts: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
        ['GET', `${orgA}/members`],
        ['GET', `${orgA}/invites`],
        ['POST', `${orgA}/invites`, { email: freshEmail(), role: 'owner' }],
        ['POST', `${orgA}/invites/${inviteId}/resend`, {}],
        ['DELETE', `${orgA}/invites/${inviteId}`],
        ['PATCH', `${orgA}/members/${a.owner}`, { role: 'arbiter' }],
        ['DELETE', `${orgA}/members/${a.owner}`],
        ['POST', `${orgA}/leave`],
      ];
      for (const [method, url, body] of attempts) {
        const res = await call(b.owner, method, url, body);
        expect(res.status, `${method} ${url}`).toBe(403);
      }
      // A's records through B's organization, where B's owner does have rights.
      const orgB = `/organizations/${b.org.id}`;
      expect((await call(b.owner, 'POST', `${orgB}/invites/${inviteId}/resend`, {})).status).toBe(404);
      expect((await call(b.owner, 'DELETE', `${orgB}/invites/${inviteId}`)).status).toBe(404);
      expect((await call(b.owner, 'DELETE', `${orgB}/members/${a.owner}`)).status).toBe(404);
      expect((await call(a.owner, 'GET', '/organizations/not-a-uuid/members')).status).toBe(404);
      expect((await store.listOrganizationInvites(a.org.id)).map((i) => i.id)).toContain(inviteId);
      expect(await store.getOrganizationMemberRole(a.org.id, a.owner)).toBe('owner');
    });

    it('never leaves an organization without an owner', async () => {
      const { owner, org } = await orgWithOwner();
      const members = `/organizations/${org.id}/members`;
      expect((await call(owner, 'POST', `/organizations/${org.id}/leave`)).status).toBe(409);
      expect((await call(owner, 'DELETE', `${members}/${owner}`)).status).toBe(409);
      expect((await call(owner, 'PATCH', `${members}/${owner}`, { role: 'admin' })).status).toBe(409);
      expect(await store.getOrganizationMemberRole(org.id, owner)).toBe('owner');

      const second = await join(owner, org.id, 'owner');
      expect((await call(owner, 'POST', `/organizations/${org.id}/leave`)).status).toBe(204);
      expect(await store.getOrganizationMemberRole(org.id, owner)).toBeNull();
      expect((await call(second, 'POST', `/organizations/${org.id}/leave`)).status).toBe(409);
    });

    it('a director runs tournaments the organization already had', async () => {
      const { owner, org } = await orgWithOwner();
      const id = await orgTournament(owner, org.id);
      const director = await join(owner, org.id, 'director');

      expect((await call(director, 'GET', `/tournaments/${id}`)).status).toBe(200);
      expect((await call(director, 'GET', `/tournaments/${id}/floor/tables`)).status).toBe(200);
      const pushed = await push(director, [tournamentItem(id, { name: 'Renamed' }, iso())]);
      expect(pushed.body.accepted).toBe(1);
      expect((await store.getTournament(id))?.name).toBe('Renamed');
      await orgTournament(director, org.id);
    });

    it('sync delivers older tournaments to someone who joined after their last sync', async () => {
      const { owner, org } = await orgWithOwner();
      const id = await orgTournament(owner, org.id);
      await backend.ageTournament(id);

      const director = await join(owner, org.id, 'director');
      const pulled = await call(director, 'GET', since(-5 * 60_000));
      expect(pulled.body.tournaments.map((t: { id: string }) => t.id)).toContain(id);
    });

    it('gives an arbiter floor duty and nothing else', async () => {
      const { owner, org } = await orgWithOwner();
      const id = await orgTournament(owner, org.id);
      const prepared = await call(owner, 'POST', `/tournaments/${id}/floor/prepare`, {
        tableCount: 2,
        pinRound: 1,
        rotatePin: false,
      });
      expect(prepared.status).toBe(200);
      const arbiter = await join(owner, org.id, 'arbiter');

      const tables = await call(arbiter, 'GET', `/tournaments/${id}/floor/tables`);
      expect(tables.status).toBe(200);
      expect(tables.body.tables).toHaveLength(2);
      const pin = await call(arbiter, 'POST', `/tournaments/${id}/floor/rotate-pin`, { pinRound: 1 });
      expect(pin.status).toBe(200);
      expect(pin.body.arbiterPin).toBeTruthy();
      expect((await call(arbiter, 'GET', `/tournaments/${id}/floor/alerts`)).status).toBe(200);
      const listed = await call(arbiter, 'GET', '/tournaments');
      expect(listed.body.map((t: { id: string }) => t.id)).toContain(id);

      expect((await call(arbiter, 'GET', `/tournaments/${id}`)).status).toBe(403);
      expect(
        (
          await call(arbiter, 'POST', `/tournaments/${id}/floor/prepare`, {
            tableCount: 9,
            pinRound: 1,
          })
        ).status,
      ).toBe(403);
      expect((await call(arbiter, 'POST', `/tournaments/${id}/rounds/1/pair`, {})).status).toBe(403);
      expect((await call(arbiter, 'PATCH', `/tournaments/${id}`, { name: 'Nope' })).status).toBe(403);
      const pushed = await push(arbiter, [tournamentItem(id, { name: 'Nope' }, iso())]);
      expect(pushed.body.rejected[0].code).toBe('forbidden');
      expect((await call(arbiter, 'GET', since(-HOUR))).body.tournaments).toEqual([]);
      const certs = await call(arbiter, 'POST', `/tournaments/${id}/certificates/reserve-serials`, {
        count: 1,
      });
      expect(certs.status).toBe(403);

      const stranger = await newUser();
      expect((await call(stranger, 'GET', `/tournaments/${id}/floor/tables`)).status).toBe(403);
      expect(
        (await call(stranger, 'POST', `/tournaments/${id}/floor/rotate-pin`, { pinRound: 1 })).status,
      ).toBe(403);
    });

    it('takes away access through tournaments someone created when they leave or drop to arbiter', async () => {
      const { owner, org } = await orgWithOwner();
      const removed = await join(owner, org.id, 'director');
      const demoted = await join(owner, org.id, 'director');
      const removedEvent = await orgTournament(removed, org.id);
      const demotedEvent = await orgTournament(demoted, org.id);
      const members = `/organizations/${org.id}/members`;

      expect((await call(owner, 'DELETE', `${members}/${removed}`)).status).toBe(204);
      expect((await call(removed, 'GET', `/tournaments/${removedEvent}`)).status).toBe(403);
      const late = await push(removed, [tournamentItem(removedEvent, { name: 'Late' }, iso())]);
      expect(late.body.rejected[0].code).toBe('forbidden');
      expect((await store.getTournament(removedEvent))?.ownerId).toBe(owner);
      expect((await call(removed, 'GET', since(-HOUR))).body.tournaments).toEqual([]);

      expect((await call(owner, 'PATCH', `${members}/${demoted}`, { role: 'arbiter' })).status).toBe(200);
      expect((await call(demoted, 'GET', `/tournaments/${demotedEvent}`)).status).toBe(403);
      expect((await store.getTournament(demotedEvent))?.ownerId).toBe(owner);
      expect((await call(owner, 'GET', `/tournaments/${demotedEvent}`)).status).toBe(200);
    });

    it('a creator who leaves is not an owner any more', async () => {
      const { owner: creator, org } = await orgWithOwner();
      const heir = await join(creator, org.id, 'owner');
      expect((await call(creator, 'POST', `/organizations/${org.id}/leave`)).status).toBe(204);
      expect((await store.getOrganization(org.id))?.createdBy).toBe(heir);
      expect(await store.isOrganizationMember(org.id, creator)).toBe(false);
      expect((await store.listUserOrganizations(creator)).map((o) => o.id)).not.toContain(org.id);
      expect((await call(creator, 'GET', `/organizations/${org.id}/members`)).status).toBe(403);
    });

    describe('choosing an organization for a new tournament', () => {
      async function inTwoOrgs() {
        const { org: club } = await orgWithOwner();
        const person = await newUser();
        await backend.addMember(club.id, person, 'director');
        await tick();
        const own = await verifiedOrg(person);
        return { person, club, own };
      }

      it('honours a choice other than the default, through the route and through sync', async () => {
        const { person, club } = await inTwoOrgs();
        const created = await call(person, 'POST', '/tournaments', {
          name: 'For the club',
          organizationId: club.id,
        });
        expect(created.status).toBe(201);
        expect(created.body.organizationId).toBe(club.id);

        const id = crypto.randomUUID();
        const pushed = await push(person, [tournamentItem(id, { organizationId: club.id })]);
        expect(pushed.body.rejected).toEqual([]);
        expect((await store.getTournament(id))?.organizationId).toBe(club.id);
      });

      it('refuses another tenant, through the route and through sync', async () => {
        const { person } = await inTwoOrgs();
        const { org: elsewhere } = await orgWithOwner();
        const viaRoute = await call(person, 'POST', '/tournaments', {
          name: 'Planted',
          organizationId: elsewhere.id,
        });
        expect(viaRoute.status).toBe(403);

        const id = crypto.randomUUID();
        const pushed = await push(person, [tournamentItem(id, { organizationId: elsewhere.id })]);
        expect(pushed.body.rejected[0].code).toBe('forbidden_organization');
        expect(await store.getTournament(id)).toBeNull();
        const legacy = await legacyPush(person, [
          tournamentItem(crypto.randomUUID(), { organizationId: elsewhere.id }),
        ]);
        expect(legacy.status).toBe(403);
      });

      it('refuses an organization where the role cannot create, or after losing it', async () => {
        const { owner, org } = await orgWithOwner();
        const arbiter = await join(owner, org.id, 'arbiter');
        const director = await join(owner, org.id, 'director');
        for (const user of [arbiter]) {
          expect(
            (await call(user, 'POST', '/tournaments', { name: 'No', organizationId: org.id })).status,
          ).toBe(403);
          const pushed = await push(user, [
            tournamentItem(crypto.randomUUID(), { organizationId: org.id }),
          ]);
          expect(pushed.body.rejected[0].code).toBe('forbidden_organization');
        }
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${director}`);
        const late = await push(director, [
          tournamentItem(crypto.randomUUID(), { organizationId: org.id }),
        ]);
        expect(late.body.rejected[0].code).toBe('forbidden_organization');
      });

      it('sync never moves an existing tournament to the other organization', async () => {
        const { person, club, own } = await inTwoOrgs();
        const id = await orgTournament(person, own.id);
        await tick();
        const pushed = await push(person, [tournamentItem(id, { organizationId: club.id }, iso())]);
        expect(pushed.body.accepted).toBe(1);
        expect((await store.getTournament(id))?.organizationId).toBe(own.id);
      });

      it('counts a trial tournament against the chosen organization', async () => {
        const { person, club } = await inTwoOrgs();
        const owner2 = await newUser();
        const trial = await makeOrg(owner2);
        await backend.addMember(trial.id, person, 'director');
        expect(trial.planTier).toBe('trial');
        const first = await call(person, 'POST', '/tournaments', {
          name: 'First',
          organizationId: trial.id,
        });
        expect(first.status).toBe(201);
        const second = await call(person, 'POST', '/tournaments', {
          name: 'Second',
          organizationId: trial.id,
        });
        expect(second.status).toBe(403);
        const elsewhere = await call(person, 'POST', '/tournaments', {
          name: 'Elsewhere',
          organizationId: club.id,
        });
        expect(elsewhere.status).toBe(201);
      });
    });

    describe('telling a device which tournaments it may no longer hold', () => {
      const revokedFor = async (user: string) => {
        const res = await call(user, 'GET', since(HOUR));
        expect(res.status).toBe(200);
        return res.body.revokedTournamentIds as string[];
      };

      it('lists nothing for someone who lost nothing, and names the user', async () => {
        const { owner, org } = await orgWithOwner();
        await orgTournament(owner, org.id);
        const director = await join(owner, org.id, 'director');
        const res = await call(director, 'GET', since(HOUR));
        expect(res.body.revokedTournamentIds).toEqual([]);
        expect(res.body.revokedForUserId).toBe(director);
      });

      it('lists tournaments after removal and after leaving, soft-deleted ones included', async () => {
        const { owner, org } = await orgWithOwner();
        const kept = await orgTournament(owner, org.id);
        const gone = await orgTournament(owner, org.id);
        await tick();
        const deleted = { ...tournamentItem(gone, {}, iso()), deletedAt: iso() };
        expect((await push(owner, [deleted])).body.accepted).toBe(1);
        const removed = await join(owner, org.id, 'director');
        const leaver = await join(owner, org.id, 'admin');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${removed}`);
        await call(leaver, 'POST', `/organizations/${org.id}/leave`);
        expect(await revokedFor(removed)).toEqual(expect.arrayContaining([kept, gone]));
        expect(await revokedFor(leaver)).toEqual(expect.arrayContaining([kept]));
        expect(await revokedFor(owner)).toEqual([]);
      });

      it('lists tournaments the removed member created, now handed over', async () => {
        const { owner, org } = await orgWithOwner();
        const director = await join(owner, org.id, 'director');
        const theirs = await orgTournament(director, org.id);
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${director}`);
        expect(await revokedFor(director)).toEqual([theirs]);
      });

      it('lists tournaments on dropping to arbiter, and stops on promotion back', async () => {
        const { owner, org } = await orgWithOwner();
        const id = await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'director');
        const path = `/organizations/${org.id}/members/${member}`;
        await call(owner, 'PATCH', path, { role: 'arbiter' });
        expect(await revokedFor(member)).toEqual([id]);
        await call(owner, 'PATCH', path, { role: 'director' });
        expect(await revokedFor(member)).toEqual([]);
      });

      it('does not list anything for a change between roles that keep access', async () => {
        const { owner, org } = await orgWithOwner();
        await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'admin');
        await call(owner, 'PATCH', `/organizations/${org.id}/members/${member}`, { role: 'director' });
        expect(await revokedFor(member)).toEqual([]);
      });

      it('stops listing when someone is invited back', async () => {
        const { owner, org } = await orgWithOwner();
        await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'director');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${member}`);
        expect(await revokedFor(member)).toHaveLength(1);
        const sent = await invite(owner, org.id, emailOf(member), 'director');
        await call(member, 'POST', '/invites/accept', { token: tokenOf(sent.body.inviteUrl) }, as(member));
        expect(await revokedFor(member)).toEqual([]);
      });

      it('keeps listing when someone is invited back as an arbiter', async () => {
        const { owner, org } = await orgWithOwner();
        const id = await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'director');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${member}`);
        const sent = await invite(owner, org.id, emailOf(member), 'arbiter');
        await call(member, 'POST', '/invites/accept', { token: tokenOf(sent.body.inviteUrl) }, as(member));
        expect(await revokedFor(member)).toEqual([id]);
      });

      it('applies to this user only: another member and a stranger are told nothing', async () => {
        const { owner, org } = await orgWithOwner();
        await orgTournament(owner, org.id);
        const removed = await join(owner, org.id, 'director');
        const colleague = await join(owner, org.id, 'director');
        const stranger = await newUser();
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${removed}`);
        expect(await revokedFor(removed)).toHaveLength(1);
        expect(await revokedFor(colleague)).toEqual([]);
        expect(await revokedFor(stranger)).toEqual([]);
      });

      it('leaves out a tournament they can still reach some other way', async () => {
        const { owner, org } = await orgWithOwner();
        const id = await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'director');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${member}`);
        await backend.addMember(org.id, member, 'director');
        expect(await revokedFor(member)).toEqual([]);
        expect(id).toBeTruthy();
      });

      it('does not list tournaments the organization creates afterwards', async () => {
        const { owner, org } = await orgWithOwner();
        const before = await orgTournament(owner, org.id);
        const member = await join(owner, org.id, 'director');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${member}`);
        await orgTournament(owner, org.id);
        expect(await revokedFor(member)).toEqual([before]);
      });

      it('never lists a personal tournament', async () => {
        const { owner, org } = await orgWithOwner();
        const member = await newUser();
        const personal = crypto.randomUUID();
        await push(member, [tournamentItem(personal)]);
        expect((await store.getTournament(personal))?.organizationId ?? null).toBeNull();
        await backend.addMember(org.id, member, 'director');
        await call(owner, 'DELETE', `/organizations/${org.id}/members/${member}`);
        expect(await revokedFor(member)).toEqual([]);
        expect((await call(member, 'GET', `/tournaments/${personal}`)).status).toBe(200);
      });
    });

    it('a new tournament goes to your own organization before one you were invited to', async () => {
      const { org: club } = await orgWithOwner();
      const person = await newUser();
      await backend.addMember(club.id, person, 'director');
      await tick();
      const own = await verifiedOrg(person);
      const created = await call(person, 'POST', '/tournaments', { name: 'Default org' });
      expect(created.body.organizationId).toBe(own.id);
    });
  });

  describe('#1 organization membership', () => {
    it('refuses a tournament in an organization the caller does not manage', async () => {
      const org = await verifiedOrg(await newUser());
      const res = await call(await newUser(), 'POST', '/tournaments', {
        name: 'Fake Open',
        organizationId: org.id,
      });
      expect(res.status).toBe(403);
    });

    it('refuses the same through sync', async () => {
      const org = await verifiedOrg(await newUser());
      const id = crypto.randomUUID();
      const attacker = await newUser();

      const res = await push(attacker, [tournamentItem(id, { organizationId: org.id })]);
      expect(res.body.accepted).toBe(0);
      expect(res.body.rejected[0].code).toBe('forbidden_organization');
      expect(await store.getTournament(id)).toBeNull();

      const legacy = await legacyPush(attacker, [tournamentItem(id, { organizationId: org.id })]);
      expect(legacy.status).toBe(403);
    });

    it('never moves an existing tournament to another organization through sync', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const other = await verifiedOrg(await newUser());

      const res = await push(owner, [tournamentItem(t.id, { organizationId: other.id })]);
      expect(res.body.accepted).toBe(1);
      expect((await store.getTournament(t.id))?.organizationId).toBe(t.organizationId);
    });

    it('ignores a client-supplied ownerId: the caller is the owner', async () => {
      const victim = await newUser();
      const attacker = await newUser();
      const id = crypto.randomUUID();
      const res = await push(attacker, [tournamentItem(id, { ownerId: victim })]);
      expect(res.body.accepted).toBe(1);
      expect((await store.getTournament(id))?.ownerId).toBe(attacker);
    });

    it('does not attach a tournament to an org where the creator is only an arbiter', async () => {
      const org = await verifiedOrg(await newUser());
      const arbiter = await newUser();
      await backend.addMember(org.id, arbiter, 'arbiter');
      const created = await call(arbiter, 'POST', '/tournaments', { name: 'Mine' });
      expect(created.status).toBe(201);
      expect(created.body.organizationId).toBeNull();
    });

    it('lets a director create inside the organization', async () => {
      const org = await verifiedOrg(await newUser());
      const director = await newUser();
      await backend.addMember(org.id, director, 'director');
      const created = await call(director, 'POST', '/tournaments', {
        name: 'Org event',
        organizationId: org.id,
      });
      expect(created.status).toBe(201);
    });
  });

  describe('#2 claim', () => {
    async function linkableTournament(email: string, fideId = 4242, name = 'Unique Kid') {
      const t = await seedTournament(await newUser());
      return seedPlayer(t.id, { name, email, fideId });
    }

    it('needs a confirmed email', async () => {
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', { fullName: 'P', relationship: 'child' })
      ).body.profile;
      const res = await call(user, 'POST', `/player/profiles/${profile.id}/claim`, {});
      expect(res.status).toBe(403);
    });

    it('ignores name, FIDE id and typed email as proof', async () => {
      const victimEmail = `${crypto.randomUUID()}@victim.test`;
      const fideId = 5000000 + Math.floor(Math.random() * 1000000);
      const name = `Kid ${crypto.randomUUID()}`;
      await linkableTournament(victimEmail, fideId, name);
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', {
          fullName: name,
          relationship: 'child',
          fideId,
          email: victimEmail,
        })
      ).body.profile;
      const res = await call(
        user,
        'POST',
        `/player/profiles/${profile.id}/claim`,
        { fullName: name, fideId, email: victimEmail },
        { 'x-test-user-email': `${crypto.randomUUID()}@attacker.test` },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ claimedCount: 0, participantIds: [] });
    });

    it('links rows carrying the confirmed email, with the same response shape', async () => {
      const email = `${crypto.randomUUID()}@parent.test`;
      const player = await linkableTournament(email);
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', { fullName: 'unique  KID', relationship: 'self' })
      ).body.profile;
      const res = await call(
        user,
        'POST',
        `/player/profiles/${profile.id}/claim`,
        {},
        { 'x-test-user-email': email.toUpperCase() },
      );
      expect(res.body).toEqual({ claimedCount: 1, participantIds: [player.id] });
    });

    it('does not link a sibling who shares the parent email', async () => {
      const email = `${crypto.randomUUID()}@parent.test`;
      const sibling = await linkableTournament(email, 4243, 'Older Sibling');
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', { fullName: 'Younger Sibling', relationship: 'child' })
      ).body.profile;
      const res = await call(
        user,
        'POST',
        `/player/profiles/${profile.id}/claim`,
        {},
        { 'x-test-user-email': email },
      );
      expect(res.body).toEqual({ claimedCount: 0, participantIds: [] });
      expect(sibling.id).toBeTruthy();
    });
  });

  describe('#3 certificates', () => {
    async function issuedCertificate(email: string) {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const player = await seedPlayer(t.id, { email: null });
      const res = await call(owner, 'POST', `/tournaments/${t.id}/certificates/issue`, {
        items: [
          {
            participantId: player.id,
            type: 'winner',
            recipientEmail: email,
            recipientName: 'Kid',
            pdfBase64: PDF,
          },
        ],
      });
      expect(res.status).toBe(201);
      return res.body.issues[0].id as string;
    }

    it('a profile with someone else’s email sees and downloads nothing', async () => {
      const email = `${crypto.randomUUID()}@victim.test`;
      const issueId = await issuedCertificate(email);
      const attacker = await newUser();
      const profile = (
        await call(attacker, 'POST', '/player/profiles', {
          fullName: 'A',
          relationship: 'child',
          email,
        })
      ).body.profile;

      const dash = await call(attacker, 'GET', `/player/dashboard?profileId=${profile.id}`);
      expect(dash.body.certificates).toEqual([]);
      expect((await call(attacker, 'GET', `/certificates/${issueId}/download`)).status).toBe(403);
    });

    it('the confirmed address sees and downloads its certificate', async () => {
      const email = `${crypto.randomUUID()}@parent.test`;
      const issueId = await issuedCertificate(email);
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', {
          fullName: 'P',
          relationship: 'self',
          email,
        })
      ).body.profile;
      const headers = { 'x-test-user-email': email };

      const dash = await call(user, 'GET', `/player/dashboard?profileId=${profile.id}`, undefined, headers);
      expect(dash.body.certificates.map((c: { id: string }) => c.id)).toContain(issueId);
      const download = await call(user, 'GET', `/certificates/${issueId}/download`, undefined, headers);
      expect(download.status).toBe(200);
    });
  });

  describe('#4 sync ownership', () => {
    it('a null-owner tournament cannot be claimed through sync', async () => {
      const t = await seedTournament(null);
      const attacker = await newUser();
      const res = await push(attacker, [tournamentItem(t.id, { name: 'Mine now' })]);
      expect(res.body.rejected[0].code).toBe('forbidden');
      const after = await store.getTournament(t.id);
      expect(after?.ownerId).toBeNull();
      expect(after?.name).toBe('Seeded');
    });

    it('nobody else can revive or write into a soft-deleted tournament', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      await store.updateTournament(t.id, { deletedAt: iso(-60_000), updatedAt: iso(-60_000) });
      const attacker = await newUser();

      const child = participantItem(t.id, { name: 'Planted' });
      const res = await push(attacker, [tournamentItem(t.id, { name: 'Defaced' }), child]);
      expect(res.body.accepted).toBe(0);
      expect(res.body.rejected.map((r: { code: string }) => r.code)).toEqual([
        'forbidden',
        'forbidden',
      ]);
      const after = await store.getTournament(t.id);
      expect(after?.deletedAt).toBeTruthy();
      expect(after?.name).toBe('Seeded');
      expect(await store.getParticipant(child.id)).toBeNull();
    });

    it('the owner can still revive their own soft-deleted tournament', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      await store.updateTournament(t.id, { deletedAt: iso(-60_000), updatedAt: iso(-60_000) });
      const res = await push(owner, [tournamentItem(t.id, { name: 'Back again' })]);
      expect(res.body.accepted).toBe(1);
      const after = await store.getTournament(t.id);
      expect(after?.deletedAt ?? null).toBeNull();
      expect(after?.name).toBe('Back again');
    });

    it('a row id used in another tournament is refused, not hijacked', async () => {
      const a = await newUser();
      const ta = await seedTournament(a);
      const player = await seedPlayer(ta.id, { name: 'Original' });
      const b = await newUser();
      const tb = await seedTournament(b);
      const item = { ...participantItem(tb.id, { name: 'Hijack' }), id: player.id };
      const res = await push(b, [item]);
      expect(res.body.rejected[0].code).toBe('forbidden');
      expect((await store.getParticipant(player.id))?.tournamentId).toBe(ta.id);
    });
  });

  describe('#5 results through sync', () => {
    async function board(extra: Partial<Game> = {}) {
      const owner = await newUser();
      const t = await seedTournament(owner);
      return { owner, t, ...(await seedBoard(t.id, extra)) };
    }

    it('refuses game writes for a confirmed round and reports why', async () => {
      const { owner, t, game, syncPayload } = await board();
      await store.recordGameResult(game.id, { result: '1-0', actorRole: 'director' });
      await store.updateTournament(t.id, { confirmedRounds: 1, updatedAt: iso(-HOUR) });
      await tick();

      const res = await push(owner, [
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '0-1' }, updatedAt: iso(1000) },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(0);
      expect(res.body.rejected[0].code).toBe('round_confirmed');
      expect((await store.getGame(game.id))?.result).toBe('1-0');
    });

    it('a stale empty row cannot wipe a floor-locked result', async () => {
      const { owner, game, syncPayload } = await board();
      await store.recordGameResult(game.id, {
        result: '1-0',
        actorRole: 'floor',
        lock: true,
        onlyIfOpen: true,
      });
      const before = (await backend.auditEvents(game.id)).length;
      await tick();
      const res = await push(owner, [
        { entity: 'game', id: game.id, payload: syncPayload, updatedAt: iso(300_000) },
      ]);
      expect(res.body.rejected[0].code).toBe('result_locked');
      const after = await store.getGame(game.id);
      expect(after?.result).toBe('1-0');
      expect(after?.resultLockedAt).toBeTruthy();
      expect((await backend.auditEvents(game.id)).length).toBe(before);
    });

    it('a director correction made offline replaces a locked result, keeps the lock, and is audited', async () => {
      const { owner, game, syncPayload } = await board();
      await store.recordGameResult(game.id, { result: '1-0', actorRole: 'floor', lock: true });
      await tick();
      const res = await push(owner, [
        {
          entity: 'game',
          id: game.id,
          payload: { ...syncPayload, result: '0-1', resultEnteredByRole: 'director' },
          updatedAt: iso(),
        },
      ]);
      expect(res.body.accepted).toBe(1);
      const after = await store.getGame(game.id);
      expect(after?.result).toBe('0-1');
      expect(after?.resultLockedAt).toBeTruthy();
      expect(after?.resultOverrideCount).toBe(1);
      const events = await backend.auditEvents(game.id);
      expect(events.at(-1)?.note).toBe('Applied by offline sync');
    });

    it('a correction through the normal route still works on a locked result', async () => {
      const { owner, game } = await board();
      await store.recordGameResult(game.id, { result: '1-0', actorRole: 'floor', lock: true });
      const res = await call(owner, 'PATCH', `/games/${game.id}/result`, {
        result: '0-1',
        confirm: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.result).toBe('0-1');
    });

    it('accepts results and the round confirmation arriving in one offline batch', async () => {
      const { owner, t, game, syncPayload } = await board();
      const res = await push(owner, [
        tournamentItem(t.id, { confirmedRounds: 1 }),
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '1-0' }, updatedAt: iso() },
      ]);
      expect(res.body).toMatchObject({ accepted: 2, rejected: [] });
      expect((await store.getGame(game.id))?.result).toBe('1-0');
      expect((await store.getTournament(t.id))?.confirmedRounds).toBe(1);
    });

    it('accepts a correction that arrives with an undo of the confirmation', async () => {
      const { owner, t, game, syncPayload } = await board();
      await store.recordGameResult(game.id, { result: '1-0', actorRole: 'director' });
      await store.updateTournament(t.id, { confirmedRounds: 1, updatedAt: iso(-HOUR) });
      await tick();
      const res = await push(owner, [
        tournamentItem(t.id, { confirmedRounds: 0 }),
        {
          entity: 'game',
          id: game.id,
          payload: { ...syncPayload, result: '0-1', resultEnteredByRole: 'director' },
          updatedAt: iso(),
        },
      ]);
      expect(res.body.accepted).toBe(2);
      expect((await store.getGame(game.id))?.result).toBe('0-1');
    });

    it('clamps future timestamps, so a fast clock cannot freeze a row', async () => {
      const { owner, game, syncPayload } = await board();
      const res = await push(owner, [
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '1-0' }, updatedAt: '2099-01-01T00:00:00.000Z' },
      ]);
      expect(res.body.accepted).toBe(1);
      const stored = await store.getGame(game.id);
      expect(Date.parse(stored!.updatedAt)).toBeLessThanOrEqual(Date.now());
      await new Promise((r) => setTimeout(r, 5));
      const later = await push(owner, [
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '0-1' }, updatedAt: iso() },
      ]);
      expect(later.body.accepted).toBe(1);
      expect((await store.getGame(game.id))?.result).toBe('0-1');
    });

    it('writes an audit event for each result change', async () => {
      const { owner, game, syncPayload } = await board();
      await push(owner, [
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '1-0' }, updatedAt: iso() },
      ]);
      expect((await backend.auditEvents(game.id)).map((e) => e.result)).toEqual(['1-0']);
    });

    it('reports an older edit as stale instead of counting it as accepted', async () => {
      const { owner, game, syncPayload } = await board();
      await store.recordGameResult(game.id, { result: '1-0', actorRole: 'director' });
      const res = await push(owner, [
        { entity: 'game', id: game.id, payload: { ...syncPayload, result: '0-1' }, updatedAt: iso(-HOUR) },
      ]);
      expect(res.body.accepted).toBe(0);
      expect(res.body.rejected[0].code).toBe('stale');
    });
  });

  describe('#6 pull cursor', () => {
    it('delivers an offline edit pushed with an old timestamp', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const lastPull = iso(-30 * 60_000);
      const item = participantItem(t.id, { name: 'Added offline' });
      item.updatedAt = iso(-HOUR);
      await push(owner, [item]);

      const res = await call(owner, 'GET', `/sync/pull?since=${encodeURIComponent(lastPull)}`);
      expect(res.body.participants.map((p: { id: string }) => p.id)).toContain(item.id);
    });

    it('keeps the response shape older clients read', async () => {
      const res = await call(await newUser(), 'GET', `/sync/pull?since=${encodeURIComponent(iso())}`);
      // New fields may be added. Older clients ignore them; these must stay.
      expect(Object.keys(res.body)).toEqual(
        expect.arrayContaining(['categories', 'games', 'participants', 'serverTime', 'tournaments']),
      );
    });

    it('does not resend rows that have not changed since the cursor', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const res = await call(owner, 'GET', `/sync/pull?since=${encodeURIComponent(iso(5 * 60_000))}`);
      expect(res.body.tournaments.map((x: { id: string }) => x.id)).not.toContain(t.id);
    });
  });

  describe('#7 certificate email caps', () => {
    it('a trial sends 5 test emails a day, then gets a 429', async () => {
      const owner = await newUser();
      const org = await makeOrg(owner);
      const t = await seedTournament(owner, { organizationId: org.id });
      const send = () =>
        call(owner, 'POST', `/tournaments/${t.id}/certificates/email-test`, {
          to: 'me@example.com',
        }, { 'x-test-user-email': 'me@example.com' });
      // No Resend key in tests, so a permitted send stops at 502.
      for (let i = 0; i < 5; i++) expect((await send()).status).toBe(502);
      expect((await send()).status).toBe(429);
    });

    it('a test email goes only to the sender’s own address', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const res = await call(
        owner,
        'POST',
        `/tournaments/${t.id}/certificates/email-test`,
        { to: 'stranger@example.com' },
        { 'x-test-user-email': 'me@example.com' },
      );
      expect(res.status).toBe(403);
    });

    it('bulk email needs a verified organization', async () => {
      const owner = await newUser();
      const org = await makeOrg(owner);
      const t = await seedTournament(owner, { organizationId: org.id });
      const res = await call(owner, 'POST', `/tournaments/${t.id}/certificates/email`, {
        allPending: true,
      });
      expect(res.status).toBe(403);
    });

    it('caps bulk sends over a rolling day', async () => {
      const scopeKey = `org:${crypto.randomUUID()}`;
      const reserve = (count: number) =>
        store.reserveEmailSends({ kind: 'bulk', scopeKey, count, limit: 10 });
      expect((await reserve(6)).allowed).toBe(true);
      expect(await reserve(5)).toEqual({ allowed: false, used: 6, limit: 10 });
      expect((await reserve(4)).allowed).toBe(true);
    });
  });

  describe('#8 directors', () => {
    it('a director pushes and pulls organization tournaments, with real counts', async () => {
      const owner = await newUser();
      const org = await verifiedOrg(owner);
      const director = await newUser();
      await backend.addMember(org.id, director, 'director');
      const t = await store.createTournament(tournamentRow(owner, { organizationId: org.id }));

      const res = await push(director, [tournamentItem(t.id, { name: 'Director edit' })]);
      expect(res.body).toMatchObject({ accepted: 1, rejected: [] });
      expect((await store.getTournament(t.id))?.name).toBe('Director edit');
      expect((await store.getTournament(t.id))?.ownerId).toBe(owner);

      const pulled = await call(director, 'GET', `/sync/pull?since=${encodeURIComponent(iso(-HOUR))}`);
      expect(pulled.body.tournaments.map((x: { id: string }) => x.id)).toContain(t.id);
    });

    it('an arbiter-role member neither pushes nor pulls', async () => {
      const owner = await newUser();
      const org = await verifiedOrg(owner);
      const arbiter = await newUser();
      await backend.addMember(org.id, arbiter, 'arbiter');
      const t = await store.createTournament(tournamentRow(owner, { organizationId: org.id }));

      expect((await push(arbiter, [tournamentItem(t.id)])).body.rejected[0].code).toBe('forbidden');
      const pulled = await call(arbiter, 'GET', `/sync/pull?since=${encodeURIComponent(iso(-HOUR))}`);
      expect(pulled.body.tournaments.map((x: { id: string }) => x.id)).not.toContain(t.id);
    });
  });

  describe('#9 registration review', () => {
    async function openEvent(extra: Partial<Tournament> = {}) {
      const owner = await newUser();
      const t = await seedTournament(owner, { registrationOpen: true, ...extra });
      await store.updateTournament(t.id, { registrationOpen: true, ...extra, updatedAt: iso(-HOUR) });
      return { owner, t };
    }
    async function register(tournamentId: string) {
      const res = await call(null, 'POST', `/public/events/${tournamentId}/register`, {
        name: `Reg ${crypto.randomUUID()}`,
        email: `${crypto.randomUUID()}@x.test`,
      });
      expect(res.status).toBe(201);
      return res.body.registration as { id: string };
    }
    const review = (owner: string, tid: string, regId: string, action: string) =>
      call(owner, 'POST', `/tournaments/${tid}/registrations/${regId}/review`, { action });

    it('rejecting an approved registration removes the participant', async () => {
      const { owner, t } = await openEvent();
      const reg = await register(t.id);
      const approved = await review(owner, t.id, reg.id, 'approve');
      expect(approved.status).toBe(200);
      const rejected = await review(owner, t.id, reg.id, 'reject');
      expect(rejected.status).toBe(200);
      expect(await store.listParticipants(t.id)).toEqual([]);
    });

    it('re-approving brings the same participant back', async () => {
      const { owner, t } = await openEvent();
      const reg = await register(t.id);
      const first = await review(owner, t.id, reg.id, 'approve');
      await review(owner, t.id, reg.id, 'reject');
      await tick();
      const again = await review(owner, t.id, reg.id, 'approve');
      expect(again.status).toBe(200);
      expect(again.body.participant.id).toBe(first.body.participant.id);
      expect(await store.listParticipants(t.id)).toHaveLength(1);
    });

    it('refuses to reject a player with games in a confirmed round', async () => {
      const { owner, t } = await openEvent();
      const reg = await register(t.id);
      const approved = await review(owner, t.id, reg.id, 'approve');
      const pid = approved.body.participant.id as string;
      const { category, black } = await seedBoard(t.id, { board: 2 });
      await store.createGame({
        id: crypto.randomUUID(),
        tournamentId: t.id,
        categoryId: category.id,
        round: 1,
        board: 3,
        whiteId: pid,
        blackId: black.id,
        result: '1-0',
        isBye: false,
        updatedAt: iso(-HOUR),
      });
      await store.updateTournament(t.id, { confirmedRounds: 1, updatedAt: iso(-HOUR) });

      const res = await review(owner, t.id, reg.id, 'reject');
      expect(res.status).toBe(409);
      expect((await store.getParticipant(pid))?.deletedAt ?? null).toBeNull();
      const list = await call(owner, 'GET', `/tournaments/${t.id}/registrations`);
      expect(list.body.registrations[0].status).toBe('approved');
    });

    it('refuses an illegal transition', async () => {
      const { owner, t } = await openEvent();
      const reg = await register(t.id);
      await review(owner, t.id, reg.id, 'approve');
      expect((await review(owner, t.id, reg.id, 'approve')).status).toBe(409);
    });

    it('two approvals at once make one participant, and the loser gets a 409', async () => {
      const { owner, t } = await openEvent();
      const reg = await register(t.id);
      const results = await Promise.all([
        review(owner, t.id, reg.id, 'approve'),
        review(owner, t.id, reg.id, 'approve'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await store.listParticipants(t.id)).toHaveLength(1);
    });

    describe('payment on approval', () => {
      async function paidRegistration(receipt: boolean) {
        const owner = await newUser();
        const t = await seedTournament(owner, { registrationOpen: true });
        await store.updateTournament(t.id, {
          registrationOpen: true,
          entryFeeCents: 5000,
          updatedAt: iso(-HOUR),
        });
        const res = await call(null, 'POST', `/public/events/${t.id}/register`, {
          name: `Paid ${crypto.randomUUID()}`,
          ...(receipt
            ? {
                receiptDataUrl:
                  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              }
            : {}),
        });
        expect(res.status).toBe(201);
        return { owner, t, reg: res.body.registration as { id: string } };
      }

      it('refuses to verify a paid registration with no receipt', async () => {
        const { owner, t, reg } = await paidRegistration(false);
        const res = await review(owner, t.id, reg.id, 'approve');
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/no receipt/);
        expect(await store.listParticipants(t.id)).toEqual([]);
      });

      it('verifies it when the organizer confirms payment another way', async () => {
        const { owner, t, reg } = await paidRegistration(false);
        const res = await call(owner, 'POST', `/tournaments/${t.id}/registrations/${reg.id}/review`, {
          action: 'approve',
          confirmPaymentWithoutReceipt: true,
        });
        expect(res.status).toBe(200);
        expect(res.body.registration.paymentStatus).toBe('verified');
      });

      it('verifies it when a receipt exists', async () => {
        const { owner, t, reg } = await paidRegistration(true);
        const res = await review(owner, t.id, reg.id, 'approve');
        expect(res.status).toBe(200);
        expect(res.body.registration.paymentStatus).toBe('verified');
      });
    });

    it('flags same-name registrations with no email, and still allows them', async () => {
      const { owner, t } = await openEvent();
      const name = `Twin ${crypto.randomUUID()}`;
      const post = (body: object) => call(null, 'POST', `/public/events/${t.id}/register`, body);
      expect((await post({ name })).status).toBe(201);
      expect((await post({ name })).status).toBe(201);
      const other = await register(t.id);

      const list = await call(owner, 'GET', `/tournaments/${t.id}/registrations`);
      const flags = list.body.registrations.map((r: { id: string; possibleDuplicate: boolean }) => [
        r.id === other.id,
        r.possibleDuplicate,
      ]);
      expect(flags.filter(([isOther]: boolean[]) => !isOther).every(([, d]: boolean[]) => d)).toBe(true);
      expect(flags.find(([isOther]: boolean[]) => isOther)?.[1]).toBe(false);
    });

    it('checks capacity inside the review', async () => {
      const { owner, t } = await openEvent({ maxParticipants: 1 });
      const a = await register(t.id);
      const b = await register(t.id);
      expect((await review(owner, t.id, a.id, 'approve')).status).toBe(200);
      expect((await review(owner, t.id, b.id, 'approve')).status).toBe(409);
    });
  });

  describe('#10 floor', () => {
    async function floor() {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const { game } = await seedBoard(t.id);
      const prep = await call(owner, 'POST', `/tournaments/${t.id}/floor/prepare`, {
        tableCount: 1,
        pinRound: 1,
        rotatePin: true,
      });
      const slug = prep.body.tables[0].slug as string;
      const session = await call(null, 'POST', `/public/tables/${slug}/session`, {
        pin: prep.body.arbiterPin,
      });
      return { owner, t, game, slug, token: session.body.token as string };
    }

    it('rotating the PIN ends sessions from the old one, in the same round', async () => {
      const { owner, t, slug, token } = await floor();
      const auth = { authorization: `Bearer ${token}` };
      expect((await call(null, 'GET', `/public/tables/${slug}`, undefined, auth)).body.sessionOk).toBe(true);

      const rotated = await call(owner, 'POST', `/tournaments/${t.id}/floor/rotate-pin`, { pinRound: 1 });
      expect(rotated.status).toBe(200);

      expect((await call(null, 'GET', `/public/tables/${slug}`, undefined, auth)).body.sessionOk).toBe(false);
      const res = await call(null, 'POST', `/public/tables/${slug}/result`, { result: '1-0' }, auth);
      expect(res.status).toBe(401);
    });

    it('of two simultaneous results one wins, the other gets a 409, and one audit event', async () => {
      const { game, slug, token } = await floor();
      const auth = { authorization: `Bearer ${token}` };
      const results = await Promise.all(
        ['1-0', '0-1'].map((result) =>
          call(null, 'POST', `/public/tables/${slug}/result`, { result, arbiterName: 'A' }, auth),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await backend.auditEvents(game.id)).toHaveLength(1);
    });
  });

  describe('public live page', () => {
    it('leaves out age, birth year, school and club', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      await seedPlayer(t.id, {
        name: 'Kid',
        age: 9,
        yearOfBirth: 2017,
        school: 'SK Example',
        club: 'SK Example',
        email: 'parent@example.com',
      });
      const enabled = await call(owner, 'POST', `/tournaments/${t.id}/public-live/enable`);
      const res = await call(null, 'GET', `/public/live/${enabled.body.publicToken}`);
      expect(res.status).toBe(200);
      const [player] = res.body.players;
      expect(player.name).toBe('Kid');
      for (const field of ['age', 'yearOfBirth', 'school', 'club', 'email']) {
        expect(player).not.toHaveProperty(field);
      }
    });
  });

  describe('certificate serial prefix', () => {
    it('keeps a stored prefix, and new tournaments get the neutral default', async () => {
      const owner = await newUser();
      const stored = await seedTournament(owner, { certSerialPrefix: 'ARCC' });
      expect(await store.allocateCertificateSerials(stored.id, 1)).toEqual([
        expect.stringMatching(/^ARCC\//),
      ]);
      const fresh = await seedTournament(owner);
      expect(await store.allocateCertificateSerials(fresh.id, 1)).toEqual([
        expect.stringMatching(/^CERT\//),
      ]);
    });
  });

  describe('#11 references', () => {
    it('refuses a game pointing at another tournament’s players', async () => {
      const a = await newUser();
      const victim = await seedBoard((await seedTournament(a)).id);
      const b = await newUser();
      const tb = await seedTournament(b);
      const own = await seedBoard(tb.id, { board: 5 });
      const res = await push(b, [
        {
          entity: 'game',
          id: crypto.randomUUID(),
          payload: {
            tournamentId: tb.id,
            categoryId: own.category.id,
            round: 2,
            board: 1,
            whiteId: victim.white.id,
            blackId: victim.black.id,
            result: 'pending',
          },
          updatedAt: iso(),
        },
      ]);
      expect(res.body.rejected[0].code).toBe('invalid');
    });

    it('refuses a game pointing at another tournament’s category', async () => {
      const victim = await seedBoard((await seedTournament(await newUser())).id);
      const b = await newUser();
      const tb = await seedTournament(b);
      const own = await seedBoard(tb.id);
      const res = await push(b, [
        {
          entity: 'game',
          id: crypto.randomUUID(),
          payload: { ...own.syncPayload, categoryId: victim.category.id, round: 2 },
          updatedAt: iso(),
        },
      ]);
      expect(res.body.rejected[0].code).toBe('invalid');
    });

    it('ignores a profile link in a sync payload', async () => {
      const victim = await newUser();
      const profile = (
        await call(victim, 'POST', '/player/profiles', { fullName: 'V', relationship: 'child' })
      ).body.profile;
      const b = await newUser();
      const tb = await seedTournament(b);
      const item = participantItem(tb.id, { playerProfileId: profile.id });
      const res = await push(b, [item]);
      expect(res.body.accepted).toBe(1);
      expect((await store.getParticipant(item.id))?.playerProfileId ?? null).toBeNull();
      const dash = await call(victim, 'GET', `/player/dashboard?profileId=${profile.id}`);
      expect(dash.body.tournaments).toEqual([]);
    });

    it('sync cannot clear a link made by approval or claim', async () => {
      const email = `${crypto.randomUUID()}@parent.test`;
      const owner = await newUser();
      const t = await seedTournament(owner);
      const player = await seedPlayer(t.id, { email, name: 'Linked Kid' });
      const user = await newUser();
      const profile = (
        await call(user, 'POST', '/player/profiles', { fullName: 'Linked Kid', relationship: 'self' })
      ).body.profile;
      await call(user, 'POST', `/player/profiles/${profile.id}/claim`, {}, { 'x-test-user-email': email });
      await tick();
      await push(owner, [
        {
          entity: 'participant',
          id: player.id,
          payload: { tournamentId: t.id, name: 'Renamed', age: 11, email },
          updatedAt: iso(),
        },
      ]);
      const after = await store.getParticipant(player.id);
      expect(after?.name).toBe('Renamed');
      expect(after?.playerProfileId).toBe(profile.id);
    });

    it('strips another tournament’s category from a player', async () => {
      const victim = await seedBoard((await seedTournament(await newUser())).id);
      const b = await newUser();
      const tb = await seedTournament(b);
      const item = participantItem(tb.id, { categoryIds: [victim.category.id] });
      await push(b, [item]);
      expect((await store.getParticipant(item.id))?.categoryIds).toEqual([]);
    });

    it('refuses a certificate for another tournament’s participant', async () => {
      const victim = await seedBoard((await seedTournament(await newUser())).id);
      const b = await newUser();
      const tb = await seedTournament(b);
      const res = await call(b, 'POST', `/tournaments/${tb.id}/certificates/issue`, {
        items: [
          { participantId: victim.white.id, type: 'winner', recipientName: 'X', pdfBase64: PDF },
        ],
      });
      expect(res.status).toBe(400);
    });

    it('refuses a registration naming another tournament’s category', async () => {
      const victim = await seedBoard((await seedTournament(await newUser())).id);
      const owner = await newUser();
      const t = await seedTournament(owner);
      await store.updateTournament(t.id, { registrationOpen: true, updatedAt: iso(-HOUR) });
      const res = await call(null, 'POST', `/public/events/${t.id}/register`, {
        name: 'Reg',
        selectedCategoryId: victim.category.id,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('#12 quotas and credits', () => {
    it('one account gets one trial organization', async () => {
      const user = await newUser();
      await makeOrg(user);
      const res = await call(user, 'POST', '/organizations', { name: 'Second free org' });
      expect(res.status).toBe(403);
    });

    it('caps an account’s organizations overall', async () => {
      const user = await newUser();
      for (let i = 0; i < 5; i++) await verifiedOrg(user);
      expect((await call(user, 'POST', '/organizations', { name: 'One too many' })).status).toBe(403);
    });

    it('counts a revive against the tournament quota', async () => {
      const user = await newUser();
      const org = await makeOrg(user);
      const a = await call(user, 'POST', '/tournaments', { name: 'A', organizationId: org.id });
      await call(user, 'DELETE', `/tournaments/${a.body.id}`);
      const b = await call(user, 'POST', '/tournaments', { name: 'B', organizationId: org.id });
      expect(b.status).toBe(201);
      await tick();
      const res = await push(user, [tournamentItem(a.body.id, {}, iso(1000))]);
      expect(res.body.rejected[0].code).toBe('quota');
      expect((await store.getTournament(a.body.id))?.deletedAt).toBeTruthy();
    });

    it('adding players while soft-deleted does not get past the player limit', async () => {
      const user = await newUser();
      const org = await makeOrg(user);
      const created = await call(user, 'POST', '/tournaments', { name: 'Q', organizationId: org.id });
      await call(user, 'DELETE', `/tournaments/${created.body.id}`);
      const items = Array.from({ length: 30 }, (_, i) =>
        participantItem(created.body.id, { name: `P${i}` }),
      );
      const res = await push(user, items);
      expect(res.body.accepted).toBe(24);
      expect(res.body.rejected.filter((r: { code: string }) => r.code === 'quota')).toHaveLength(6);
    });

    async function eventPass(credits: number) {
      const owner = await newUser();
      const org = await verifiedOrg(owner, {
        planTier: 'event_pass',
        eventCreditsRemaining: credits,
        maxPlayersPerTournament: 250,
      });
      const t = await store.createTournament(tournamentRow(owner, { organizationId: org.id }));
      return { owner, org, t };
    }

    it('charges one credit on first publish, and none for republishing', async () => {
      const { owner, org, t } = await eventPass(2);
      const publish = (value: boolean) =>
        call(owner, 'PATCH', `/tournaments/${t.id}/publishing`, { isPublishedGlobal: value });
      expect((await publish(true)).status).toBe(200);
      expect((await store.getOrganization(org.id))?.eventCreditsRemaining).toBe(1);
      await publish(false);
      expect((await publish(true)).status).toBe(200);
      expect((await store.getOrganization(org.id))?.eventCreditsRemaining).toBe(1);
    });

    it('blocks publishing with no credits left', async () => {
      const { owner, t } = await eventPass(0);
      const res = await call(owner, 'PATCH', `/tournaments/${t.id}/publishing`, {
        isPublishedGlobal: true,
      });
      expect(res.status).toBe(403);
      expect((await store.getTournament(t.id))?.isPublishedGlobal ?? false).toBe(false);
    });

    it('caps an Event Pass at 150 players even if the organization row says 250', async () => {
      const { owner, t } = await eventPass(1);
      const items = Array.from({ length: 151 }, () => participantItem(t.id));
      const res = await push(owner, items);
      expect(res.body.accepted).toBe(150);
      expect(res.body.rejected[0].code).toBe('quota');
    });
  });

  describe('#13 batches', () => {
    it('an older client’s failed batch leaves nothing behind', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const other = await seedTournament(await newUser());
      const first = participantItem(t.id);
      const res = await legacyPush(owner, [first, participantItem(other.id)]);
      expect(res.status).toBe(403);
      expect(await store.getParticipant(first.id)).toBeNull();
    });

    it('a client reading rejected[] keeps the rows that were fine', async () => {
      const owner = await newUser();
      const t = await seedTournament(owner);
      const other = await seedTournament(await newUser());
      const first = participantItem(t.id);
      const denied = participantItem(other.id);
      const res = await push(owner, [first, denied]);
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(1);
      expect(res.body.rejected).toMatchObject([
        { id: denied.id, entity: 'participant', code: 'forbidden' },
      ]);
      expect(await store.getParticipant(first.id)).not.toBeNull();
    });

    it('a bad value is reported instead of leaking a database error', async () => {
      const owner = await newUser();
      const res = await push(owner, [tournamentItem(crypto.randomUUID(), { style: 'nope' })]);
      expect(res.status).toBe(200);
      expect(res.body.rejected[0]).toMatchObject({ code: 'invalid', reason: 'Unknown tournament style.' });
    });
  });
});

describe('sync push route errors', () => {
  it('hides unexpected failures behind a generic message', async () => {
    process.env['AUTH_DISABLED'] = '1';
    const store = new MemoryStore();
    store.pushSync = async () => {
      throw new Error('connection to db.internal:5432 refused');
    };
    const app = Fastify({ logger: false });
    await app.register(syncPlugin, { store });
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      payload: { clientId: 'c', items: [] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Sync push failed');
    await app.close();
  });
});

describe('auth configuration', () => {
  const FULL = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' };

  it('refuses to start in production without auth config', () => {
    expect(() => assertAuthConfiguredForProduction({ NODE_ENV: 'production' })).toThrow(/Refusing/);
    expect(() =>
      assertAuthConfiguredForProduction({ NODE_ENV: 'production', SUPABASE_URL: 'https://x' }),
    ).toThrow(/Refusing/);
    expect(() =>
      assertAuthConfiguredForProduction({ NODE_ENV: 'production', AUTH_DISABLED: '1', ...FULL }),
    ).toThrow(/AUTH_DISABLED/);
    expect(() => assertAuthConfiguredForProduction({ NODE_ENV: 'production', ...FULL })).not.toThrow();
  });

  it('leaves dev and the desktop sidecar alone', () => {
    expect(() => assertAuthConfiguredForProduction({})).not.toThrow();
    expect(() => assertAuthConfiguredForProduction({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('treats an unconfirmed address as no address', () => {
    expect(confirmedEmailOf({ email: 'a@b.c' })).toBeNull();
    expect(confirmedEmailOf({ email: 'A@B.c', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe('a@b.c');
    expect(confirmedEmailOf({ email_confirmed_at: '2026-01-01T00:00:00Z' })).toBeNull();
  });

  it('honours x-test-user-id only with AUTH_DISABLED=1 outside production', async () => {
    const saved = { ...process.env };
    try {
      delete process.env['SUPABASE_URL'];
      delete process.env['AUTH_DISABLED'];
      const app = Fastify({ logger: false });
      app.get('/who', { preHandler: requireAuth }, async (request) => ({
        id: request.userId ?? null,
      }));
      const who = async () =>
        (
          await app.inject({
            method: 'GET',
            url: '/who',
            headers: { 'x-test-user-id': 'spoofed' },
          })
        ).json().id;

      expect(await who()).toBeNull();
      process.env['AUTH_DISABLED'] = '1';
      process.env['NODE_ENV'] = 'production';
      expect(await who()).toBeNull();
      process.env['NODE_ENV'] = 'test';
      expect(await who()).toBe('spoofed');
      await app.close();
    } finally {
      process.env = saved;
    }
  });
});
