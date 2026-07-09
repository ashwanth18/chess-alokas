import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { GameResultSchema, isStyleImplemented } from '@chess-alokas/shared';
import {
  pairRound,
  computeStandings,
  UnsupportedPairingStyleError,
} from '@chess-alokas/pairing-engine';
import type { EnginePlayer, PastGame } from '@chess-alokas/pairing-engine';
import type { Participant, Game, Category } from '@chess-alokas/shared';
import type { Store } from '../db.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const pairingPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

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

    const bodyParsed = PairBodySchema.safeParse(request.body ?? {});
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: bodyParsed.error.format() });
    }
    const { categoryId: filterCategoryId } = bodyParsed.data;

    const allCategories = await store.listCategories(tournamentId);
    const categoriesToPair: Category[] = filterCategoryId
      ? allCategories.filter((c) => c.id === filterCategoryId && !c.deletedAt)
      : allCategories.filter((c) => !c.deletedAt);

    if (categoriesToPair.length === 0) {
      return reply.code(404).send({ error: 'No matching categories found' });
    }

    const allParticipants = await store.listParticipants(tournamentId);
    const allGames = await store.listGames(tournamentId);
    const createdGames: Game[] = [];

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
      if (catParticipants.length === 0) continue;

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

      const now = new Date().toISOString();
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

    return reply.code(201).send({ round, games: createdGames });
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

    const allCategories = await store.listCategories(tournamentId);
    const categories = filterCategoryId
      ? allCategories.filter((c) => c.id === filterCategoryId && !c.deletedAt)
      : allCategories.filter((c) => !c.deletedAt);

    const allParticipants = await store.listParticipants(tournamentId);
    const allGames = await store.listGames(tournamentId);

    return categories.map((category) => {
      const catParticipants = allParticipants.filter(
        (p) => p.categoryIds.includes(category.id) && !p.deletedAt,
      );
      const players: EnginePlayer[] = catParticipants.map(participantToEnginePlayer);
      const pastGames: PastGame[] = allGames
        .filter((g) => g.categoryId === category.id)
        .map(gameToPastGame);

      const standings = computeStandings(players, pastGames);
      return { categoryId: category.id, categoryName: category.name, standings };
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
