/**
 * Goes through every tournament-scoped route as someone from another organization and expects a
 * refusal, then checks nothing moved. The routes come from Fastify itself, so a new route joins the
 * sweep by existing. If it needs a body to reach its permission check, add one to BODIES.
 */
import type { Game } from '@chess-alokas/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashArbiterPin } from './floor/pin.js';
import { TEST_STORES, buildTestApp, type TestApp, type TestBackend } from './testBackends.js';

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');

/** Open to any signed-in user on purpose: it reads Lichess, not tournament data. See tournaments.ts. */
const NOT_TENANT_DATA = new Set(['POST /tournaments/:id/fide-lookup']);

/** What the API's role table gives an arbiter. Everything else on these paths refuses them too. */
const ARBITER_ALLOWED = new Set([
  'GET /tournaments/:id/floor/tables',
  'POST /tournaments/:id/floor/rotate-pin',
  'GET /tournaments/:id/floor/alerts',
  'POST /tournaments/:id/floor/alerts/:alertId/resolve',
]);

/** Routes that check the body first would answer 400 without one, which proves nothing. */
const BODIES: Record<string, unknown> = {
  'PATCH /games/:id/result': { result: '0-1', confirm: true },
  'POST /tournaments/:id/games/:gameId/cards': { playerSide: 'white', cardType: 'warning' },
};

function isTournamentScoped(url: string): boolean {
  return (
    url.startsWith('/tournaments/:id') ||
    url.startsWith('/games/:id') ||
    url.startsWith('/categories/:id') ||
    url.startsWith('/certificates/:issueId')
  );
}

