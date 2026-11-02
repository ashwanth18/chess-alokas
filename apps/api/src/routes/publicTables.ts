import type { FastifyPluginAsync } from 'fastify';
import {
  ArbiterScorableResultSchema,
  GameCardTypeSchema,
  emptyCardCounts,
  type FloorZoneBoard,
} from '@chess-alokas/shared';
import { z } from 'zod';
import type { Store } from '../db.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  pinGenerationOf,
  sessionMatchesPin,
  signArbiterSession,
  verifyArbiterPin,
  verifyArbiterSessionToken,
} from '../floor/pin.js';
import type { FloorTableView } from '../floor/types.js';
import {
  absenceBlockedByCards,
  countsForGame,
  issueGameCard,
  publicCardLimitReason,
} from '../lib/gameCards.js';

type Opts = { store: Store };

const pinAttempts = new Map<string, { count: number; resetAt: number }>();
const RESULT_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const CARD_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const ALERT_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();

function sessionFromRequest(request: { headers: Record<string, unknown> }): string | null {
  // This header first: someone signed in also sends their sign-in token as a bearer token, and
  // reading that instead would keep asking them for the PIN.
  const header = request.headers['x-arbiter-session'];
  if (typeof header === 'string' && header) return header;
  const auth = String(request.headers['authorization'] ?? '');
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
}

function baseView(
  table: { slug: string; tableNumber: number; tournamentId: string },
  tournamentName: string,
  pinRound: number | null,
  status: FloorTableView['status'],
  sessionOk: boolean,
): FloorTableView {
  return {
    slug: table.slug,
    tableNumber: table.tableNumber,
    tournamentName,
    tournamentId: table.tournamentId,
    pinRound,
    round: pinRound,
    gameId: null,
    whiteId: null,
    blackId: null,
    whiteName: null,
    blackName: null,
    status,
    result: null,
    sessionOk,
    whiteCards: emptyCardCounts(),
    blackCards: emptyCardCounts(),
    forfeitReason: null,
  };
}

async function buildView(
  store: Store,
  slug: string,
  sessionToken: string | null,
): Promise<FloorTableView | null> {
  const table = await store.getTableBySlug(slug);
  if (!table) return null;
  const tournament = await store.getTournament(table.tournamentId);
  if (!tournament || tournament.deletedAt) return null;

  const pinMeta = await store.getArbiterPinMeta(tournament.id);
  const pinRound = pinMeta.round;
  const session = verifyArbiterSessionToken(sessionToken);
  const sessionOk = Boolean(
    session &&
      session.tournamentId === table.tournamentId &&
      sessionMatchesPin(session, pinMeta),
  );

  if (!sessionOk || pinRound == null) {
    return baseView(table, tournament.name, pinRound, 'needs_pin', false);
  }

  if ((tournament.confirmedRounds ?? 0) >= pinRound) {
    return baseView(table, tournament.name, pinRound, 'confirmed_closed', true);
  }

  const game = await store.findGameForTable(tournament.id, table.tableNumber, pinRound);
  if (!game) {
    return baseView(table, tournament.name, pinRound, 'no_game', true);
  }

  const [white, black, cardInfo] = await Promise.all([
    game.whiteId ? store.getParticipant(game.whiteId) : null,
    game.blackId ? store.getParticipant(game.blackId) : null,
    countsForGame(store, game),
  ]);

  let status: FloorTableView['status'] = 'pending';
  if (game.isBye || game.result === 'bye') status = 'bye';
  else if (game.resultLockedAt) status = 'locked';
  else if (game.result !== 'pending') status = 'locked';

  const forfeitReason =
    status === 'locked'
      ? publicCardLimitReason(game.result, cardInfo.whiteCounts, cardInfo.blackCounts)
      : null;

  return {
    slug: table.slug,
    tableNumber: table.tableNumber,
    tournamentName: tournament.name,
    tournamentId: tournament.id,
    pinRound,
    round: game.round,
    gameId: game.id,
    whiteId: game.whiteId,
    blackId: game.blackId,
    // Never show a name from another tournament, even if an older row points at one.
    whiteName: white?.tournamentId === tournament.id ? white.name : null,
    blackName: black?.tournamentId === tournament.id ? black.name : null,
    status,
    result: game.result,
    sessionOk: true,
    whiteCards: cardInfo.whiteCounts,
    blackCards: cardInfo.blackCounts,
    forfeitReason,
  };
}

