/**
 * ID numbers on rosters and who can read custom fields, plus plan limits and organization details,
 * through the real routes on both stores.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskNricFields } from '@chess-alokas/shared';
import { TEST_STORES, buildTestApp, type TestApp, type TestBackend } from '../testBackends.js';

const NRIC = '140305-14-5678';
const NRIC_PLAIN = '140706105555';

describe('maskNricFields', () => {
  it('masks by column name and by shape, and leaves everything else', () => {
    const out = maskNricFields({
      'NO IC': NRIC_PLAIN,
      'NRIC/Passport': 'A1234567',
      'No KP': '990101-01-0001',
      'Kad Pengenalan': NRIC,
      Unlabelled: NRIC,
      Topic: 'Openings',
      Music: 'Yes',
      'Contact no': '601212345678',
      checkedIn: true,
      Empty: '',
    });
    expect(out['NO IC']).toBe('******-**-5555');
    expect(out['NRIC/Passport']).toBe('******-**-4567');
    expect(out['No KP']).toBe('******-**-0001');
    expect(out['Kad Pengenalan']).toBe('******-**-5678');
    expect(out['Unlabelled']).toBe('******-**-5678');
    expect(out['Topic']).toBe('Openings');
    expect(out['Music']).toBe('Yes');
    expect(out['Contact no']).toBe('601212345678');
    expect(out['checkedIn']).toBe(true);
    expect(out['Empty']).toBe('');
    expect(maskNricFields(null)).toEqual({});
  });
});

describe.each(TEST_STORES)('rosters and plans: %s', (_name, makeBackend) => {
  let backend: TestBackend;
  let t: TestApp;

  beforeAll(async () => {
    backend = await makeBackend();
    t = await buildTestApp(backend);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
    await backend?.close();
  });

  async function importCsv(user: string, tournamentId: string, csv: string) {
    const boundary = '----rosterprivacy';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="mapping"',
      '',
      JSON.stringify({ name: 'Name', age: 'Age', club: 'School' }),
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="roster.csv"',
      'Content-Type: text/csv',
      '',
      csv,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return t.app.inject({
      method: 'POST',
      url: `/tournaments/${tournamentId}/import`,
      headers: { 'x-test-user-id': user, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('keeps only a mask from a CSV import, and nothing public or for arbiters shows it', async () => {
    const owner = await t.newUser();
    const org = await t.verifiedOrg(owner);
    const tournament = await t.seedTournament(owner, org.id);
    const arbiter = await t.newUser();
    await backend.addMember(org.id, arbiter, 'arbiter');

    const res = await importCsv(
      owner,
      tournament.id,
      `Name,Age,School,NO IC,Shirt\nAina Tester,12,SK Pretend,${NRIC},M\n`,
    );
    expect(res.statusCode).toBe(201);
    const [player] = await backend.store.listParticipants(tournament.id);
    expect(player?.customFields).toMatchObject({ 'NO IC': '******-**-5678', Shirt: 'M' });
    expect(JSON.stringify(player)).not.toContain('140305');

    const enabled = await t.call(owner, 'POST', `/tournaments/${tournament.id}/public-live/enable`);
    await t.call(owner, 'PATCH', `/tournaments/${tournament.id}/publishing`, { registrationOpen: true });
    for (const look of [
      await t.call(null, 'GET', `/public/live/${enabled.body.publicToken}`),
      await t.call(null, 'GET', `/public/events/${tournament.id}`),
    ]) {
      expect(look.status).toBe(200);
      const text = JSON.stringify(look.body);
      expect(text).toContain('Aina');
      expect(text).not.toContain('5678');
      expect(text).not.toContain('customFields');
    }

    // An arbiter can't reach the roster's custom fields at all, masked or not.
    const pull = await t.call(arbiter, 'GET', '/sync/pull?since=1970-01-01T00:00:00.000Z');
    expect(pull.status).toBe(200);
    expect(JSON.stringify(pull.body)).not.toContain('NO IC');
    expect((await t.call(arbiter, 'GET', `/tournaments/${tournament.id}`)).status).toBe(403);
    const tables = await t.call(arbiter, 'GET', `/tournaments/${tournament.id}/floor/tables`);
    expect(JSON.stringify(tables.body)).not.toContain('NO IC');
  });

  it('masks an ID number that an older desk pushes through sync', async () => {
    const owner = await t.newUser();
    const org = await t.verifiedOrg(owner);
    const tournament = await t.seedTournament(owner, org.id);
    const id = crypto.randomUUID();
    const pushed = await t.call(owner, 'POST', '/sync/push', {
      clientId: 'old-desk',
      reportRejections: true,
      items: [
        {
          entity: 'participant',
          id,
          payload: {
            tournamentId: tournament.id,
            name: 'Budi Pretend',
            age: 11,
            customFields: { 'NRIC no': NRIC_PLAIN, checkedIn: true },
          },
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          deletedAt: null,
        },
      ],
    });
    expect(pushed.body.rejected).toEqual([]);
    const player = await backend.store.getParticipant(id);
    expect(player?.customFields).toEqual({ 'NRIC no': '******-**-5555', checkedIn: true });
  });

  it('masks an ID number typed into a text question when it reaches the roster, not in the entry', async () => {
    const owner = await t.newUser();
    const org = await t.verifiedOrg(owner);
    const tournament = await t.seedTournament(owner, org.id);
    await t.call(owner, 'PATCH', `/tournaments/${tournament.id}/publishing`, {
      registrationOpen: true,
      registrationFormSchema: { customQuestions: [{ id: 'q_id', label: 'Your number', type: 'text' }] },
    });
    const entry = await t.call(null, 'POST', `/public/events/${tournament.id}/register`, {
      name: 'Citra Pretend',
      customAnswers: { q_id: NRIC },
    });
    const approved = await t.call(
      owner,
      'POST',
      `/tournaments/${tournament.id}/registrations/${entry.body.registration.id}/review`,
      { action: 'approve' },
    );
    expect(approved.body.participant.customFields.q_id).toBe('******-**-5678');
  });

  describe('player limit against the plan', () => {
    async function trial() {
      const owner = await t.newUser();
      const created = await t.call(owner, 'POST', '/organizations', { name: `Trial ${crypto.randomUUID().slice(0, 8)}` });
      expect(created.status).toBe(201);
      const tournament = await t.call(owner, 'POST', '/tournaments', {
        name: 'Trial Event',
        date: '2030-01-01',
        style: 'swiss',
        rounds: 5,
        categories: [],
      });
      expect(tournament.status).toBe(201);
      return { owner, orgId: created.body.organization.id as string, id: tournament.body.id as string };
    }

    it('holds a trial’s limit to the plan when saving, and says so', async () => {
      const { owner, id } = await trial();
      const over = await t.call(owner, 'PATCH', `/tournaments/${id}/publishing`, { maxParticipants: 40 });
      expect(over.status).toBe(200);
      expect(over.body.tournament.maxParticipants).toBe(24);
      expect(over.body.playerLimitCapped).toBe(24);

      const empty = await t.call(owner, 'PATCH', `/tournaments/${id}/publishing`, { maxParticipants: null });
      expect(empty.body.tournament.maxParticipants).toBe(24);

      const under = await t.call(owner, 'PATCH', `/tournaments/${id}/publishing`, { maxParticipants: 10 });
      expect(under.body.tournament.maxParticipants).toBe(10);
      expect(under.body).not.toHaveProperty('playerLimitCapped');

      const screen = await t.call(owner, 'GET', `/tournaments/${id}/publishing`);
      expect(screen.body.can.maxPlayers).toBe(24);
    });

    it('leaves a verified academy with no plan limit alone', async () => {
      const owner = await t.newUser();
      const org = await t.verifiedOrg(owner);
      const tournament = await t.seedTournament(owner, org.id);
      const res = await t.call(owner, 'PATCH', `/tournaments/${tournament.id}/publishing`, { maxParticipants: 500 });
      expect(res.body.tournament.maxParticipants).toBe(500);
      expect(res.body).not.toHaveProperty('playerLimitCapped');
      const cleared = await t.call(owner, 'PATCH', `/tournaments/${tournament.id}/publishing`, { maxParticipants: null });
      expect(cleared.body.tournament.maxParticipants ?? null).toBeNull();
    });

    it('waitlists an entry once a trial’s roster reaches the plan, even with no limit set', async () => {
      const { owner, id, orgId } = await trial();
      await backend.store.adminUpdateOrganization(orgId, { maxPlayersPerTournament: 1 });
      await t.call(owner, 'PATCH', `/tournaments/${id}/publishing`, { registrationOpen: true });
      const first = await t.call(null, 'POST', `/public/events/${id}/register`, { name: 'First Player' });
      expect(first.body.registration.status).toBe('pending');
      const approved = await t.call(owner, 'POST', `/tournaments/${id}/registrations/${first.body.registration.id}/review`, {
        action: 'approve',
      });
      expect(approved.status).toBe(200);
      const second = await t.call(null, 'POST', `/public/events/${id}/register`, { name: 'Second Player' });
      expect(second.body.registration.status).toBe('waitlisted');
    });
  });

  it('no longer offers an organization’s stored QR path to public pages', async () => {
    const owner = await t.newUser();
    const org = await t.verifiedOrg(owner);
    const patched = await t.call(owner, 'PATCH', `/organizations/${org.id}`, {
      paymentQrStoragePath: 'https://elsewhere.example/track.png',
    });
    expect(patched.status).toBe(200);
    const tournament = await t.seedTournament(owner, org.id);
    await t.call(owner, 'PATCH', `/tournaments/${tournament.id}/publishing`, { registrationOpen: true });
    const page = await t.call(null, 'GET', `/public/events/${tournament.id}`);
    expect(page.body.event.paymentQrUrl).toBeNull();
    expect(JSON.stringify(page.body)).not.toContain('elsewhere.example');
  });

  describe('organization details', () => {
    it('lets an owner or admin edit them on a verified academy, and no one else', async () => {
      const owner = await t.newUser();
      const org = await t.verifiedOrg(owner);
      const admin = await t.newUser();
      await backend.addMember(org.id, admin, 'admin');
      const director = await t.newUser();
      await backend.addMember(org.id, director, 'director');
      const arbiter = await t.newUser();
      await backend.addMember(org.id, arbiter, 'arbiter');
      const url = `/organizations/${org.id}`;
      const details = {
        description: 'A pretend academy',
        website: 'https://pretend.example',
        contactEmail: 'desk@pretend.example',
        country: 'Singapore',
      };
      const saved = await t.call(admin, 'PATCH', url, details);
      expect(saved.status).toBe(200);
      expect(saved.body.organization).toMatchObject(details);
      for (const other of [director, arbiter, await t.newUser()]) {
        expect((await t.call(other, 'PATCH', url, { description: 'No' })).status).toBe(403);
      }
    });

    it('refuses a website that isn’t a web address, and clears one with an empty value', async () => {
      const owner = await t.newUser();
      const org = await t.verifiedOrg(owner);
      const url = `/organizations/${org.id}`;
      expect((await t.call(owner, 'PATCH', url, { website: 'javascript:alert(1)' })).status).toBe(400);
      expect((await t.call(owner, 'PATCH', url, { website: null })).status).toBe(200);
    });
  });
});
