import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  GameCardTypeSchema,
  GameResultSchema,
  isExcludedFromRound,
  isStyleImplemented,
} from '@chess-alokas/shared';
import {
  computeStandings,
  UnsupportedPairingStyleError,
  firstRoundMissingResults,
} from '@chess-alokas/pairing-engine';
import type { EnginePlayer, PastGame } from '@chess-alokas/pairing-engine';
import type { Participant, Game, Category } from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';
import { absenceBlockedByCards, issueGameCard, removeGameCard } from '../lib/gameCards.js';
import { BbpPairingsError, pairRoundOfficial } from '../lib/dutchPairing.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const pairingPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;
  app.addHook('preHandler', requireAuth);

  const DutchPreviewSchema = z.object({
    players: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          rating: z.number().nullable().optional(),
          seed: z.number().nullable().optional(),
        }),
      )
      .min(2)
      .max(512),
    pastGames: z
      .array(
        z.object({
          round: z.number().int().positive(),
          whiteId: z.string().nullable(),
          blackId: z.string().nullable(),
          result: GameResultSchema,
          isBye: z.boolean(),
        }),
      )
      .max(20_000),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    initialColor: z.enum(['W', 'B']).optional(),
  });

  app.post('/pairing/dutch', async (request, reply) => {
    const parsed = DutchPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    try {
      const output = await pairRoundOfficial('dutch', {
        players: parsed.data.players.map((p) => ({
          id: p.id,
          name: p.name,
          rating: p.rating ?? undefined,
          seed: p.seed ?? undefined,
        })),
        pastGames: parsed.data.pastGames,
        round: parsed.data.round,
        totalRounds: parsed.data.totalRounds,
        initialColor: parsed.data.initialColor,
      });
      return { ...output, engine: 'bbpPairings-6.0.0' };
    } catch (err) {
      if (err instanceof BbpPairingsError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // POST /tournaments/:id/rounds/:round/pair
  // -------------------------------------------------------------------------
  const PairBodySchema = z.object({
    categoryId: z.string().uuid().optional(),
  });

  app.post<{
    Params: { id: string; round: string };
    Querystring: { force?: string };
    Body: unknown;
  }>('/tournaments/:id/rounds/:round/pair', async (request, reply) => {
    const { id: tournamentId, round: roundStr } = request.params;
    const force = request.query.force === 'true';
    const round = parseInt(roundStr, 10);

    if (isNaN(round) || round < 1) {
      return reply.code(400).send({ error: 'Invalid round number' });
    }

    const tournament = await store.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    if (!(await store.isTournamentOwnedBy(tournamentId, request.userId ?? ''))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (round > tournament.rounds) {
      return reply
        .code(400)
        .send({ error: `Round ${round} exceeds tournament rounds (${tournament.rounds})` });
    }
    if (!isStyleImplemented(tournament.style)) {
      return reply
        .code(422)
        .send({ error: `Pairing style "${tournament.style}" is not yet implemented` });
    }

    const [allGames, allCategories, allParticipants] = await Promise.all([
      store.listGames(tournamentId),
      store.listCategories(tournamentId),
      store.listParticipants(tournamentId),
    ]);

    const pastForCheck = allGames.filter((g) => !g.deletedAt).map(gameToPastGame);
    const pendingRound = firstRoundMissingResults(pastForCheck, round);
    if (pendingRound !== null) {
      return reply.code(400).send({
        error: `Enter all results for round ${pendingRound} before pairing round ${round}.`,
      });
    }

    const bodyParsed = PairBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: bodyParsed.error.format() });
    }
    const { categoryId: filterCategoryId } = bodyParsed.data;

    const activeCategories = allCategories.filter((c) => !c.deletedAt);
    const mix = tournament.mixCategories === true;

    const createdGames: Game[] = [];
    const now = new Date().toISOString();

    // Mixed mode: one shared pairing pool for the whole tournament
    if (mix || activeCategories.length === 0) {
      const poolId =
        filterCategoryId ??
        activeCategories[0]?.id ??
        crypto.randomUUID();

      const existingRound = allGames.filter((g) => g.round === round && !g.deletedAt);
      if (existingRound.length > 0) {
        if (!force) {
          return reply.code(409).send({
            error: `Games already exist for round ${round}. Use ?force=true to re-pair.`,
          });
        }
        for (const cat of activeCategories.length ? activeCategories : [{ id: poolId } as Category]) {
          await store.softDeleteGamesForRound(tournamentId, round, cat.id);
        }
        await store.softDeleteGamesForRound(tournamentId, round, poolId);
      }

      const players: EnginePlayer[] = allParticipants
        .filter((p) => !p.deletedAt && !isExcludedFromRound(p, round))
        .map(participantToEnginePlayer);
      if (players.length === 0) {
        return reply.code(400).send({ error: 'No players available to pair for this round' });
      }

      const pastGames: PastGame[] = allGames
        .filter((g) => g.round < round && !g.deletedAt)
        .map(gameToPastGame);

      let pairingOutput;
      try {
        pairingOutput = await pairRoundOfficial(tournament.style, {
          players,
          pastGames,
          round,
          totalRounds: tournament.rounds,
        });
      } catch (err) {
        if (err instanceof UnsupportedPairingStyleError) {
          return reply
            .code(422)
            .send({ error: `Pairing style "${tournament.style}" is not yet implemented` });
        }
        if (err instanceof BbpPairingsError) {
          return reply.code(503).send({ error: err.message });
        }
        throw err;
      }

      const poolGames = await Promise.all(
        pairingOutput.boards.map((board) =>
          store.createGame({
            id: crypto.randomUUID(),
            tournamentId,
            categoryId: poolId,
            round,
            board: board.board,
            whiteId: board.whiteId,
            blackId: board.blackId,
            result: board.isBye ? 'bye' : 'pending',
            isBye: board.isBye,
            updatedAt: now,
          }),
        ),
      );
      createdGames.push(...poolGames);

      await store.updateTournament(tournamentId, {
        currentRound: Math.max(tournament.currentRound, round),
        status: round >= tournament.rounds ? 'completed' : 'in_progress',
        updatedAt: now,
      });

      return reply.code(201).send({ round, games: createdGames, mixCategories: true });
    }

    // Default: separate pairing pools per category
    const categoriesToPair: Category[] = filterCategoryId
      ? activeCategories.filter((c) => c.id === filterCategoryId)
      : activeCategories;

    if (categoriesToPair.length === 0) {
      return reply.code(404).send({ error: 'No matching categories found' });
    }

    for (const category of categoriesToPair) {
      const existing = allGames.filter(
        (g) => g.categoryId === category.id && g.round === round,
      );
      if (existing.length > 0) {
        if (!force) {
          return reply.code(409).send({
            error: `Games already exist for round ${round}, category "${category.name}". Use ?force=true to re-pair.`,
          });
        }
        await store.softDeleteGamesForRound(tournamentId, round, category.id);
      }

      const catParticipants = allParticipants.filter(
        (p) =>
          p.categoryIds.includes(category.id) &&
          !p.deletedAt &&
          !isExcludedFromRound(p, round),
      );
      if (catParticipants.length === 0) continue;

      const players: EnginePlayer[] = catParticipants.map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames
        .filter((g) => g.categoryId === category.id && g.round < round)
        .map(gameToPastGame);

      let pairingOutput;
      try {
        pairingOutput = await pairRoundOfficial(tournament.style, {
          players,
          pastGames,
          round,
          totalRounds: tournament.rounds,
        });
      } catch (err) {
        if (err instanceof UnsupportedPairingStyleError) {
          return reply
            .code(422)
            .send({ error: `Pairing style "${tournament.style}" is not yet implemented` });
        }
        if (err instanceof BbpPairingsError) {
          return reply.code(503).send({ error: err.message });
        }
        throw err;
      }

      const categoryGames = await Promise.all(
        pairingOutput.boards.map((board) =>
          store.createGame({
            id: crypto.randomUUID(),
            tournamentId,
            categoryId: category.id,
            round,
            board: board.board,
            whiteId: board.whiteId,
            blackId: board.blackId,
            result: board.isBye ? 'bye' : 'pending',
            isBye: board.isBye,
            updatedAt: now,
          }),
        ),
      );
      createdGames.push(...categoryGames);
    }

    await store.updateTournament(tournamentId, {
      currentRound: Math.max(tournament.currentRound, round),
      status: round >= tournament.rounds ? 'completed' : 'in_progress',
      updatedAt: now,
    });

    return reply.code(201).send({ round, games: createdGames, mixCategories: false });
  });

  // -------------------------------------------------------------------------
  // PATCH /games/:id/result — director desk (audited)
  // -------------------------------------------------------------------------
  const ResultBodySchema = z.object({
    result: GameResultSchema,
    confirm: z.literal(true).optional(),
    note: z.string().trim().max(200).optional(),
    actorName: z.string().trim().max(80).optional(),
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/games/:id/result',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = ResultBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const game = await store.getGame(id);
      if (!game || game.deletedAt) {
        return reply.code(404).send({ error: 'Game not found' });
      }
      if (!(await store.isTournamentOwnedBy(game.tournamentId, request.userId ?? ''))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const tournament = await store.getTournament(game.tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      if ((tournament.confirmedRounds ?? 0) >= game.round) {
        return reply.code(409).send({ error: 'Round is confirmed — results are locked' });
      }
      const changingEntered =
        game.result !== 'pending' &&
        game.result !== 'bye' &&
        game.result !== parsed.data.result;
      if (changingEntered && parsed.data.confirm !== true) {
        return reply.code(400).send({
          error: 'Confirm required to change an entered result',
          code: 'CONFIRM_REQUIRED',
        });
      }
      const existingCards = await store.listGameCards(id);
      const absenceBlock = absenceBlockedByCards(parsed.data.result, existingCards);
      if (absenceBlock) {
        return reply.code(409).send({ error: absenceBlock });
      }
      const updated = await store.recordGameResult(id, {
        result: parsed.data.result,
        actorRole: 'director',
        actorName: parsed.data.actorName || 'Director',
        actorUserId: request.userId ?? null,
        note: parsed.data.note ?? null,
        lock: false,
      });
      return updated;
    },
  );

  // -------------------------------------------------------------------------
  // GET /tournaments/:id/game-cards?round=
  // -------------------------------------------------------------------------
  app.get<{
    Params: { id: string };
    Querystring: { round?: string };
  }>('/tournaments/:id/game-cards', async (request, reply) => {
    const { id: tournamentId } = request.params;
    const tournament = await store.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    if (!(await store.isTournamentOwnedBy(tournamentId, request.userId ?? ''))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const round =
      request.query.round != null ? parseInt(request.query.round, 10) : undefined;
    if (request.query.round != null && (isNaN(round!) || round! < 1)) {
      return reply.code(400).send({ error: 'Invalid round' });
    }
    const cards = await store.listTournamentGameCards(tournamentId, {
      round: round && !isNaN(round) ? round : undefined,
    });
    return { cards };
  });

  // -------------------------------------------------------------------------
  // POST /tournaments/:id/games/:gameId/cards
  // -------------------------------------------------------------------------
  app.post<{
    Params: { id: string; gameId: string };
    Body: unknown;
  }>('/tournaments/:id/games/:gameId/cards', async (request, reply) => {
    const { id: tournamentId, gameId } = request.params;
    const parsed = z
      .object({
        playerSide: z.enum(['white', 'black']).optional(),
        playerId: z.string().uuid().optional(),
        cardType: GameCardTypeSchema,
        note: z.string().trim().max(200).optional(),
        actorName: z.string().trim().max(80).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid card payload' });
    }

    const tournament = await store.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    if (!(await store.isTournamentOwnedBy(tournamentId, request.userId ?? ''))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const game = await store.getGame(gameId);
    if (!game || game.deletedAt || game.tournamentId !== tournamentId) {
      return reply.code(404).send({ error: 'Game not found' });
    }

    let playerId = parsed.data.playerId ?? null;
    if (!playerId && parsed.data.playerSide) {
      playerId =
        parsed.data.playerSide === 'white' ? game.whiteId : game.blackId;
    }
    if (!playerId) {
      return reply.code(400).send({ error: 'playerId or playerSide required' });
    }

    const issued = await issueGameCard(store, {
      game,
      playerId,
      cardType: parsed.data.cardType,
      note: parsed.data.note,
      actorRole: 'director',
      actorName: parsed.data.actorName || 'Director',
      actorUserId: request.userId ?? null,
      confirmedRounds: tournament.confirmedRounds ?? 0,
    });
    if (!issued.ok) {
      return reply.code(issued.status).send({ error: issued.error });
    }
    return {
      ok: true,
      card: issued.card,
      game: issued.game,
      whiteCards: issued.whiteCounts,
      blackCards: issued.blackCounts,
      forfeited: issued.forfeited,
      forfeitReason: issued.forfeitReason,
    };
  });

  // -------------------------------------------------------------------------
  // DELETE /tournaments/:id/games/:gameId/cards/:cardId
  // -------------------------------------------------------------------------
  app.delete<{
    Params: { id: string; gameId: string; cardId: string };
  }>('/tournaments/:id/games/:gameId/cards/:cardId', async (request, reply) => {
    const { id: tournamentId, gameId, cardId } = request.params;
    const tournament = await store.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    if (!(await store.isTournamentOwnedBy(tournamentId, request.userId ?? ''))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const game = await store.getGame(gameId);
    if (!game || game.deletedAt || game.tournamentId !== tournamentId) {
      return reply.code(404).send({ error: 'Game not found' });
    }

    const removed = await removeGameCard(store, {
      game,
      cardId,
      confirmedRounds: tournament.confirmedRounds ?? 0,
    });
    if (!removed.ok) {
      return reply.code(removed.status).send({ error: removed.error });
    }
    return {
      ok: true,
      card: removed.card,
      game: removed.game,
      whiteCards: removed.whiteCounts,
      blackCards: removed.blackCounts,
      unlocked: removed.unlocked,
    };
  });

  // -------------------------------------------------------------------------
  // GET /tournaments/:id/standings?categoryId=
  // -------------------------------------------------------------------------
  app.get<{
    Params: { id: string };
    Querystring: { categoryId?: string };
  }>('/tournaments/:id/standings', async (request, reply) => {
    const { id: tournamentId } = request.params;
    const { categoryId: filterCategoryId } = request.query;

    const tournament = await store.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    if (!(await store.isTournamentOwnedBy(tournamentId, request.userId ?? ''))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const mix = tournament.mixCategories === true;
    const [allCategories, allParticipants, allGames] = await Promise.all([
      store.listCategories(tournamentId),
      store.listParticipants(tournamentId),
      store.listGames(tournamentId),
    ]);

    if (mix || allCategories.filter((c) => !c.deletedAt).length === 0) {
      const players: EnginePlayer[] = allParticipants
        .filter((p) => !p.deletedAt)
        .map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames.filter((g) => !g.deletedAt).map(gameToPastGame);
      const standingsOpts = {
        tiebreakOrder: tournament.tiebreakOrder ?? null,
        sharedPlaces: tournament.sharedPlaces ?? true,
      };
      return [
        {
          categoryId: null,
          categoryName: 'Open (mixed)',
          standings: computeStandings(players, pastGames, standingsOpts),
        },
      ];
    }

    const categories = filterCategoryId
      ? allCategories.filter((c) => c.id === filterCategoryId && !c.deletedAt)
      : allCategories.filter((c) => !c.deletedAt);

    const standingsOpts = {
      tiebreakOrder: tournament.tiebreakOrder ?? null,
      sharedPlaces: tournament.sharedPlaces ?? true,
    };

    return categories.map((category) => {
      const catParticipants = allParticipants.filter(
        (p) => p.categoryIds.includes(category.id) && !p.deletedAt,
      );
      const players: EnginePlayer[] = catParticipants.map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames
        .filter((g) => g.categoryId === category.id && !g.deletedAt)
        .map(gameToPastGame);

      return {
        categoryId: category.id,
        categoryName: category.name,
        standings: computeStandings(players, pastGames, standingsOpts),
      };
    });
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function participantToEnginePlayer(p: Participant): EnginePlayer {
  return {
    id: p.id,
    name: p.name,
    rating: p.rating ?? null,
    seed: p.seed,
  };
}

function gameToPastGame(g: Game): PastGame {
  return {
    round: g.round,
    whiteId: g.whiteId,
    blackId: g.blackId,
    result: g.result,
    isBye: g.isBye,
  };
}
