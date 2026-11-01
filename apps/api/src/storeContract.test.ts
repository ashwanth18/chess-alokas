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
  close(): Promise<void>;
}

async function memoryBackend(): Promise<Backend> {
  const store = new MemoryStore();
  const internals = store as unknown as {
    organizationMembers: Map<string, unknown>;
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
      expect(Object.keys(res.body).sort()).toEqual([
        'categories',
        'games',
        'participants',
        'serverTime',
        'tournaments',
      ]);
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
