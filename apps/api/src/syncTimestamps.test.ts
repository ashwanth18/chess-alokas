/**
 * A pushed row can carry the same millisecond as the stored one, by chance or because a clock ahead of
 * the server was clamped. That alone mustn't decide anything: the same row again is a no-op, and a
 * different row is an edit. The clock is frozen here, so the tie that otherwise happens now and then
 * happens every time.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_STORES, buildTestApp, type TestApp, type TestBackend } from './testBackends.js';

const T = new Date('2026-11-02T10:00:00.000Z');
const AHEAD = '2026-11-02T10:05:00.000Z';

describe.each(TEST_STORES)('a tie on the clock: %s', (_name, makeBackend) => {
  let backend: TestBackend;
  let t: TestApp;
  let owner: string;
  let orgId: string;

  beforeAll(async () => {
    backend = await makeBackend();
    t = await buildTestApp(backend);
    owner = await t.newUser();
    orgId = (await t.verifiedOrg(owner)).id;
  }, 180_000);

  afterAll(async () => {
    await t?.close();
    await backend?.close();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const push = (items: unknown[]) =>
    t.call(owner, 'POST', '/sync/push', { clientId: 'desk', items, reportRejections: true });

  /** A tournament and one row of each kind, all last written at exactly T. */
  async function rowsAtT() {
    const { store } = backend;
    const at = T.toISOString();
    const tournament = await t.seedTournament(owner, orgId, { updatedAt: at });
    const category = await store.createCategory({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      name: 'Open',
      filter: { logic: 'and', rules: [] },
      sortOrder: 0,
      prizePlaces: null,
      updatedAt: at,
    });
    const player = await store.createParticipant({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      name: 'Asha Rao',
      age: 10,
      customFields: {},
      categoryIds: [category.id],
      updatedAt: at,
    } as never);
    const game = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      categoryId: category.id,
      round: 1,
      board: 1,
      whiteId: player.id,
      blackId: null,
      result: 'pending',
      isBye: false,
      updatedAt: at,
    });
    return { tournament, category, player, game };
  }

  const edits = (
    { tournament, category, player, game }: Awaited<ReturnType<typeof rowsAtT>>,
    updatedAt: string,
  ) => [
    {
      entity: 'tournament',
      id: tournament.id,
      payload: { name: 'Renamed at the desk', style: 'swiss', rounds: 5, status: 'in_progress' },
      updatedAt,
      deletedAt: null,
    },
    {
      entity: 'category',
      id: category.id,
      payload: { tournamentId: tournament.id, name: 'Renamed', filter: { logic: 'and', rules: [] } },
      updatedAt,
      deletedAt: null,
    },
    {
      entity: 'participant',
      id: player.id,
      payload: { tournamentId: tournament.id, name: 'Renamed', age: 10, categoryIds: [category.id] },
      updatedAt,
      deletedAt: null,
    },
    {
      entity: 'game',
      id: game.id,
      payload: {
        tournamentId: tournament.id,
        categoryId: category.id,
        round: 1,
        board: 1,
        whiteId: player.id,
        blackId: null,
        result: '1-0',
        isBye: false,
      },
      updatedAt,
      deletedAt: null,
    },
  ];

  it.each([
    ['a clock ahead, clamped onto the last write', AHEAD],
    ['a clock that happens to match it', T.toISOString()],
  ])('saves an edit from %s', async (_label, updatedAt) => {
    const rows = await rowsAtT();
    const res = await push(edits(rows, updatedAt));
    expect(res.body).toMatchObject({ accepted: 4, rejected: [] });

    const { store } = backend;
    expect((await store.getTournament(rows.tournament.id))?.name).toBe('Renamed at the desk');
    expect((await store.getCategory(rows.category.id))?.name).toBe('Renamed');
    expect((await store.getParticipant(rows.player.id))?.name).toBe('Renamed');
    expect((await store.getGame(rows.game.id))?.result).toBe('1-0');
  });

  it('stamps it just past the last write, not in the future', async () => {
    const rows = await rowsAtT();
    await push(edits(rows, AHEAD));
    const saved = await backend.store.getTournament(rows.tournament.id);
    expect(Date.parse(saved!.updatedAt)).toBe(T.getTime() + 1);
  });

  it('the same row sent again, as a retry does, is a no-op', async () => {
    const rows = await rowsAtT();
    await push(edits(rows, AHEAD));
    const { store } = backend;
    const before = await store.getTournament(rows.tournament.id);
    vi.setSystemTime(T.getTime() + 5_000);
    const res = await push(edits(rows, before!.updatedAt));
    expect(res.body).toMatchObject({ accepted: 4, rejected: [] });
    expect((await store.getTournament(rows.tournament.id))?.updatedAt).toBe(before!.updatedAt);
  });

  it('a row pulled and pushed straight back changes nothing, in any stored format', async () => {
    const { tournament, category, player, game } = await rowsAtT();
    const { store } = backend;
    await store.updateTournament(tournament.id, {
      date: '2026-11-15',
      tiebreakOrder: ['buchholz', 'wins'] as never,
      updatedAt: T.toISOString(),
    });
    await store.updateCategory(category.id, {
      filter: { logic: 'and', rules: [{ field: 'age', op: 'lte', value: 12 }] } as never,
      updatedAt: T.toISOString(),
    });
    const pull = await t.call(owner, 'GET', '/sync/pull?since=1970-01-01T00:00:00.000Z');
    expect(pull.status).toBe(200);
    const backAgain = (entity: string, row: { id: string; updatedAt: string }) => ({
      entity,
      id: row.id,
      payload: row,
      updatedAt: row.updatedAt,
      deletedAt: null,
    });
    const find = <R extends { id: string; updatedAt: string }>(rows: R[], id: string): R =>
      rows.find((r) => r.id === id)!;
    const res = await push([
      backAgain('tournament', find(pull.body.tournaments, tournament.id)),
      backAgain('category', find(pull.body.categories, category.id)),
      backAgain('participant', find(pull.body.participants, player.id)),
      backAgain('game', find(pull.body.games, game.id)),
    ]);
    expect(res.body).toMatchObject({ accepted: 4, rejected: [] });
    expect((await store.getTournament(tournament.id))?.updatedAt).toBe(T.toISOString());
    expect((await store.getCategory(category.id))?.updatedAt).toBe(T.toISOString());
    expect((await store.getParticipant(player.id))?.updatedAt).toBe(T.toISOString());
    expect((await store.getGame(game.id))?.updatedAt).toBe(T.toISOString());
  });

  it('a removal in the same millisecond is an edit too', async () => {
    const rows = await rowsAtT();
    const [, category] = edits(rows, T.toISOString());
    const res = await push([
      {
        ...category!,
        payload: { tournamentId: rows.tournament.id, name: 'Open', filter: { logic: 'and', rules: [] } },
        deletedAt: T.toISOString(),
      },
    ]);
    expect(res.body).toMatchObject({ accepted: 1, rejected: [] });
    expect((await backend.store.getCategory(rows.category.id))?.deletedAt).toBeTruthy();
  });

  it('a tie does not get around the rules for a game', async () => {
    const rows = await rowsAtT();
    await backend.store.updateTournament(rows.tournament.id, {
      confirmedRounds: 1,
      updatedAt: T.toISOString(),
    });
    const game = edits(rows, T.toISOString())[3]!;
    const res = await push([game]);
    expect(res.body.rejected[0]).toMatchObject({ code: 'round_confirmed' });
    expect((await backend.store.getGame(rows.game.id))?.result).toBe('pending');
  });
});
