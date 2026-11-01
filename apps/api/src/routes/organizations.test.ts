import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../db.js';
import { organizationsPlugin } from './organizations.js';
import { tournamentsPlugin } from './tournaments.js';
import { syncPlugin } from './sync.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER = '99999999-9999-4999-8999-999999999999';

async function buildTestApp(store: MemoryStore) {
  process.env['AUTH_DISABLED'] = '1';
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'Request failed';
    void reply.code(statusCode).send({ error: message, message });
  });
  await app.register(organizationsPlugin, { store });
  await app.register(tournamentsPlugin, { store });
  await app.register(syncPlugin, { store });
  return app;
}

describe('organizations routes & B2B Sandbox Trial quotas', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('creates an organization in Sandbox Trial mode and enforces 1-tournament and 24-player caps until verified', async () => {
    const app = await buildTestApp(store);

    // 1. User A creates an organization
    const createOrgRes = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: { 'x-test-user-id': USER_A },
      payload: {
        name: 'KL Junior Chess Academy',
        city: 'Kuala Lumpur',
        state: 'WP Kuala Lumpur',
        contactPhone: '+60123456789',
        contactEmail: 'kljunior@example.com',
      },
    });
    expect(createOrgRes.statusCode).toBe(201);
    const { organization } = createOrgRes.json() as {
      organization: {
        id: string;
        slug: string;
        verificationStatus: string;
        planTier: string;
        maxTournamentsQuota: number;
        maxPlayersPerTournament: number;
        canPublishGlobal: boolean;
      };
    };
    expect(organization.slug).toBe('kl-junior-chess-academy');
    expect(organization.verificationStatus).toBe('pending_review');
    expect(organization.planTier).toBe('trial');
    expect(organization.maxTournamentsQuota).toBe(1);
    expect(organization.maxPlayersPerTournament).toBe(24);
    expect(organization.canPublishGlobal).toBe(false);

    // 2. User A lists their organizations
    const listRes = await app.inject({
      method: 'GET',
      url: '/organizations',
      headers: { 'x-test-user-id': USER_A },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().organizations).toHaveLength(1);

    // 3. Non-member User B cannot PATCH User A's organization
    const forbiddenPatch = await app.inject({
      method: 'PATCH',
      url: `/organizations/${organization.id}`,
      headers: { 'x-test-user-id': USER_B },
      payload: { paymentInstructions: 'Bank transfer' },
    });
    expect(forbiddenPatch.statusCode).toBe(403);

    // 4. User A creates their 1st tournament (allowed under 1-tournament trial cap)
    const t1Res = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': USER_A },
      payload: {
        name: 'KL Junior Trial Event #1',
        style: 'swiss',
        rounds: 5,
      },
    });
    expect(t1Res.statusCode).toBe(201);
    const t1 = t1Res.json() as { id: string; organizationId: string | null };
    expect(t1.organizationId).toBe(organization.id);

    // 5. User A attempts to create a 2nd active tournament while in trial mode -> blocked (403)
    const t2Blocked = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': USER_A },
      payload: {
        name: 'KL Junior Trial Event #2',
        style: 'swiss',
        rounds: 5,
      },
    });
    expect(t2Blocked.statusCode).toBe(403);
    expect(t2Blocked.json().message).toMatch(/Sandbox Trial quota reached/i);

    // 6. User A adds 24 players to tournament #1 (allowed)
    const now = new Date().toISOString();
    const first24 = Array.from({ length: 24 }, (_, idx) => ({
      id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      tournamentId: t1.id,
      name: `Player ${idx + 1}`,
      age: 12,
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    }));
    await store.upsertParticipants(first24);

    // 7. Adding a 25th player in trial mode -> blocked (403)
    const player25 = {
      id: '00000000-0000-4000-8000-000000000025',
      tournamentId: t1.id,
      name: 'Player 25',
      age: 12,
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    };
    await expect(store.createParticipant(player25)).rejects.toThrow(/maximum 24 players/i);

    // 8. Platform Admin lists organizations and approves/upgrades to Pro (unlimited)
    const adminListRes = await app.inject({
      method: 'GET',
      url: '/admin/organizations',
      headers: { 'x-test-user-id': ADMIN_USER },
    });
    expect(adminListRes.statusCode).toBe(200);
    expect(adminListRes.json().organizations[0].tournamentCount).toBe(1);

    const approveRes = await app.inject({
      method: 'PATCH',
      url: `/admin/organizations/${organization.id}`,
      headers: { 'x-test-user-id': ADMIN_USER },
      payload: {
        verificationStatus: 'verified',
        planTier: 'pro',
        maxTournamentsQuota: null,
        maxPlayersPerTournament: null,
        canPublishGlobal: true,
        canAcceptPaidRegistrations: true,
      },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().organization.verificationStatus).toBe('verified');
    expect(approveRes.json().organization.planTier).toBe('pro');
    expect(approveRes.json().organization.verifiedAt).toBeTruthy();

    // 9. Now User A can add the 25th player and create a 2nd tournament
    await expect(store.createParticipant(player25)).resolves.toMatchObject({ name: 'Player 25' });

    const t2Allowed = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': USER_A },
      payload: {
        name: 'KL Junior Pro Event #2',
        style: 'swiss',
        rounds: 5,
      },
    });
    expect(t2Allowed.statusCode).toBe(201);
  });
});
