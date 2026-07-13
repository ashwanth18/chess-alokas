import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { GameResultSchema, isStyleImplemented } from '@chess-alokas/shared';
import {
  pairRound,
  computeStandings,
  UnsupportedPairingStyleError,
  firstRoundMissingResults,
} from '@chess-alokas/pairing-engine';
import type { EnginePlayer, PastGame } from '@chess-alokas/pairing-engine';
import type { Participant, Game, Category } from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const pairingPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;
  app.addHook('preHandler', requireAuth);

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

    const allGames = await store.listGames(tournamentId);
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

    const allCategories = await store.listCategories(tournamentId);
    const activeCategories = allCategories.filter((c) => !c.deletedAt);
    const mix = tournament.mixCategories === true;

    const allParticipants = await store.listParticipants(tournamentId);
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
        .filter((p) => !p.deletedAt)
        .map(participantToEnginePlayer);
      if (players.length < 2) {
        return reply.code(400).send({ error: 'Need at least 2 participants to pair' });
      }

      const pastGames: PastGame[] = allGames
        .filter((g) => g.round < round && !g.deletedAt)
        .map(gameToPastGame);

      let pairingOutput;
      try {
        pairingOutput = pairRound(tournament.style, { players, pastGames, round });
      } catch (err) {
        if (err instanceof UnsupportedPairingStyleError) {
          return reply
            .code(422)
            .send({ error: `Pairing style "${tournament.style}" is not yet implemented` });
        }
        throw err;
      }

      for (const board of pairingOutput.boards) {
        const game = await store.createGame({
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
        });
        createdGames.push(game);
      }

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
        (p) => p.categoryIds.includes(category.id) && !p.deletedAt,
      );
      if (catParticipants.length < 2) continue;

      const players: EnginePlayer[] = catParticipants.map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames
        .filter((g) => g.categoryId === category.id && g.round < round)
        .map(gameToPastGame);

      let pairingOutput;
      try {
        pairingOutput = pairRound(tournament.style, { players, pastGames, round });
      } catch (err) {
        if (err instanceof UnsupportedPairingStyleError) {
          return reply
            .code(422)
            .send({ error: `Pairing style "${tournament.style}" is not yet implemented` });
        }
        throw err;
      }

      for (const board of pairingOutput.boards) {
        const game = await store.createGame({
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
        });
        createdGames.push(game);
      }
    }

    await store.updateTournament(tournamentId, {
      currentRound: Math.max(tournament.currentRound, round),
      status: round >= tournament.rounds ? 'completed' : 'in_progress',
      updatedAt: now,
    });

    return reply.code(201).send({ round, games: createdGames, mixCategories: false });
  });

  // -------------------------------------------------------------------------
  // PATCH /games/:id/result
  // -------------------------------------------------------------------------
  const ResultBodySchema = z.object({
    result: GameResultSchema,
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
      const updated = await store.updateGame(id, {
        result: parsed.data.result,
        updatedAt: new Date().toISOString(),
      });
      return updated;
    },
  );

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

    const mix = tournament.mixCategories === true;
    const allCategories = await store.listCategories(tournamentId);
    const allParticipants = await store.listParticipants(tournamentId);
    const allGames = await store.listGames(tournamentId);

    if (mix || allCategories.filter((c) => !c.deletedAt).length === 0) {
      const players: EnginePlayer[] = allParticipants
        .filter((p) => !p.deletedAt)
        .map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames.filter((g) => !g.deletedAt).map(gameToPastGame);
      return [
        {
          categoryId: null,
          categoryName: 'Open (mixed)',
          standings: computeStandings(players, pastGames),
        },
      ];
    }

    const categories = filterCategoryId
      ? allCategories.filter((c) => c.id === filterCategoryId && !c.deletedAt)
      : allCategories.filter((c) => !c.deletedAt);

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
        standings: computeStandings(players, pastGames),
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
