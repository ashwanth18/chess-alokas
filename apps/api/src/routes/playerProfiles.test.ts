import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../db.js';
import { playerProfilesPlugin } from './playerProfiles.js';

const PARENT_USER = '11111111-1111-4111-8111-111111111111';
const ORGANIZER_USER = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_LIVE = '33333333-3333-4333-8333-333333333333';
const TOURNAMENT_PAST = '44444444-4444-4444-8444-444444444444';
const CATEGORY_ID = '55555555-5555-4555-8555-555555555555';

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
  await app.register(playerProfilesPlugin, { store });
  return app;
}

describe('playerProfiles routes, past participation claim & career dashboard', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('creates primary + child sub-profiles, claims past participations, and returns live matchday + career dashboard', async () => {
    const app = await buildTestApp(store);
    const now = new Date().toISOString();

    // Seed a completed tournament and a live tournament with participants & games
    await store.createTournament({
      id: TOURNAMENT_PAST,
      name: 'Selangor Rapid Open 2026',
      date: '2026-06-15',
      style: 'swiss',
      rounds: 5,
      status: 'completed',
      currentRound: 5,
      confirmedRounds: 5,
      mixCategories: false,
      prizePlaces: 3,
      awardScope: 'per_category',
      sharedPlaces: true,
      ownerId: ORGANIZER_USER,
      tableCount: 0,
      publicToken: 'pasttoken1234',
      publicEnabled: true,
      updatedAt: now,
    });

    await store.createTournament({
      id: TOURNAMENT_LIVE,
      name: 'Malaysia Youth Championship 2026',
      date: '2026-11-01',
      style: 'swiss',
      rounds: 6,
      status: 'in_progress',
      currentRound: 2,
      confirmedRounds: 1,
      mixCategories: false,
      prizePlaces: 3,
      awardScope: 'per_category',
      sharedPlaces: true,
      // A second organizer: accounts with no organization are limited to one tournament.
      ownerId: '77777777-7777-4777-8777-777777777777',
      tableCount: 10,
      publicToken: 'livetoken5678',
      publicEnabled: true,
      updatedAt: now,
    });

    const childPastPartId = '66666666-6666-4666-8666-666666666601';
    const oppPastPartId = '66666666-6666-4666-8666-666666666602';
    const childLivePartId = '66666666-6666-4666-8666-666666666603';
    const oppLivePartId = '66666666-6666-4666-8666-666666666604';

    await store.createParticipant({
      id: childPastPartId,
      tournamentId: TOURNAMENT_PAST,
      name: 'Aarav Ashwanth',
      age: 10,
      fideId: 5820001,
      rating: 1420,
      email: 'parent@example.com',
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    });
    await store.createParticipant({
      id: oppPastPartId,
      tournamentId: TOURNAMENT_PAST,
      name: 'Opponent One',
      age: 10,
      rating: 1380,
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    });
    await store.createGame({
      id: '77777777-7777-4777-8777-777777777701',
      tournamentId: TOURNAMENT_PAST,
      categoryId: CATEGORY_ID,
      round: 1,
      board: 1,
      whiteId: childPastPartId,
      blackId: oppPastPartId,
      result: '1-0',
      isBye: false,
      updatedAt: now,
    });

    await store.createParticipant({
      id: childLivePartId,
      tournamentId: TOURNAMENT_LIVE,
      name: 'Aarav Ashwanth',
      age: 10,
      fideId: 5820001,
      email: 'Parent@Example.com',
      rating: 1450,
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    });
    await store.createParticipant({
      id: oppLivePartId,
      tournamentId: TOURNAMENT_LIVE,
      name: 'Zara Lim',
      age: 11,
      rating: 1510,
      customFields: {},
      categoryIds: [],
      updatedAt: now,
    });
    await store.createGame({
      id: '77777777-7777-4777-8777-777777777702',
      tournamentId: TOURNAMENT_LIVE,
      categoryId: CATEGORY_ID,
      round: 1,
      board: 2,
      whiteId: childLivePartId,
      blackId: oppLivePartId,
      result: '1/2-1/2',
      isBye: false,
      updatedAt: now,
    });
    await store.createGame({
      id: '77777777-7777-4777-8777-777777777703',
      tournamentId: TOURNAMENT_LIVE,
      categoryId: CATEGORY_ID,
      round: 2,
      board: 4,
      whiteId: oppLivePartId,
      blackId: childLivePartId,
      result: 'pending',
      isBye: false,
      updatedAt: now,
    });

    store.registerCertificateIssue({
      id: '88888888-8888-4888-8888-888888888801',
      tournamentId: TOURNAMENT_PAST,
      participantId: childPastPartId,
      type: 'winner',
      rank: 1,
      recipientName: 'Aarav Ashwanth',
      recipientEmail: 'parent@example.com',
      storagePath: 'local/cert1.pdf',
      contentSha256: 'abc123',
      byteSize: 1024,
      status: 'stored',
      serial: 'SRO/001/2026',
      createdAt: now,
    });

    // 1. Create parent's primary profile
    const p1Res = await app.inject({
      method: 'POST',
      url: '/player/profiles',
      headers: { 'x-test-user-id': PARENT_USER },
      payload: {
        fullName: 'Ashwanth Kumar',
        username: 'ashwanth_k',
        relationship: 'self',
        isPrimary: true,
        email: 'parent@example.com',
      },
    });
    expect(p1Res.statusCode).toBe(201);
    const parentProfile = p1Res.json().profile as { id: string; isPrimary: boolean };
    expect(parentProfile.isPrimary).toBe(true);

    // 2. Create child sub-profile with FIDE ID 5820001
    const p2Res = await app.inject({
      method: 'POST',
      url: '/player/profiles',
      headers: { 'x-test-user-id': PARENT_USER },
      payload: {
        fullName: 'Aarav Ashwanth',
        username: 'aarav_chess',
        relationship: 'child',
        yearOfBirth: 2016,
        gender: 'M',
        fideId: 5820001,
        fideRapid: 1450,
        school: 'SJK(C) Chung Kwo',
        city: 'Kuala Lumpur',
      },
    });
    expect(p2Res.statusCode).toBe(201);
    const childProfile = p2Res.json().profile as { id: string; relationship: string; isPrimary: boolean };
    expect(childProfile.relationship).toBe('child');
    expect(childProfile.isPrimary).toBe(false);

    // 3. Claim past & live participations for the child profile via the confirmed email
    const claimRes = await app.inject({
      method: 'POST',
      url: `/player/profiles/${childProfile.id}/claim`,
      headers: { 'x-test-user-id': PARENT_USER, 'x-test-user-email': 'parent@example.com' },
      payload: {},
    });
    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json().claimedCount).toBe(2);

    // 4. Fetch dashboard for the child profile
    const dashRes = await app.inject({
      method: 'GET',
      url: `/player/dashboard?profileId=${childProfile.id}`,
      headers: { 'x-test-user-id': PARENT_USER },
    });
    expect(dashRes.statusCode).toBe(200);
    const dash = dashRes.json();

    expect(dash.profiles).toHaveLength(2);
    expect(dash.selectedProfile.id).toBe(childProfile.id);
    expect(dash.stats).toEqual({
      tournamentsCount: 2,
      gamesPlayed: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      totalPoints: 1.5,
    });
    expect(dash.liveMatches).toHaveLength(1);
    expect(dash.liveMatches[0]).toMatchObject({
      tournamentId: TOURNAMENT_LIVE,
      tournamentName: 'Malaysia Youth Championship 2026',
      round: 2,
      board: 4,
      color: 'black',
      opponentName: 'Zara Lim',
      opponentRating: 1510,
      result: 'pending',
      currentScore: 0.5,
    });
    expect(dash.certificates).toHaveLength(1);
    expect(dash.certificates[0]).toMatchObject({
      id: '88888888-8888-4888-8888-888888888801',
      serial: 'SRO/001/2026',
      type: 'winner',
      rank: 1,
    });
  });
});
