import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../db.js';
import { floorPlugin } from './floor.js';
import { publicTablesPlugin } from './publicTables.js';
import { tournamentsPlugin } from './tournaments.js';

const ORGANIZER_USER = '11111111-1111-4111-8111-111111111111';

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
  await app.register(tournamentsPlugin, { store });
  await app.register(floorPlugin, { store });
  await app.register(publicTablesPlugin, { store });
  return app;
}

describe('Floor Arbiter Zone Grid & Chief Arbiter Alerts (Phase 3)', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('unlocks Table 1 with round PIN, fetches GET /public/tables/:slug/zone for all round boards, scores Table 2 with the same token, and raises + resolves a Call Chief Arbiter alert', async () => {
    const app = await buildTestApp(store);

    // 1. Create tournament with 1 category
    const tRes = await app.inject({
      method: 'POST',
      url: '/tournaments',
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        name: 'National Scholastic Open 2026',
        date: '2026-11-15',
        style: 'swiss',
        rounds: 5,
        categories: [
          {
            name: 'Under 12',
            filter: { logic: 'and', rules: [] },
            sortOrder: 0,
          },
        ],
      },
    });
    expect(tRes.statusCode).toBe(201);
    const tournament = tRes.json() as { id: string };
    const categories = await store.listCategories(tournament.id);
    const catId = categories[0]!.id;

    // 2. Seed 4 players and 2 Round 1 games (Board 1 and Board 2)
    const now = new Date().toISOString();
    const players = [
      { id: crypto.randomUUID(), name: 'Aiden Tan', rating: 1450 },
      { id: crypto.randomUUID(), name: 'Bella Lim', rating: 1400 },
      { id: crypto.randomUUID(), name: 'Chloe Wong', rating: 1350 },
      { id: crypto.randomUUID(), name: 'Danish Razak', rating: 1300 },
    ];
    await store.upsertParticipants(
      players.map((p, idx) => ({
        id: p.id,
        tournamentId: tournament.id,
        name: p.name,
        age: 11,
        rating: p.rating,
        customFields: {},
        categoryIds: [catId],
        seed: idx + 1,
        updatedAt: now,
      })),
    );

    const game1 = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      categoryId: catId,
      round: 1,
      board: 1,
      whiteId: players[0]!.id,
      blackId: players[1]!.id,
      result: 'pending',
      isBye: false,
      updatedAt: now,
    });
    const game2 = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      categoryId: catId,
      round: 1,
      board: 2,
      whiteId: players[2]!.id,
      blackId: players[3]!.id,
      result: 'pending',
      isBye: false,
      updatedAt: now,
    });

    await store.updateTournament(tournament.id, {
      status: 'in_progress',
      currentRound: 1,
      updatedAt: now,
    });

    // 3. Director prepares 2 floor tables and issues Round 1 PIN
    const prepRes = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.id}/floor/prepare`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
      payload: {
        tableCount: 2,
        pinRound: 1,
        rotatePin: true,
      },
    });
    expect(prepRes.statusCode).toBe(200);
    const prep = prepRes.json() as {
      tables: Array<{ tableNumber: number; slug: string }>;
      arbiterPin: string;
      arbiterPinRound: number;
    };
    expect(prep.tables).toHaveLength(2);
    expect(prep.arbiterPin).toHaveLength(6);
    const table1 = prep.tables.find((t) => t.tableNumber === 1)!;
    const table2 = prep.tables.find((t) => t.tableNumber === 2)!;

    // 4. Floor arbiter unlocks Table 1 with the Round 1 PIN
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/public/tables/${table1.slug}/session`,
      payload: {
        pin: prep.arbiterPin,
        arbiterName: 'Arbiter Ravi',
      },
    });
    expect(sessionRes.statusCode).toBe(200);
    const { token, table: unlockedTable1 } = sessionRes.json() as {
      token: string;
      table: { status: string; tableNumber: number; whiteName: string; blackName: string };
    };
    expect(token).toBeTruthy();
    expect(unlockedTable1.status).toBe('pending');
    expect(unlockedTable1.tableNumber).toBe(1);
    expect(unlockedTable1.whiteName).toBe('Aiden Tan');
    expect(unlockedTable1.blackName).toBe('Bella Lim');

    // 5. Fetch GET /public/tables/:slug/zone using Bearer token to see all boards in Round 1
    const zoneRes = await app.inject({
      method: 'GET',
      url: `/public/tables/${table1.slug}/zone`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(zoneRes.statusCode).toBe(200);
    const zone = zoneRes.json() as {
      tournamentId: string;
      tournamentName: string;
      round: number;
      arbiterName: string | null;
      boards: Array<{
        tableNumber: number;
        slug: string;
        gameId: string;
        categoryName: string;
        whiteName: string;
        blackName: string;
        result: string;
        locked: boolean;
      }>;
    };
    expect(zone.tournamentId).toBe(tournament.id);
    expect(zone.round).toBe(1);
    expect(zone.arbiterName).toBe('Arbiter Ravi');
    expect(zone.boards).toHaveLength(2);
    expect(zone.boards[0]!.tableNumber).toBe(1);
    expect(zone.boards[0]!.gameId).toBe(game1.id);
    expect(zone.boards[1]!.tableNumber).toBe(2);
    expect(zone.boards[1]!.slug).toBe(table2.slug);
    expect(zone.boards[1]!.gameId).toBe(game2.id);
    expect(zone.boards[1]!.whiteName).toBe('Chloe Wong');
    expect(zone.boards[1]!.blackName).toBe('Danish Razak');
    expect(zone.boards[1]!.locked).toBe(false);

    // 6. Score Table 2 directly from Zone Grid using the token obtained on Table 1
    const scoreTable2Res = await app.inject({
      method: 'POST',
      url: `/public/tables/${table2.slug}/result`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        result: '0-1',
        confirm: true,
        arbiterName: 'Arbiter Ravi',
      },
    });
    expect(scoreTable2Res.statusCode).toBe(200);
    const scoredBody = scoreTable2Res.json() as {
      ok: boolean;
      table: { tableNumber: number; status: string; result: string; sessionOk: boolean };
    };
    expect(scoredBody.ok).toBe(true);
    expect(scoredBody.table.tableNumber).toBe(2);
    expect(scoredBody.table.status).toBe('locked');
    expect(scoredBody.table.result).toBe('0-1');
    expect(scoredBody.table.sessionOk).toBe(true);

    // Verify zone now shows Table 2 as locked with 0-1
    const zoneAfterRes = await app.inject({
      method: 'GET',
      url: `/public/tables/${table1.slug}/zone`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(zoneAfterRes.statusCode).toBe(200);
    expect(zoneAfterRes.json().boards[1].locked).toBe(true);
    expect(zoneAfterRes.json().boards[1].result).toBe('0-1');

    // 7. Floor arbiter raises a "Call Chief Arbiter" alert on Table 1
    const callChiefRes = await app.inject({
      method: 'POST',
      url: `/public/tables/${table1.slug}/call-chief`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        reason: 'Clock malfunction',
        arbiterName: 'Ravi',
      },
    });
    expect(callChiefRes.statusCode).toBe(200);
    const createdAlert = callChiefRes.json().alert as {
      id: string;
      tournamentId: string;
      round: number;
      tableNumber: number;
      gameId: string;
      arbiterName: string;
      reason: string;
      resolvedAt: string | null;
    };
    expect(createdAlert.tournamentId).toBe(tournament.id);
    expect(createdAlert.round).toBe(1);
    expect(createdAlert.tableNumber).toBe(1);
    expect(createdAlert.gameId).toBe(game1.id);
    expect(createdAlert.arbiterName).toBe('Ravi');
    expect(createdAlert.reason).toBe('Clock malfunction');
    expect(createdAlert.resolvedAt).toBeNull();

    // 8. Director lists active floor alerts
    const listAlertsRes = await app.inject({
      method: 'GET',
      url: `/tournaments/${tournament.id}/floor/alerts`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
    });
    expect(listAlertsRes.statusCode).toBe(200);
    const activeAlerts = listAlertsRes.json().alerts as Array<{ id: string; reason: string }>;
    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]!.id).toBe(createdAlert.id);

    // 9. Director resolves/dismisses the alert
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.id}/floor/alerts/${createdAlert.id}/resolve`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().alert.resolvedAt).toBeTruthy();

    // Active alerts list is now empty
    const listAfterResolveRes = await app.inject({
      method: 'GET',
      url: `/tournaments/${tournament.id}/floor/alerts`,
      headers: { 'x-test-user-id': ORGANIZER_USER },
    });
    expect(listAfterResolveRes.statusCode).toBe(200);
    expect(listAfterResolveRes.json().alerts).toHaveLength(0);
  });
});
