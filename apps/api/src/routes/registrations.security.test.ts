import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../db.js';
import { organizationsPlugin } from './organizations.js';
import { playerProfilesPlugin } from './playerProfiles.js';
import { registrationsPlugin } from './registrations.js';
import { tournamentsPlugin } from './tournaments.js';

const NO_ORG_USER = '33333333-3333-4333-8333-333333333333';
const ORGANIZER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const ADMIN = '99999999-9999-4999-8999-999999999999';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function buildApp(store: MemoryStore) {
  process.env['AUTH_DISABLED'] = '1';
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    void reply.code(statusCode).send({ error: (error as Error).message });
  });
  await app.register(organizationsPlugin, { store });
  await app.register(tournamentsPlugin, { store });
  await app.register(playerProfilesPlugin, { store });
  await app.register(registrationsPlugin, { store });
  return app;
}

type App = Awaited<ReturnType<typeof buildApp>>;
const as = (user: string) => ({ 'x-test-user-id': user });

async function createTournament(app: App, user: string, name = 'Junior Rapid') {
  const res = await app.inject({
    method: 'POST',
    url: '/tournaments',
    headers: as(user),
    payload: { name, date: '2030-01-01', style: 'swiss', rounds: 5, categories: [] },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function verifiedEvent(app: App, patch: Record<string, unknown> = {}) {
  const orgRes = await app.inject({
    method: 'POST',
    url: '/organizations',
    headers: as(ORGANIZER),
    payload: { name: `Academy ${crypto.randomUUID().slice(0, 8)}`, city: 'KL' },
  });
  const org = orgRes.json().organization as { id: string };
  const verify = await app.inject({
    method: 'PATCH',
    url: `/admin/organizations/${org.id}`,
    headers: as(ADMIN),
    payload: {
      verificationStatus: 'verified',
      planTier: 'pro',
      canPublishGlobal: true,
      canAcceptPaidRegistrations: true,
    },
  });
  expect(verify.statusCode).toBe(200);
  const t = await createTournament(app, ORGANIZER);
  const pub = await app.inject({
    method: 'PATCH',
    url: `/tournaments/${t.id}/publishing`,
    headers: as(ORGANIZER),
    payload: { registrationOpen: true, ...patch },
  });
  expect(pub.statusCode).toBe(200);
  return { tournamentId: t.id, orgId: org.id };
}

describe('registration security', () => {
  let store: MemoryStore;
  let app: App;
  let receiptsDir: string;

  beforeAll(() => {
    receiptsDir = mkdtempSync(path.join(tmpdir(), 'alokas-receipts-'));
    process.env['RECEIPTS_DIR'] = receiptsDir;
  });
  afterAll(() => {
    delete process.env['RECEIPTS_DIR'];
    rmSync(receiptsDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp(store);
  });

  it('applies trial limits to accounts with no organization', async () => {
    const first = await createTournament(app, NO_ORG_USER);
    const second = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: as(NO_ORG_USER),
      payload: { name: 'Second', date: '2030-01-01', style: 'swiss', rounds: 5, categories: [] },
    });
    expect(second.statusCode).toBe(403);

    for (const payload of [{ isPublishedGlobal: true }, { entryFeeCents: 1000 }]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/tournaments/${first.id}/publishing`,
        headers: as(NO_ORG_USER),
        payload,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('removes events from the feed when the organization is suspended', async () => {
    const { orgId } = await verifiedEvent(app, { isPublishedGlobal: true });
    const before = await app.inject({ method: 'GET', url: '/public/events' });
    expect(before.json().events).toHaveLength(1);

    await app.inject({
      method: 'PATCH',
      url: `/admin/organizations/${orgId}`,
      headers: as(ADMIN),
      payload: { verificationStatus: 'suspended' },
    });
    const after = await app.inject({ method: 'GET', url: '/public/events' });
    expect(after.json().events).toHaveLength(0);
  });

  it('hides unpublished tournaments and leaves minors details out of public rosters', async () => {
    const hidden = await createTournament(app, NO_ORG_USER);
    const res404 = await app.inject({ method: 'GET', url: `/public/events/${hidden.id}` });
    expect(res404.statusCode).toBe(404);

    const { tournamentId } = await verifiedEvent(app);
    const reg = await app.inject({
      method: 'POST',
      url: `/public/events/${tournamentId}/register`,
      payload: { guardianConsent: true, name: 'Child Player', yearOfBirth: 2016, school: 'A School', city: 'KL' },
    });
    const regId = reg.json().registration.id as string;
    await app.inject({
      method: 'POST',
      url: `/tournaments/${tournamentId}/registrations/${regId}/review`,
      headers: as(ORGANIZER),
      payload: { action: 'approve' },
    });
    const detail = await app.inject({ method: 'GET', url: `/public/events/${tournamentId}` });
    const [player] = detail.json().participants as Record<string, unknown>[];
    expect(player?.['name']).toBe('Child Player');
    for (const field of ['yearOfBirth', 'school', 'city', 'state', 'country', 'email']) {
      expect(player).not.toHaveProperty(field);
    }
  });

  it('refuses anonymous use of a saved profile and other accounts profiles', async () => {
    const { tournamentId } = await verifiedEvent(app);
    const profile = await app.inject({
      method: 'POST',
      url: '/player/profiles',
      headers: as(OTHER_USER),
      payload: { guardianConsent: true,
        fullName: 'Private Child',
        relationship: 'child',
        email: 'parent@example.com',
        phone: '+60000000000',
      },
    });
    expect(profile.statusCode).toBe(201);
    const playerProfileId = (profile.json().profile as { id: string }).id;

    const anonymous = await app.inject({
      method: 'POST',
      url: `/public/events/${tournamentId}/register`,
      payload: { guardianConsent: true, playerProfileId },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).not.toContain('parent@example.com');

    const wrongAccount = await app.inject({
      method: 'POST',
      url: `/public/events/${tournamentId}/register`,
      headers: as(ORGANIZER),
      payload: { guardianConsent: true, playerProfileId },
    });
    expect(wrongAccount.statusCode).toBe(403);
  });

  it('enforces the deadline and waitlists once the event is full', async () => {
    const late = await verifiedEvent(app, { registrationDeadline: '2020-01-01T00:00:00.000Z' });
    const lateRes = await app.inject({
      method: 'POST',
      url: `/public/events/${late.tournamentId}/register`,
      payload: { guardianConsent: true, name: 'Too Late' },
    });
    expect(lateRes.statusCode).toBe(400);

    const small = await verifiedEvent(app, { maxParticipants: 1 });
    const firstReg = await app.inject({
      method: 'POST',
      url: `/public/events/${small.tournamentId}/register`,
      payload: { guardianConsent: true, name: 'First Player' },
    });
    expect(firstReg.json().registration.status).toBe('pending');
    await app.inject({
      method: 'POST',
      url: `/tournaments/${small.tournamentId}/registrations/${firstReg.json().registration.id}/review`,
      headers: as(ORGANIZER),
      payload: { action: 'approve' },
    });
    const secondReg = await app.inject({
      method: 'POST',
      url: `/public/events/${small.tournamentId}/register`,
      payload: { guardianConsent: true, name: 'Second Player' },
    });
    expect(secondReg.json().registration.status).toBe('waitlisted');
    const approveOverCapacity = await app.inject({
      method: 'POST',
      url: `/tournaments/${small.tournamentId}/registrations/${secondReg.json().registration.id}/review`,
      headers: as(ORGANIZER),
      payload: { action: 'approve' },
    });
    expect(approveOverCapacity.statusCode).toBe(409);
  });

  it('rejects non-image receipts and serves real ones only to the organizer', async () => {
    const { tournamentId } = await verifiedEvent(app, { entryFeeCents: 3000 });
    const url = `/public/events/${tournamentId}/register`;

    for (const receiptDataUrl of [
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url,
        payload: { guardianConsent: true, name: 'Bad Receipt', receiptDataUrl },
      });
      expect(res.statusCode).toBe(400);
    }

    const ok = await app.inject({
      method: 'POST',
      url,
      payload: { guardianConsent: true, name: 'Paid Player', receiptDataUrl: PNG },
    });
    expect(ok.statusCode).toBe(201);
    const registration = ok.json().registration as Record<string, unknown>;
    expect(registration['hasReceipt']).toBe(true);
    expect(registration['paymentStatus']).toBe('submitted');
    expect(registration).not.toHaveProperty('receiptDataUrl');
    expect(registration).not.toHaveProperty('receiptStoragePath');

    const receiptUrl = `/tournaments/${tournamentId}/registrations/${registration['id']}/receipt`;
    const forbidden = await app.inject({ method: 'GET', url: receiptUrl, headers: as(OTHER_USER) });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: 'GET', url: receiptUrl, headers: as(ORGANIZER) });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['content-type']).toBe('image/png');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.rawPayload.subarray(1, 4).toString()).toBe('PNG');

    const list = await app.inject({
      method: 'GET',
      url: `/tournaments/${tournamentId}/registrations`,
      headers: as(ORGANIZER),
    });
    expect(list.body).not.toContain('base64');
  });
});