export const publicTablesPlugin: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { store } = opts;

  app.get<{ Params: { slug: string } }>('/public/tables/:slug', async (request, reply) => {
    const view = await buildView(store, request.params.slug, sessionFromRequest(request));
    if (!view) return reply.code(404).send({ error: 'Table not found' });
    return view;
  });

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/tables/:slug/session',
    async (request, reply) => {
      const ip = request.ip || 'unknown';
      if (!rateLimit(pinAttempts, `${request.params.slug}:${ip}`, 20, 15 * 60 * 1000)) {
        return reply.code(429).send({ error: 'Too many PIN attempts. Try again later.' });
      }

      const parsed = z
        .object({
          pin: z.string().min(4).max(8),
          arbiterName: z.string().trim().max(80).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid PIN' });
      }

      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (!pinMeta.hash || pinMeta.round == null) {
        return reply.code(400).send({ error: 'No active round PIN yet' });
      }
      if (!verifyArbiterPin(parsed.data.pin, pinMeta.hash)) {
        return reply.code(401).send({ error: 'Incorrect PIN' });
      }

      const token = signArbiterSession({
        tournamentId: table.tournamentId,
        tableId: table.id,
        tableNumber: table.tableNumber,
        pinRound: pinMeta.round,
        pinGeneration: pinGenerationOf(pinMeta.hash)!,
        arbiterName: parsed.data.arbiterName || null,
      });

      const view = await buildView(store, table.slug, token);
      return { token, table: view };
    },
  );

  app.get<{ Params: { slug: string } }>(
    '/public/tables/:slug/zone',
    async (request, reply) => {
      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const session = verifyArbiterSessionToken(sessionFromRequest(request));
      if (!session || session.tournamentId !== table.tournamentId) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || !sessionMatchesPin(session, pinMeta)) {
        return reply.code(401).send({ error: 'PIN expired for this round. Enter the new PIN.' });
      }

      const round = pinMeta.round;
      const [games, participants, categories] = await Promise.all([
        store.listGames(tournament.id, { round }),
        store.listParticipants(tournament.id),
        store.listCategories(tournament.id),
      ]);

      const maxBoard = games.reduce((max, g) => Math.max(max, g.board), 0);
      let tables = await store.listTables(tournament.id);
      if (maxBoard > tables.length) {
        tables = await store.ensureTables(tournament.id, maxBoard);
      }

      const tableByNumber = new Map(tables.map((t) => [t.tableNumber, t]));
      const participantById = new Map(participants.map((p) => [p.id, p]));
      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const confirmedClosed = (tournament.confirmedRounds ?? 0) >= round;

      const sortedGames = [...games].sort((a, b) => a.board - b.board);
      const boards: FloorZoneBoard[] = sortedGames.map((g) => {
        const tbl = tableByNumber.get(g.board);
        const isBye = Boolean(g.isBye || g.result === 'bye');
        const locked = Boolean(
          confirmedClosed || g.resultLockedAt || isBye || g.result !== 'pending',
        );
        return {
          tableNumber: g.board,
          slug: tbl?.slug ?? table.slug,
          gameId: g.id,
          categoryId: g.categoryId,
          categoryName: categoryById.get(g.categoryId)?.name ?? null,
          whiteName: (g.whiteId ? participantById.get(g.whiteId)?.name : null) ?? null,
          blackName: (g.blackId ? participantById.get(g.blackId)?.name : null) ?? null,
          result: g.result,
          isBye,
          locked,
        };
      });

      return {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        round,
        arbiterName: session.arbiterName ?? null,
        boards,
      };
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/tables/:slug/result',
    async (request, reply) => {
      const ip = request.ip || 'unknown';
      if (!rateLimit(RESULT_ATTEMPTS, `${request.params.slug}:${ip}`, 60, 15 * 60 * 1000)) {
        return reply.code(429).send({ error: 'Too many requests. Try again later.' });
      }

      const parsed = z
        .object({
          result: ArbiterScorableResultSchema,
          confirm: z.boolean().optional().default(true),
          arbiterName: z.string().trim().min(1).max(80).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success || !parsed.data.confirm) {
        return reply.code(400).send({ error: 'Invalid result payload (result + arbiter name required)' });
      }

      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const session = verifyArbiterSessionToken(sessionFromRequest(request));
      if (!session || session.tournamentId !== table.tournamentId) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || !sessionMatchesPin(session, pinMeta)) {
        return reply.code(401).send({ error: 'PIN expired for this round. Enter the new PIN.' });
      }

      if ((tournament.confirmedRounds ?? 0) >= pinMeta.round) {
        return reply.code(409).send({ error: 'This round is already confirmed closed' });
      }

      const game = await store.findGameForTable(
        tournament.id,
        table.tableNumber,
        pinMeta.round,
      );
      if (!game) {
        return reply.code(409).send({ error: 'No unique game for this table/round' });
      }
      if (game.isBye || game.result === 'bye') {
        return reply.code(409).send({ error: 'Bye boards cannot be scored' });
      }
      if (game.resultLockedAt || game.result !== 'pending') {
        return reply.code(409).send({ error: 'Result already locked for this table' });
      }

      const existingCards = await store.listGameCards(game.id);
      const absenceBlock = absenceBlockedByCards(parsed.data.result, existingCards);
      if (absenceBlock) {
        return reply.code(409).send({ error: absenceBlock });
      }

      const actorName = parsed.data.arbiterName || session.arbiterName || 'Floor Arbiter';
      const updated = await store.recordGameResult(game.id, {
        result: parsed.data.result,
        actorRole: 'floor',
        actorName,
        lock: true,
        onlyIfOpen: true,
      });
      if (!updated) return reply.code(500).send({ error: 'Failed to save result' });

      const view = await buildView(store, table.slug, sessionFromRequest(request));
      return { ok: true, table: view };
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/tables/:slug/call-chief',
    async (request, reply) => {
      const ip = request.ip || 'unknown';
      if (!rateLimit(ALERT_ATTEMPTS, `${request.params.slug}:${ip}`, 30, 15 * 60 * 1000)) {
        return reply.code(429).send({ error: 'Too many requests. Try again later.' });
      }

      const parsed = z
        .object({
          reason: z.string().trim().min(1).max(300),
          arbiterName: z.string().trim().min(1).max(80).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Reason is required (max 300 chars)' });
      }

      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const session = verifyArbiterSessionToken(sessionFromRequest(request));
      if (!session || session.tournamentId !== table.tournamentId) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || !sessionMatchesPin(session, pinMeta)) {
        return reply.code(401).send({ error: 'PIN expired for this round. Enter the new PIN.' });
      }

      const game = await store.findGameForTable(
        tournament.id,
        table.tableNumber,
        pinMeta.round,
      );

      const alert = await store.createFloorAlert({
        id: crypto.randomUUID(),
        tournamentId: tournament.id,
        round: pinMeta.round,
        tableNumber: table.tableNumber,
        gameId: game?.id ?? null,
        arbiterName: parsed.data.arbiterName || session.arbiterName || null,
        reason: parsed.data.reason,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });

      return { alert };
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/tables/:slug/cards',
    async (request, reply) => {
      const ip = request.ip || 'unknown';
      if (!rateLimit(CARD_ATTEMPTS, `${request.params.slug}:${ip}`, 80, 15 * 60 * 1000)) {
        return reply.code(429).send({ error: 'Too many requests. Try again later.' });
      }

      const parsed = z
        .object({
          playerSide: z.enum(['white', 'black']),
          cardType: GameCardTypeSchema,
          note: z.string().trim().max(200).optional(),
          arbiterName: z.string().trim().min(1).max(80),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid card payload' });
      }

      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const session = verifyArbiterSessionToken(sessionFromRequest(request));
      if (!session || session.tournamentId !== table.tournamentId) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || !sessionMatchesPin(session, pinMeta)) {
        return reply.code(401).send({ error: 'PIN expired for this round. Enter the new PIN.' });
      }

      const game = await store.findGameForTable(
        tournament.id,
        table.tableNumber,
        pinMeta.round,
      );
      if (!game) {
        return reply.code(409).send({ error: 'No unique game for this table/round' });
      }

      const playerId =
        parsed.data.playerSide === 'white' ? game.whiteId : game.blackId;
      if (!playerId) {
        return reply.code(400).send({ error: 'No player on that side' });
      }

      const issued = await issueGameCard(store, {
        game,
        playerId,
        cardType: parsed.data.cardType,
        note: parsed.data.note,
        actorRole: 'floor',
        actorName: parsed.data.arbiterName,
        confirmedRounds: tournament.confirmedRounds ?? 0,
      });
      if (!issued.ok) {
        return reply.code(issued.status).send({ error: issued.error });
      }

      const view = await buildView(store, table.slug, sessionFromRequest(request));
      return {
        ok: true,
        table: view,
        card: issued.card,
        forfeited: issued.forfeited,
        forfeitReason: issued.forfeitReason,
      };
    },
  );
};
