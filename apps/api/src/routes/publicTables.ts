import type { FastifyPluginAsync } from 'fastify';
import {
  ArbiterScorableResultSchema,
  GameCardTypeSchema,
  emptyCardCounts,
} from '@chess-alokas/shared';
import { z } from 'zod';
import type { Store } from '../db.js';
import {
  signArbiterSession,
  verifyArbiterPin,
  verifyArbiterSession,
} from '../floor/pin.js';
import type { FloorTableView } from '../floor/types.js';
import { countsForGame, issueGameCard } from '../lib/gameCards.js';

type Opts = { store: Store };

const pinAttempts = new Map<string, { count: number; resetAt: number }>();
const RESULT_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const CARD_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();

function rateLimit(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cur = map.get(key);
  if (!cur || now > cur.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count += 1;
  return cur.count <= max;
}

function sessionFromRequest(request: { headers: Record<string, unknown> }): string | null {
  const auth = String(request.headers['authorization'] ?? '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = request.headers['x-arbiter-session'];
  return typeof header === 'string' ? header : null;
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
  const session = verifyArbiterSession(sessionToken);
  const sessionOk = Boolean(
    session &&
      session.tournamentId === table.tournamentId &&
      session.tableId === table.id &&
      session.tableNumber === table.tableNumber &&
      pinRound != null &&
      session.pinRound === pinRound,
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

  let forfeitReason: string | null = null;
  if (
    status === 'locked' &&
    (game.result === '1-0F' || game.result === '0-1F') &&
    (cardInfo.whiteCounts.illegalMove >= 2 ||
      cardInfo.whiteCounts.warning >= 3 ||
      cardInfo.blackCounts.illegalMove >= 2 ||
      cardInfo.blackCounts.warning >= 3)
  ) {
    const offenderIsWhite =
      game.result === '0-1F' &&
      (cardInfo.whiteCounts.illegalMove >= 2 || cardInfo.whiteCounts.warning >= 3);
    const counts = offenderIsWhite ? cardInfo.whiteCounts : cardInfo.blackCounts;
    if (counts.illegalMove >= 2) {
      forfeitReason = `${counts.illegalMove} illegal moves`;
    } else if (counts.warning >= 3) {
      forfeitReason = `${counts.warning} warnings`;
    }
  }

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
    whiteName: white?.name ?? null,
    blackName: black?.name ?? null,
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

      const parsed = z.object({ pin: z.string().min(4).max(8) }).safeParse(request.body);
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
      });

      const view = await buildView(store, table.slug, token);
      return { token, table: view };
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
          confirm: z.literal(true),
          arbiterName: z.string().trim().min(1).max(80),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid result payload (result + arbiter name required)' });
      }

      const table = await store.getTableBySlug(request.params.slug);
      if (!table) return reply.code(404).send({ error: 'Table not found' });

      const session = verifyArbiterSession(sessionFromRequest(request));
      if (
        !session ||
        session.tournamentId !== table.tournamentId ||
        session.tableId !== table.id ||
        session.tableNumber !== table.tableNumber
      ) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || session.pinRound !== pinMeta.round) {
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

      const updated = await store.recordGameResult(game.id, {
        result: parsed.data.result,
        actorRole: 'floor',
        actorName: parsed.data.arbiterName,
        lock: true,
      });
      if (!updated) return reply.code(500).send({ error: 'Failed to save result' });

      const view = await buildView(store, table.slug, sessionFromRequest(request));
      return { ok: true, table: view };
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

      const session = verifyArbiterSession(sessionFromRequest(request));
      if (
        !session ||
        session.tournamentId !== table.tournamentId ||
        session.tableId !== table.id ||
        session.tableNumber !== table.tableNumber
      ) {
        return reply.code(401).send({ error: 'PIN session required' });
      }

      const tournament = await store.getTournament(table.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Table not found' });
      }

      const pinMeta = await store.getArbiterPinMeta(tournament.id);
      if (pinMeta.round == null || session.pinRound !== pinMeta.round) {
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