describe.each(TEST_STORES)('cross-tenant sweep: %s', (_name, makeBackend) => {
  let backend: TestBackend;
  let t: TestApp;
  let owner: string;
  let arbiter: string;
  let outsider: string;
  let outsiderTournamentId: string;
  let params: Record<string, string>;
  let tournamentId: string;
  let game: Game;

  /** The tournament as its owner sees it, for proving a refused request changed nothing. */
  async function snapshot() {
    const [full, cards, issues, registrations, tables, alerts] = await Promise.all([
      t.call(owner, 'GET', `/tournaments/${tournamentId}`),
      t.call(owner, 'GET', `/tournaments/${tournamentId}/game-cards`),
      t.call(owner, 'GET', `/tournaments/${tournamentId}/certificates`),
      t.call(owner, 'GET', `/tournaments/${tournamentId}/registrations`),
      t.call(owner, 'GET', `/tournaments/${tournamentId}/floor/tables`),
      t.call(owner, 'GET', `/tournaments/${tournamentId}/floor/alerts?activeOnly=false`),
    ]);
    expect(full.status).toBe(200);
    return JSON.stringify([full.body, cards.body, issues.body, registrations.body, tables.body, alerts.body]);
  }

  const urlFor = (route: string) =>
    route.replace(/:(\w+)/g, (_match, name: string) => params[name] ?? crypto.randomUUID());

  const sweptRoutes = () =>
    t.routes.filter((r) => isTournamentScoped(r.url) && !NOT_TENANT_DATA.has(`${r.method} ${r.url}`));

  beforeAll(async () => {
    backend = await makeBackend();
    t = await buildTestApp(backend);
    const { store } = backend;
    owner = await t.newUser();
    arbiter = await t.newUser();
    outsider = await t.newUser();
    const org = await t.verifiedOrg(owner);
    await backend.addMember(org.id, arbiter, 'arbiter');
    const outsiderOrg = await t.verifiedOrg(outsider);
    outsiderTournamentId = (await t.seedTournament(outsider, outsiderOrg.id)).id;

    const tournament = await t.seedTournament(owner, org.id, {
      publicEnabled: true,
      publicToken: `live-${crypto.randomUUID()}`,
      registrationOpen: true,
    });
    tournamentId = tournament.id;
    const category = await store.createCategory({
      id: crypto.randomUUID(),
      tournamentId,
      name: 'Open',
      filter: { logic: 'and', rules: [] },
      sortOrder: 0,
      prizePlaces: null,
      updatedAt: iso(-3_600_000),
    });
    const player = (name: string) =>
      store.createParticipant({
        id: crypto.randomUUID(),
        tournamentId,
        name,
        age: 10,
        customFields: {},
        categoryIds: [category.id],
        updatedAt: iso(-3_600_000),
      } as never);
    const [white, black] = await Promise.all([player('White Player'), player('Black Player')]);
    game = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId,
      categoryId: category.id,
      round: 1,
      board: 1,
      whiteId: white.id,
      blackId: black.id,
      result: 'pending',
      isBye: false,
      updatedAt: iso(-3_600_000),
    });
    await store.ensureTables(tournamentId, 2);
    await store.setArbiterPin(tournamentId, hashArbiterPin('123456'), 1);
    const card = await store.createGameCard({
      id: crypto.randomUUID(),
      gameId: game.id,
      tournamentId,
      playerId: white.id,
      cardType: 'warning',
      note: null,
      actorRole: 'director',
      actorName: 'Director',
      actorUserId: owner,
      createdAt: iso(),
      deletedAt: null,
    } as never);
    const alert = await store.createFloorAlert({
      id: crypto.randomUUID(),
      tournamentId,
      round: 1,
      tableNumber: 1,
      gameId: game.id,
      arbiterName: 'Floor',
      reason: 'Help',
      createdAt: iso(),
      resolvedAt: null,
    });
    const registration = await store.createTournamentRegistration({
      id: crypto.randomUUID(),
      tournamentId,
      playerSnapshot: { name: 'Entrant', email: 'entrant@example.com' },
      customAnswers: {},
      paymentStatus: 'not_required',
      amountCents: 0,
      status: 'pending',
      createdAt: iso(),
      updatedAt: iso(),
    } as never);
    const issued = await t.call(owner, 'POST', `/tournaments/${tournamentId}/certificates/issue`, {
      items: [
        {
          type: 'participation',
          recipientName: 'White Player',
          recipientEmail: 'white@example.com',
          participantId: white.id,
          pdfBase64: PDF,
        },
      ],
    });
    expect(issued.status).toBe(201);

    params = {
      id: tournamentId,
      round: '1',
      gameId: game.id,
      cardId: card.id,
      alertId: alert.id,
      regId: registration.id,
      issueId: issued.body.issues[0].id,
      categoryId: category.id,
    };
  }, 180_000);

  afterAll(async () => {
    await t?.close();
    await backend?.close();
  });

  /** Routes keyed by something other than a tournament take that thing's id as :id. */
  function urlAs(route: { url: string }): string {
    if (route.url.startsWith('/games/:id')) return route.url.replace(':id', game.id);
    if (route.url.startsWith('/categories/:id')) return route.url.replace(':id', params['categoryId']!);
    return urlFor(route.url);
  }

  it('finds the routes it is meant to sweep', () => {
    const swept = sweptRoutes().map((r) => `${r.method} ${r.url}`);
    expect(swept.length).toBeGreaterThan(30);
    for (const expected of [
      'GET /tournaments/:id',
      'POST /tournaments/:id/rounds/:round/pair',
      'POST /tournaments/:id/rounds/:round/undo',
      'PATCH /games/:id/result',
      'GET /games/:id/history',
      'POST /tournaments/:id/import',
      'GET /tournaments/:id/registrations',
      'GET /certificates/:issueId/download',
    ]) {
      expect(swept).toContain(expected);
    }
  });

  it('a member of another organization is refused on every tournament-scoped route', async () => {
    const before = await snapshot();
    const unexpected: string[] = [];
    for (const route of sweptRoutes()) {
      const key = `${route.method} ${route.url}`;
      const res = await t.call(
        outsider,
        route.method as never,
        urlAs(route),
        route.method === 'GET' ? undefined : (BODIES[key] ?? {}),
      );
      if (res.status !== 403 && res.status !== 404) unexpected.push(`${key} answered ${res.status}`);
    }
    expect(unexpected).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it('an arbiter is refused everywhere the role table says, and nothing moves', async () => {
    const before = await snapshot();
    const unexpected: string[] = [];
    for (const route of sweptRoutes()) {
      const key = `${route.method} ${route.url}`;
      if (ARBITER_ALLOWED.has(key)) continue;
      const res = await t.call(
        arbiter,
        route.method as never,
        urlAs(route),
        route.method === 'GET' ? undefined : (BODIES[key] ?? {}),
      );
      if (res.status !== 403 && res.status !== 404) unexpected.push(`${key} answered ${res.status}`);
    }
    expect(unexpected).toEqual([]);
    expect(await snapshot()).toBe(before);
  });

  it('the sweep is aimed at real rows: the owner gets through on every read', async () => {
    const reads = sweptRoutes().filter((r) => r.method === 'GET');
    expect(reads.length).toBeGreaterThan(8);
    for (const route of reads) {
      const res = await t.call(owner, 'GET', urlAs(route));
      expect([200, 404], `${route.url} answered ${res.status}`).toContain(res.status);
      // Only a file that was never really stored may be missing here.
      if (res.status === 404) expect(route.url).toMatch(/receipt|nric|files|download/);
    }
  });

  it('an arbiter keeps the floor routes the role table gives them', async () => {
    const tables = await t.call(arbiter, 'GET', `/tournaments/${tournamentId}/floor/tables`);
    expect(tables.status).toBe(200);
    const alerts = await t.call(arbiter, 'GET', `/tournaments/${tournamentId}/floor/alerts`);
    expect(alerts.status).toBe(200);
  });

  describe('naming another tournament\'s rows from your own', () => {
    it.each([
      ['a game for a card', 'POST', () => `/tournaments/${outsiderTournamentId}/games/${game.id}/cards`, { playerSide: 'white', cardType: 'warning' }],
      ['a card to remove', 'DELETE', () => `/tournaments/${outsiderTournamentId}/games/${game.id}/cards/${params['cardId']}`, undefined],
      ['an alert to resolve', 'POST', () => `/tournaments/${outsiderTournamentId}/floor/alerts/${params['alertId']}/resolve`, {}],
      ['a receipt', 'GET', () => `/tournaments/${outsiderTournamentId}/registrations/${params['regId']}/receipt`, undefined],
      ['a registration to review', 'POST', () => `/tournaments/${outsiderTournamentId}/registrations/${params['regId']}/review`, { action: 'approve' }],
    ] as const)('%s is not found', async (_label, method, url, payload) => {
      const before = await snapshot();
      const res = await t.call(outsider, method, url(), payload);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await snapshot()).toBe(before);
    });

    it('certificates of another tournament can\'t be picked up by id', async () => {
      const before = await snapshot();
      const res = await t.call(outsider, 'POST', `/tournaments/${outsiderTournamentId}/certificates/email`, {
        issueIds: [params['issueId']],
        resend: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ sent: 0, failed: 0, results: [] });
      expect(await snapshot()).toBe(before);
    });
  });

  describe('sync', () => {
    const gameItem = (extra: Record<string, unknown>) => ({
      entity: 'game',
      id: game.id,
      payload: {
        tournamentId,
        categoryId: game.categoryId,
        round: game.round,
        board: game.board,
        whiteId: game.whiteId,
        blackId: game.blackId,
        result: '1-0',
        isBye: false,
        ...extra,
      },
      updatedAt: iso(),
      deletedAt: null,
    });

    it.each(['outsider', 'arbiter'] as const)('refuses a push from the %s', async (who) => {
      const user = who === 'outsider' ? outsider : arbiter;
      const before = await snapshot();
      const correction = {
        id: crypto.randomUUID(),
        previousResult: 'pending',
        result: '1-0',
        reason: 'Their mistake',
        at: iso(),
      };
      const items = [
        { entity: 'tournament', id: tournamentId, payload: { name: 'Taken', style: 'swiss', rounds: 5, status: 'draft' }, updatedAt: iso(), deletedAt: null },
        { entity: 'participant', id: crypto.randomUUID(), payload: { tournamentId, name: 'Intruder', age: 10 }, updatedAt: iso(), deletedAt: null },
        { entity: 'category', id: crypto.randomUUID(), payload: { tournamentId, name: 'Intruder', filter: { logic: 'and', rules: [] } }, updatedAt: iso(), deletedAt: null },
        gameItem({}),
        gameItem({ corrections: [correction] }),
      ];
      const res = await t.call(user, 'POST', '/sync/push', {
        clientId: 'sweep',
        items,
        reportRejections: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(0);
      expect(res.body.rejected).toHaveLength(items.length);
      expect(new Set(res.body.rejected.map((r: { code: string }) => r.code))).toEqual(new Set(['forbidden']));
      expect(await snapshot()).toBe(before);
    });

    it.each(['outsider', 'arbiter'] as const)('gives the %s nothing on a pull', async (who) => {
      const res = await t.call(
        who === 'outsider' ? outsider : arbiter,
        'GET',
        '/sync/pull?since=1970-01-01T00:00:00.000Z',
      );
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(tournamentId);
      expect(res.body.participants.map((p: { name: string }) => p.name)).not.toContain('White Player');
    });
  });

  it('the tournament list stays inside the organization', async () => {
    const res = await t.call(outsider, 'GET', '/tournaments');
    expect(res.status).toBe(200);
    expect(res.body.map((row: { id: string }) => row.id)).not.toContain(tournamentId);
  });
});
