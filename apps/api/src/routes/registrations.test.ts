import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../db.js';
import { organizationsPlugin } from './organizations.js';
import { playerProfilesPlugin } from './playerProfiles.js';
import { registrationsPlugin } from './registrations.js';
import { tournamentsPlugin } from './tournaments.js';

const ORGANIZER_USER = '11111111-1111-4111-8111-111111111111';
const PARENT_USER = '22222222-2222-4222-8222-222222222222';
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
  await app.register(playerProfilesPlugin, { store });
  await app.register(registrationsPlugin, { store });
  return app;
}

describe('registrations & GPS discovery routes (Phase 2)', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('enforces B2B verification gate for global publishing, filters by GPS Haversine distance, supports 1-click profile registration + receipt upload, and auto-creates roster participant on approval', async () => {
    const app = await buildTestApp(store);

    // 1. Organizer creates an organization (starts in Sandbox Trial: canPublishGlobal = false)
    const orgRes = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        name: 'KL Chess Academy',
        city: 'Kuala Lumpur',
        state: 'WP Kuala Lumpur',
        paymentInstructions: 'DuitNow QR to Maybank 5140-1122-3344',
      },
    });
    expect(orgRes.statusCode).toBe(201);
    const org = orgRes.json().organization as { id: string };

    // 2. Organizer creates a tournament with Under-12 and Under-18 categories
    const tRes = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        name: 'KL Junior Rapid Championship 2026',
        date: '2026-12-10',
        style: 'swiss',
        rounds: 6,
        categories: [
          {
            name: 'Under 12',
            filter: {
              logic: 'and',
              rules: [{ field: 'age', op: 'lt', value: 12 }],
            },
            sortOrder: 0,
          },
          {
            name: 'Under 18',
            filter: {
              logic: 'and',
              rules: [
                { field: 'age', op: 'gte', value: 12 },
                { field: 'age', op: 'lt', value: 18 },
              ],
            },
            sortOrder: 1,
          },
        ],
      },
    });
    expect(tRes.statusCode).toBe(201);
    const tournament = tRes.json() as { id: string };

    // 3. Attempting to publish globally or collect paid fees while unverified in trial -> 403
    const blockedPublishRes = await app.inject({
      method: 'PATCH',
      url: `/tournaments/${tournament.id}/publishing`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        isPublishedGlobal: true,
        registrationOpen: true,
        entryFeeCents: 3500,
      },
    });
    expect(blockedPublishRes.statusCode).toBe(403);
    expect(blockedPublishRes.json().error).toMatch(/Organizer Verification is required/i);

    // 4. Platform Admin verifies the organization and enables global publishing + paid registrations
    const verifyRes = await app.inject({
      method: 'PATCH',
      url: `/admin/organizations/${org.id}`,
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
    expect(verifyRes.statusCode).toBe(200);

    // 5. Organizer publishes the KL tournament (KLCC coordinates: 3.1579, 101.7116)
    const publishKlRes = await app.inject({
      method: 'PATCH',
      url: `/tournaments/${tournament.id}/publishing`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        publicSlug: 'kl-junior-rapid-2026',
        isPublishedGlobal: true,
        registrationOpen: true,
        venueName: 'KL Convention Centre',
        venueAddress: 'Kuala Lumpur City Centre, 50088 KL',
        city: 'Kuala Lumpur',
        state: 'WP Kuala Lumpur',
        latitude: 3.1579,
        longitude: 101.7116,
        timeControl: '15m + 10s Rapid',
        entryFeeCents: 3500,
        currency: 'MYR',
        paymentInstructions: 'DuitNow QR to KL Chess Academy',
      },
    });
    expect(publishKlRes.statusCode).toBe(200);
    expect(publishKlRes.json().tournament.publicSlug).toBe('kl-junior-rapid-2026');

    // Create a 2nd tournament far away in Penang (5.4141, 100.3288 ~300 km from KL)
    const tPenangRes = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        name: 'Penang Island Open 2026',
        date: '2026-12-20',
        style: 'swiss',
        rounds: 7,
      },
    });
    const tPenang = tPenangRes.json() as { id: string };
    await app.inject({
      method: 'PATCH',
      url: `/tournaments/${tPenang.id}/publishing`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        publicSlug: 'penang-island-open-2026',
        isPublishedGlobal: true,
        registrationOpen: true,
        city: 'George Town',
        state: 'Penang',
        latitude: 5.4141,
        longitude: 100.3288,
      },
    });

    // 6. Public GPS nearby search from Petaling Jaya (3.1073, 101.6067) within 25km
    const nearbyRes = await app.inject({
      method: 'GET',
      url: '/public/events?lat=3.1073&lng=101.6067&radiusKm=25',
    });
    expect(nearbyRes.statusCode).toBe(200);
    const nearbyEvents = nearbyRes.json().events as Array<{
      id: string;
      publicSlug: string;
      distanceKm: number;
    }>;
    expect(nearbyEvents).toHaveLength(1);
    expect(nearbyEvents[0]!.publicSlug).toBe('kl-junior-rapid-2026');
    expect(nearbyEvents[0]!.distanceKm).toBeGreaterThan(5);
    expect(nearbyEvents[0]!.distanceKm).toBeLessThan(20);

    // 7. Fetch public event details by slug
    const detailRes = await app.inject({
      method: 'GET',
      url: '/public/events/kl-junior-rapid-2026',
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().event.entryFeeCents).toBe(3500);
    expect(detailRes.json().categories).toHaveLength(2);

    // 8. Parent creates a child player profile (born 2016 -> age 10 -> Under 12)
    const childProfileRes = await app.inject({
      method: 'POST',
      url: '/player/profiles',
      headers: { 'x-test-user-id': PARENT_USER },
      payload: { guardianConsent: true,
        fullName: 'Aarav Ashwanth',
        relationship: 'child',
        yearOfBirth: new Date().getFullYear() - 10,
        gender: 'M',
        fideId: 5820999,
        fideRapid: 1480,
        school: 'SJK(C) Chung Kwo',
        city: 'Kuala Lumpur',
        email: 'parent@example.com',
        phone: '+60123456789',
      },
    });
    expect(childProfileRes.statusCode).toBe(201);
    const childProfile = childProfileRes.json().profile as { id: string };

    // 9. Parent submits 1-click registration using playerProfileId + receipt upload
    const regRes = await app.inject({
      method: 'POST',
      url: '/public/events/kl-junior-rapid-2026/register',
      headers: { 'x-test-user-id': PARENT_USER },
      payload: { guardianConsent: true,
        playerProfileId: childProfile.id,
        receiptDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const reg = regRes.json().registration as {
      id: string;
      status: string;
      paymentStatus: string;
      playerSnapshot: { name: string; fideId: number; rating: number; school: string };
    };
    expect(reg.status).toBe('pending');
    expect(reg.paymentStatus).toBe('submitted');
    expect(reg.playerSnapshot).toMatchObject({
      name: 'Aarav Ashwanth',
      fideId: 5820999,
      rating: 1480,
      school: 'SJK(C) Chung Kwo',
    });

    // 10. Duplicate active registration for the same profile is blocked (409)
    const dupRes = await app.inject({
      method: 'POST',
      url: '/public/events/kl-junior-rapid-2026/register',
      headers: { 'x-test-user-id': PARENT_USER },
      payload: { guardianConsent: true,
        playerProfileId: childProfile.id,
      },
    });
    expect(dupRes.statusCode).toBe(409);

    // 11. Organizer lists registrations and approves Aarav into the tournament roster
    const listRegsRes = await app.inject({
      method: 'GET',
      url: `/tournaments/${tournament.id}/registrations`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
    });
    expect(listRegsRes.statusCode).toBe(200);
    expect(listRegsRes.json().registrations).toHaveLength(1);

    const reviewRes = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.id}/registrations/${reg.id}/review`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        action: 'approve',
        reviewerNote: 'DuitNow receipt verified',
      },
    });
    expect(reviewRes.statusCode).toBe(200);
    const reviewed = reviewRes.json() as {
      registration: { status: string; paymentStatus: string; participantId: string };
      participant: {
        id: string;
        name: string;
        playerProfileId: string;
        fideId: number;
        rating: number;
        categoryIds: string[];
      };
    };
    expect(reviewed.registration.status).toBe('approved');
    expect(reviewed.registration.paymentStatus).toBe('verified');
    expect(reviewed.participant).toBeTruthy();
    expect(reviewed.participant.name).toBe('Aarav Ashwanth');
    expect(reviewed.participant.playerProfileId).toBe(childProfile.id);
    expect(reviewed.participant.fideId).toBe(5820999);
    expect(reviewed.participant.rating).toBe(1480);

    // Under-12 category should be auto-assigned via assignCategories!
    const u12Cat = detailRes.json().categories.find((c: { name: string }) => c.name === 'Under 12');
    expect(reviewed.participant.categoryIds).toContain(u12Cat.id);

    // Roster now has 1 active participant
    const roster = await store.listParticipants(tournament.id);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.id).toBe(reviewed.participant.id);
  });
});
