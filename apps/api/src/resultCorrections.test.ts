/**
 * Late result corrections and undoing the newest round, through the real routes against both stores.
 * The Postgres half has PGlite's single connection, so these prove the rules and that the locking SQL
 * is valid, not how row locks behave between two real backends.
 */
import type { Game, GameResult, Tournament } from '@chess-alokas/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashArbiterPin, signArbiterSession, pinGenerationOf } from './floor/pin.js';
import { TEST_STORES, buildTestApp, type TestApp, type TestBackend } from './testBackends.js';

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;

describe.each(TEST_STORES)('late corrections: %s', (_name, makeBackend) => {
  let backend: TestBackend;
  let t: TestApp;
  let owner: string;
  let director: string;
  let admin: string;
  let arbiter: string;
  let outsider: string;
  let orgId: string;

  beforeAll(async () => {
    backend = await makeBackend();
    t = await buildTestApp(backend);
    owner = await t.newUser();
    director = await t.newUser();
    admin = await t.newUser();
    arbiter = await t.newUser();
    outsider = await t.newUser();
    const org = await t.verifiedOrg(owner);
    orgId = org.id;
    await backend.addMember(orgId, director, 'director');
    await backend.addMember(orgId, admin, 'admin');
    await backend.addMember(orgId, arbiter, 'arbiter');
    await t.verifiedOrg(outsider);
  }, 180_000);

  afterAll(async () => {
    await t?.close();
    await backend?.close();
  });

  /** A tournament with one confirmed game in Round `round`, and the row a client would hold. */
  async function board(
    options: {
      round?: number;
      confirmedRounds?: number;
      result?: GameResult;
      tournament?: Partial<Tournament>;
      game?: Partial<Game>;
    } = {},
  ) {
    const { store } = backend;
    const round = options.round ?? 3;
    const tournament = await t.seedTournament(owner, orgId, {
      confirmedRounds: options.confirmedRounds ?? round,
      currentRound: round + 1,
      ...options.tournament,
    });
    const category = await store.createCategory({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      name: 'Open',
      filter: { logic: 'and', rules: [] },
      sortOrder: 0,
      prizePlaces: null,
      updatedAt: iso(-HOUR),
    });
    const player = (name: string) =>
      store.createParticipant({
        id: crypto.randomUUID(),
        tournamentId: tournament.id,
        name,
        age: 10,
        customFields: {},
        categoryIds: [category.id],
        updatedAt: iso(-HOUR),
      } as never);
    const white = await player('White Player');
    const black = await player('Black Player');
    const game = await store.createGame({
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      categoryId: category.id,
      round,
      board: 1,
      whiteId: white.id,
      blackId: black.id,
      result: options.result ?? '1-0',
      isBye: false,
      updatedAt: iso(-HOUR),
      ...options.game,
    });
    return { tournament, category, white, black, game };
  }

  const correction = (
    previousResult: GameResult,
    result: GameResult,
    reason: string | null = 'Scoresheet says otherwise',
    at = iso(),
  ) => ({ id: crypto.randomUUID(), previousResult, result, reason, actorName: 'Dee Director', at });

  const rowFor = (game: Game, result: GameResult, extra: Record<string, unknown> = {}, updatedAt = iso()) => ({
    entity: 'game',
    id: game.id,
    payload: {
      tournamentId: game.tournamentId,
      categoryId: game.categoryId,
      round: game.round,
      board: game.board,
      whiteId: game.whiteId,
      blackId: game.blackId,
      result,
      isBye: game.isBye,
      ...extra,
    },
    updatedAt,
    deletedAt: null as string | null,
  });

  const push = (user: string, items: unknown[]) =>
    t.call(user, 'POST', '/sync/push', { clientId: 'test', items, reportRejections: true });

  const correct = (user: string, game: Game, from: GameResult, to: GameResult, reason?: string | null) =>
    push(user, [rowFor(game, to, { corrections: [correction(from, to, reason)] })]);

  const reload = async (game: Game) => (await backend.store.getGame(game.id))!;
  const history = async (game: Game) =>
    (await t.call(owner, 'GET', `/games/${game.id}/history`)).body.events as Array<{
      result: string;
      previousResult: string | null;
      actorName: string | null;
      actorUserId: string | null;
      actorRole: string;
      note: string | null;
      createdAt: string;
    }>;

  describe.each([
    ['the director', () => director],
    ['an admin', () => admin],
    ['the owner', () => owner],
  ])('%s', (_label, user) => {
    it('corrects a result in a confirmed round, and it is logged', async () => {
      const { game } = await board();
      const res = await correct(user(), game, '1-0', '0-1', 'Wrong side entered');
      expect(res.body).toMatchObject({ accepted: 1, rejected: [] });

      const saved = await reload(game);
      expect(saved).toMatchObject({
        result: '0-1',
        resultEnteredByRole: 'director',
        resultEnteredByName: 'Dee Director',
        resultOverrideCount: 1,
      });
      const events = await history(game);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        previousResult: '1-0',
        result: '0-1',
        note: 'Wrong side entered',
        actorName: 'Dee Director',
        actorUserId: user(),
        actorRole: 'director',
      });
      expect(Date.parse(events[0]!.createdAt)).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  it('works with the next round paired, and leaves that round alone', async () => {
    const { store } = backend;
    const { game } = await board({ round: 3, confirmedRounds: 3 });
    const next = await store.createGame({ ...game, id: crypto.randomUUID(), round: 4, result: 'pending' });
    expect((await correct(director, game, '1-0', '1/2-1/2')).body.rejected).toEqual([]);
    expect((await reload(game)).result).toBe('1/2-1/2');
    expect(await reload(next)).toEqual(next);
  });

  it('works on a completed tournament', async () => {
    const { game } = await board({
      round: 5,
      tournament: { status: 'completed', confirmedRounds: 5, currentRound: 5 },
    });
    expect((await correct(director, game, '1-0', '0-1')).body.rejected).toEqual([]);
    expect((await reload(game)).result).toBe('0-1');
  });

  it('a plain edit to a confirmed round is still refused', async () => {
    const { game } = await board();
    const res = await push(director, [rowFor(game, '0-1')]);
    expect(res.body.rejected[0]).toMatchObject({ code: 'round_confirmed' });
    expect((await reload(game)).result).toBe('1-0');
    const route = await t.call(director, 'PATCH', `/games/${game.id}/result`, { result: '0-1', confirm: true });
    expect(route.status).toBe(409);
  });

  describe('needs a real correction', () => {
    it.each([
      ['no reason', null],
      ['a blank reason', '   '],
      ['a reason far too long', 'x'.repeat(201)],
    ])('refuses %s', async (_label, reason) => {
      const { game } = await board();
      const res = await correct(director, game, '1-0', '0-1', reason);
      expect(res.body.rejected[0]).toMatchObject({ code: 'invalid' });
      expect(await reload(game)).toEqual(game);
      expect(await history(game)).toEqual([]);
    });

    it.each(['pending', 'bye'] as const)('refuses setting %s', async (to) => {
      const { game } = await board();
      const res = await correct(director, game, '1-0', to);
      expect(res.body.rejected[0]).toMatchObject({ code: 'invalid' });
      expect((await reload(game)).result).toBe('1-0');
    });

    it('refuses a chain that does not end at the row\'s result', async () => {
      const { game } = await board();
      const res = await push(director, [
        rowFor(game, '1/2-1/2', { corrections: [correction('1-0', '0-1')] }),
      ]);
      expect(res.body.rejected[0]).toMatchObject({ code: 'invalid' });
    });

    it('refuses a broken chain', async () => {
      const { game } = await board();
      const res = await push(director, [
        rowFor(game, '0-1', {
          corrections: [correction('1-0', '1/2-1/2'), correction('1-0', '0-1')],
        }),
      ]);
      expect(res.body.rejected[0]).toMatchObject({ code: 'invalid' });
    });

    it('refuses a bye', async () => {
      const { game } = await board({ result: 'bye', game: { isBye: true, blackId: null } });
      const res = await correct(director, game, 'bye', '1-0');
      expect(res.body.rejected[0]).toMatchObject({ code: 'correction_conflict' });
    });

    it('can\'t change a pairing along the way', async () => {
      const { game, white } = await board();
      const res = await push(director, [
        rowFor(game, '0-1', { blackId: white.id, corrections: [correction('1-0', '0-1')] }),
      ]);
      expect(res.body.rejected[0]).toMatchObject({ code: 'correction_conflict' });
      expect(await reload(game)).toEqual(game);
    });

    it('can\'t turn a game with cards into an absence, as a director can\'t at the desk', async () => {
      const { game, white } = await board();
      await backend.store.createGameCard({
        id: crypto.randomUUID(),
        gameId: game.id,
        tournamentId: game.tournamentId,
        playerId: white.id,
        cardType: 'warning',
        note: null,
        actorRole: 'director',
        actorName: 'D',
        actorUserId: owner,
        createdAt: iso(),
        deletedAt: null,
      } as never);
      const refused = await correct(director, game, '1-0', '1-0F');
      expect(refused.body.rejected[0]).toMatchObject({ code: 'correction_conflict' });
      expect((await correct(director, game, '1-0', '0-1')).body.rejected).toEqual([]);
    });
  });

  describe('who may not', () => {
    it.each([
      ['an arbiter', () => arbiter],
      ['a director of another organization', () => outsider],
    ])('refuses %s', async (_label, user) => {
      const { game } = await board();
      const res = await correct(user(), game, '1-0', '0-1');
      expect(res.body.rejected[0]).toMatchObject({ code: 'forbidden' });
      expect(await reload(game)).toEqual(game);
      expect(await history(game)).toEqual([]);
      expect((await t.call(user(), 'GET', `/games/${game.id}/history`)).status).toBe(403);
    });

    it('a floor session has no way to reach an earlier round or change an entered result', async () => {
      const { store } = backend;
      const { tournament, game } = await board({ round: 3 });
      const current = await store.createGame({
        ...game,
        id: crypto.randomUUID(),
        round: 4,
        result: '1-0',
        resultLockedAt: iso(),
      });
      const [table] = await store.ensureTables(tournament.id, 1);
      const pinHash = hashArbiterPin('123456');
      await store.setArbiterPin(tournament.id, pinHash, 4);
      const token = signArbiterSession({
        tournamentId: tournament.id,
        tableId: table!.id,
        tableNumber: 1,
        pinRound: 4,
        pinGeneration: pinGenerationOf(pinHash)!,
      });
      const res = await t.app.inject({
        method: 'POST',
        url: `/public/tables/${table!.slug}/result`,
        headers: { authorization: `Bearer ${token}` },
        payload: { result: '0-1', arbiterName: 'Floor' },
      });
      expect(res.statusCode).toBe(409);
      expect((await reload(current)).result).toBe('1-0');
      expect((await reload(game)).result).toBe('1-0');
    });
  });

  describe('queued while offline', () => {
    it('someone else got there first: the correction is refused, not applied over them', async () => {
      const { game } = await board();
      expect((await correct(director, game, '1-0', '0-1', 'First')).body.rejected).toEqual([]);
      // The second device still believes the result is 1-0.
      const late = await correct(admin, game, '1-0', '1/2-1/2', 'Second');
      expect(late.body.rejected[0]).toMatchObject({ code: 'correction_conflict' });
      expect(late.body.rejected[0].reason).toContain('0-1');
      expect((await reload(game)).result).toBe('0-1');
      expect(await history(game)).toHaveLength(1);
    });

    it('the same correction arriving twice is one correction', async () => {
      const { game } = await board();
      const item = rowFor(game, '0-1', { corrections: [correction('1-0', '0-1')] });
      expect((await push(director, [item])).body).toMatchObject({ accepted: 1, rejected: [] });
      expect((await push(director, [item])).body).toMatchObject({ accepted: 1, rejected: [] });
      expect(await history(game)).toHaveLength(1);
      expect((await reload(game)).resultOverrideCount).toBe(1);
    });

    it('two corrections made in a row are both recorded', async () => {
      const { game } = await board();
      const first = correction('1-0', '0-1', 'First look', iso(-2000));
      const second = correction('0-1', '1/2-1/2', 'Second look', iso(-1000));
      const res = await push(director, [rowFor(game, '1/2-1/2', { corrections: [first, second] })]);
      expect(res.body.rejected).toEqual([]);
      expect((await reload(game)).result).toBe('1/2-1/2');
      expect((await reload(game)).resultOverrideCount).toBe(2);
      expect((await history(game)).map((e) => [e.previousResult, e.result, e.note])).toEqual([
        ['0-1', '1/2-1/2', 'Second look'],
        ['1-0', '0-1', 'First look'],
      ]);
    });

    it('a desk clock behind the server does not lose the correction', async () => {
      const { game } = await board({ game: { updatedAt: iso() } });
      const res = await push(director, [
        rowFor(game, '0-1', { corrections: [correction('1-0', '0-1')] }, iso(-5 * HOUR)),
      ]);
      expect(res.body.rejected).toEqual([]);
      const saved = await reload(game);
      expect(saved.result).toBe('0-1');
      // Stamped by the server, so a later pull from any device sees it.
      expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.now() - 60_000);
    });

    it('a corrected row reaches other devices on their next pull', async () => {
      const { game } = await board();
      const cursor = iso(-1000);
      await correct(director, game, '1-0', '0-1');
      const pull = await t.call(admin, 'GET', `/sync/pull?since=${encodeURIComponent(cursor)}`);
      const row = pull.body.games.find((g: Game) => g.id === game.id);
      expect(row).toMatchObject({ result: '0-1', resultOverrideCount: 1 });
    });

    it('a result the server never saw, then a correction, in one batch with the confirmation', async () => {
      const { tournament, game } = await board({ result: 'pending', confirmedRounds: 2 });
      const res = await push(director, [
        {
          entity: 'tournament',
          id: tournament.id,
          payload: { ...tournament, confirmedRounds: 3 },
          updatedAt: iso(),
          deletedAt: null,
        },
        rowFor(game, '0-1', { corrections: [correction('1-0', '0-1')] }),
      ]);
      expect(res.body.rejected).toEqual([]);
      expect((await reload(game)).result).toBe('0-1');
      expect((await history(game)).map((e) => [e.previousResult, e.result])).toEqual([
        ['1-0', '0-1'],
        ['pending', '1-0'],
      ]);
    });

    it('a result edited offline before the round closed still applies, in order', async () => {
      const { tournament, game } = await board({ result: '1-0', confirmedRounds: 2 });
      const res = await push(director, [
        {
          entity: 'tournament',
          id: tournament.id,
          payload: { ...tournament, confirmedRounds: 3 },
          updatedAt: iso(),
          deletedAt: null,
        },
        rowFor(game, '1/2-1/2', { corrections: [correction('0-1', '1/2-1/2')] }),
      ]);
      expect(res.body.rejected).toEqual([]);
      expect((await history(game)).map((e) => [e.previousResult, e.result])).toEqual([
        ['0-1', '1/2-1/2'],
        ['1-0', '0-1'],
      ]);
    });

    it('a game the server has never seen arrives with its corrections', async () => {
      const { tournament, category, white, black } = await board();
      const fresh: Game = {
        id: crypto.randomUUID(),
        tournamentId: tournament.id,
        categoryId: category.id,
        round: 2,
        board: 2,
        whiteId: white.id,
        blackId: black.id,
        result: '0-1',
        isBye: false,
        updatedAt: iso(),
      };
      const res = await push(director, [
        rowFor(fresh, '0-1', { corrections: [correction('1-0', '0-1')] }),
      ]);
      expect(res.body.rejected).toEqual([]);
      expect((await reload(fresh)).result).toBe('0-1');
      expect((await history(fresh)).map((e) => [e.previousResult, e.result])).toEqual([
        ['1-0', '0-1'],
        [null, '1-0'],
      ]);
    });

    it('a game removed in the meantime can\'t be corrected', async () => {
      const { game } = await board();
      await backend.store.updateGame(game.id, { deletedAt: iso() });
      const res = await correct(director, game, '1-0', '0-1');
      expect(res.body.rejected[0]).toMatchObject({ code: 'correction_conflict' });
      expect((await reload(game)).result).toBe('1-0');
    });

    it('a failed batch leaves no correction behind', async () => {
      const { game } = await board();
      const res = await t.call(director, 'POST', '/sync/push', {
        clientId: 'old-client',
        items: [
          rowFor(game, '0-1', { corrections: [correction('1-0', '0-1')] }),
          { entity: 'participant', id: crypto.randomUUID(), payload: { tournamentId: 'not-a-uuid' }, updatedAt: iso(), deletedAt: null },
        ],
      });
      expect(res.status).toBe(400);
      expect((await reload(game)).result).toBe('1-0');
      expect(await history(game)).toEqual([]);
    });
  });

  it('a floor-locked result can be corrected and stays locked', async () => {
    const lockedAt = iso(-HOUR);
    const { game } = await board({ game: { resultLockedAt: lockedAt, resultEnteredByRole: 'floor' } });
    expect((await correct(director, game, '1-0', '0-1')).body.rejected).toEqual([]);
    const saved = await reload(game);
    expect(saved.result).toBe('0-1');
    expect(Date.parse(saved.resultLockedAt!)).toBe(Date.parse(lockedAt));
    expect(saved.resultEnteredByRole).toBe('director');
  });

  it('standings and the public live page move with the correction', async () => {
    const { store } = backend;
    const { tournament, game, white, black } = await board();
    await store.updateTournament(tournament.id, {
      publicEnabled: true,
      publicToken: `live-${crypto.randomUUID()}`,
    });
    const token = (await store.getTournament(tournament.id))!.publicToken!;
    const score = async (id: string) => {
      const [standings] = (await t.call(owner, 'GET', `/tournaments/${tournament.id}/standings`)).body;
      return standings.standings.find((s: { id?: string; playerId?: string }) => (s.id ?? s.playerId) === id);
    };
    const before = await score(white.id);
    expect((await score(black.id)).points ?? (await score(black.id)).score).toBe(0);

    await correct(director, game, '1-0', '0-1');

    const afterWhite = await score(white.id);
    const afterBlack = await score(black.id);
    expect(afterWhite.points ?? afterWhite.score).toBeLessThan(before.points ?? before.score);
    expect(afterBlack.points ?? afterBlack.score).toBe(1);
    const live = await t.call(null, 'GET', `/public/live/${token}`);
    expect(live.body.games.find((g: { id: string }) => g.id === game.id).result).toBe('0-1');
  });

  describe('undoing the newest round', () => {
    async function pairedRound() {
      const { store } = backend;
      const ctx = await board({ round: 3 });
      const roundFour = await store.createGame({
        ...ctx.game,
        id: crypto.randomUUID(),
        round: 4,
        result: 'pending',
      });
      const [table] = await store.ensureTables(ctx.tournament.id, 1);
      const pinHash = hashArbiterPin('654321');
      await store.setArbiterPin(ctx.tournament.id, pinHash, 4);
      const floorToken = signArbiterSession({
        tournamentId: ctx.tournament.id,
        tableId: table!.id,
        tableNumber: 1,
        pinRound: 4,
        pinGeneration: pinGenerationOf(pinHash)!,
      });
      return { ...ctx, roundFour, table: table!, floorToken };
    }
    const undo = (user: string, id: string, round = 4, body: unknown = { reason: 'Round 3 corrected' }) =>
      t.call(user, 'POST', `/tournaments/${id}/rounds/${round}/undo`, body);

    it('removes the unplayed games, logs it, and rolls the round back', async () => {
      const { tournament, game, roundFour } = await pairedRound();
      const res = await undo(director, tournament.id);
      expect(res.status).toBe(200);
      expect(res.body.removedGameIds).toEqual([roundFour.id]);
      expect(res.body.tournament).toMatchObject({ currentRound: 3, confirmedRounds: 3, status: 'in_progress' });

      expect((await reload(roundFour)).deletedAt).toBeTruthy();
      expect((await reload(game)).deletedAt).toBeFalsy();
      const log = await history(roundFour);
      expect(log[0]).toMatchObject({
        note: 'Round 4 undone: Round 3 corrected',
        actorUserId: director,
        actorRole: 'director',
      });
    });

    it('the round\'s floor PIN and sessions stop working', async () => {
      const { tournament, table, floorToken, roundFour } = await pairedRound();
      const floor = (url: string, payload?: unknown) =>
        t.app.inject({
          method: payload ? 'POST' : 'GET',
          url,
          headers: { authorization: `Bearer ${floorToken}` },
          ...(payload ? { payload: payload as never } : {}),
        });

      expect((await floor(`/public/tables/${table.slug}`)).json()).toMatchObject({ status: 'pending', sessionOk: true });
      expect((await undo(director, tournament.id)).status).toBe(200);

      expect((await floor(`/public/tables/${table.slug}`)).json()).toMatchObject({
        status: 'needs_pin',
        sessionOk: false,
        gameId: null,
      });
      expect((await floor(`/public/tables/${table.slug}/result`, { result: '1-0', arbiterName: 'F' })).statusCode).toBe(401);
      expect((await floor(`/public/tables/${table.slug}/zone`)).statusCode).toBe(401);
      expect((await floor(`/public/tables/${table.slug}/cards`, { playerSide: 'white', cardType: 'warning', arbiterName: 'F' })).statusCode).toBe(401);
      expect((await floor(`/public/tables/${table.slug}/call-chief`, { reason: 'Help' })).statusCode).toBe(401);
      const relogin = await t.app.inject({
        method: 'POST',
        url: `/public/tables/${table.slug}/session`,
        payload: { pin: '654321' },
      });
      expect(relogin.statusCode).toBe(400);
      expect((await backend.store.getArbiterPinMeta(tournament.id))).toEqual({ hash: null, round: null });
      expect((await reload(roundFour)).result).toBe('pending');
    });

    it('a floor result that was already on its way finds the game gone', async () => {
      const { tournament, roundFour } = await pairedRound();
      await undo(director, tournament.id);
      await expect(
        backend.store.recordGameResult(roundFour.id, {
          result: '1-0',
          actorRole: 'floor',
          lock: true,
          onlyIfOpen: true,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await reload(roundFour)).result).toBe('pending');
    });

    it('a bye in the round does not count as a result, and goes too', async () => {
      const { store } = backend;
      const { tournament, roundFour } = await pairedRound();
      const bye = await store.createGame({
        ...roundFour,
        id: crypto.randomUUID(),
        board: 2,
        blackId: null,
        isBye: true,
        result: 'bye',
      });
      const res = await undo(director, tournament.id);
      expect(res.status).toBe(200);
      expect(res.body.removedGameIds.sort()).toEqual([roundFour.id, bye.id].sort());
    });

    it.each([
      ['a result is in', { result: '1-0' as GameResult }],
      ['a result is locked', { resultLockedAt: iso() }],
    ])('refuses when %s, and changes nothing', async (_label, patch) => {
      const { store } = backend;
      const { tournament, roundFour } = await pairedRound();
      const saved = await store.updateGame(roundFour.id, patch);
      const res = await undo(director, tournament.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/has results/);
      expect(await reload(roundFour)).toEqual(saved);
      expect((await store.getArbiterPinMeta(tournament.id)).round).toBe(4);
    });

    it('refuses when a card has been given: the game has started', async () => {
      const { store } = backend;
      const { tournament, roundFour, white } = await pairedRound();
      await store.createGameCard({
        id: crypto.randomUUID(),
        gameId: roundFour.id,
        tournamentId: tournament.id,
        playerId: white.id,
        cardType: 'warning',
        note: null,
        actorRole: 'floor',
        actorName: 'F',
        actorUserId: null,
        createdAt: iso(),
        deletedAt: null,
      } as never);
      const res = await undo(director, tournament.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cards/);
      expect((await reload(roundFour)).deletedAt).toBeFalsy();
    });

    it('refuses an older round, a confirmed round, Round 1 and a round not paired', async () => {
      const { store } = backend;
      const { tournament, game, roundFour } = await pairedRound();
      expect((await undo(director, tournament.id, 3)).status).toBe(409);
      expect((await undo(director, tournament.id, 5)).status).toBe(409);
      expect((await undo(director, tournament.id, 1)).status).toBe(409);
      await store.updateTournament(tournament.id, { confirmedRounds: 4 });
      expect((await undo(director, tournament.id, 4)).status).toBe(409);
      expect((await reload(roundFour)).deletedAt).toBeFalsy();
      expect((await reload(game)).deletedAt).toBeFalsy();
    });

    it.each([
      ['an arbiter', () => arbiter],
      ['a director of another organization', () => outsider],
    ])('refuses %s', async (_label, user) => {
      const { tournament, roundFour } = await pairedRound();
      expect((await undo(user(), tournament.id)).status).toBe(403);
      expect((await reload(roundFour)).deletedAt).toBeFalsy();
    });

    it('a device that was offline can\'t bring the games back', async () => {
      const { tournament, roundFour } = await pairedRound();
      await undo(director, tournament.id);
      // An equal timestamp would be a no-op, and MemoryStore can finish both in one millisecond.
      await new Promise((resolve) => setTimeout(resolve, 3));
      const res = await push(admin, [rowFor(roundFour, '1-0')]);
      expect(res.body.rejected[0]).toMatchObject({ code: 'game_removed' });
      const saved = await reload(roundFour);
      expect(saved.deletedAt).toBeTruthy();
      expect(saved.result).toBe('pending');
    });

    it('the removal reaches other devices on their next pull', async () => {
      const { tournament, roundFour } = await pairedRound();
      const cursor = iso(-1000);
      await undo(director, tournament.id);
      const pull = await t.call(admin, 'GET', `/sync/pull?since=${encodeURIComponent(cursor)}`);
      expect(pull.body.games.find((g: Game) => g.id === roundFour.id).deletedAt).toBeTruthy();
      expect(pull.body.tournaments.find((row: Tournament) => row.id === tournament.id)).toMatchObject({
        currentRound: 3,
        arbiterPinRound: null,
      });
    });
  });

  it('a whole event: five rounds, Round 3 corrected in Round 4, with both choices', async () => {
    const { store } = backend;
    const tournament = await t.seedTournament(owner, orgId, {
      currentRound: 0,
      status: 'ready',
      mixCategories: true,
    });
    const id = tournament.id;
    const names = ['Asha', 'Ben', 'Chai', 'Dina', 'Eli', 'Farah', 'Gopal', 'Hana'];
    for (const [i, name] of names.entries()) {
      await store.createParticipant({
        id: crypto.randomUUID(),
        tournamentId: id,
        name,
        age: 10,
        rating: 2000 - i * 50,
        seed: i + 1,
        customFields: {},
        categoryIds: [],
        updatedAt: iso(-HOUR),
      } as never);
    }
    const pair = async (round: number) => {
      const res = await t.call(director, 'POST', `/tournaments/${id}/rounds/${round}/pair`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.games as Game[];
    };
    const score = async (round: number, games: Game[]) => {
      for (const g of games) {
        if (g.isBye) continue;
        const res = await t.call(director, 'PATCH', `/games/${g.id}/result`, { result: '1-0' });
        expect(res.status).toBe(200);
      }
      const res = await t.call(director, 'PATCH', `/tournaments/${id}`, { confirmedRounds: round });
      expect(res.status).toBe(200);
    };
    const standings = async () =>
      JSON.stringify((await t.call(owner, 'GET', `/tournaments/${id}/standings`)).body);

    await score(1, await pair(1));
    await score(2, await pair(2));
    const roundThree = await pair(3);
    await score(3, roundThree);
    const roundFour = await pair(4);

    // Round 3 had a mistake, found while Round 4 is on the boards.
    const wrong = (await store.getGame(roundThree.find((g) => !g.isBye)!.id))!;
    const before = await standings();
    const fix = await correct(director, wrong, '1-0', '0-1', 'Scoresheet says Black won');
    expect(fix.body.rejected).toEqual([]);
    expect(await standings()).not.toBe(before);

    // Choice one: keep Round 4. Nothing about it changes.
    const kept = await store.listGames(id, { round: 4 });
    expect(kept.map((g) => g.id).sort()).toEqual(roundFour.map((g) => g.id).sort());

    // Choice two: undo Round 4 and pair it again from the corrected score.
    expect((await t.call(director, 'POST', `/tournaments/${id}/rounds/4/undo`, {})).status).toBe(200);
    expect(await store.listGames(id, { round: 4 })).toEqual([]);
    const repaired = await pair(4);
    expect(repaired.length).toBeGreaterThan(0);
    expect(new Set(repaired.map((g) => g.id)).size).toBe(repaired.length);
    expect(repaired.some((g) => roundFour.map((old) => old.id).includes(g.id))).toBe(false);

    // A result can't be undone away: Round 4 now has one, so only Keep is left.
    await score(4, repaired);
    expect((await t.call(director, 'POST', `/tournaments/${id}/rounds/4/undo`, {})).status).toBe(409);

    await score(5, await pair(5));
    await t.call(director, 'PATCH', `/tournaments/${id}`, { status: 'completed' });
    const after = await standings();
    const late = (await store.getGame(repaired.find((g) => !g.isBye)!.id))!;
    expect((await correct(director, late, '1-0', '1/2-1/2', 'Arbiter noted a draw')).body.rejected).toEqual([]);
    expect(await standings()).not.toBe(after);
  }, 60_000);
});
