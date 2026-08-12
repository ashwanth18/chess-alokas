import type { FastifyPluginAsync } from 'fastify';
import { countCardsForPlayer, emptyCardCounts } from '@chess-alokas/shared';
import type { Store } from '../db.js';

type Opts = { store: Store };

/**
 * Sanitized tournament snapshot for parents / players (no auth).
 * Omits emails, pins, floor slugs, owner ids, audit fields.
 */
export const publicLivePlugin: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { store } = opts;

  app.get<{ Params: { token: string } }>('/public/live/:token', async (request, reply) => {
    const token = request.params.token?.trim();
    if (!token || token.length < 8) {
      return reply.code(404).send({ error: 'Live page not found' });
    }

    const tournament = await store.getTournamentByPublicToken(token);
    if (!tournament) {
      return reply.code(404).send({ error: 'Live page not found' });
    }

    const [categories, participants, games, cards] = await Promise.all([
      store.listCategories(tournament.id),
      store.listParticipants(tournament.id),
      store.listGames(tournament.id),
      store.listTournamentGameCards(tournament.id),
    ]);

    const cardsByGame = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = cardsByGame.get(card.gameId) ?? [];
      list.push(card);
      cardsByGame.set(card.gameId, list);
    }

    return {
      tournament: {
        name: tournament.name,
        date: tournament.date ?? null,
        rounds: tournament.rounds,
        currentRound: tournament.currentRound,
        confirmedRounds: tournament.confirmedRounds ?? 0,
        mixCategories: tournament.mixCategories ?? false,
        status: tournament.status,
        prizePlaces: tournament.prizePlaces ?? 3,
      },
      categories: categories
        .filter((c) => !c.deletedAt)
        .map((c) => ({
          id: c.id,
          name: c.name,
          prizePlaces: c.prizePlaces ?? null,
        })),
      players: participants
        .filter((p) => !p.deletedAt)
        .map((p) => ({
          id: p.id,
          name: p.name,
          rating: p.rating ?? null,
          club: p.club ?? null,
          school: p.school ?? p.club ?? null,
          city: p.city ?? null,
          state: p.state ?? null,
          country: p.country ?? 'Malaysia',
          yearOfBirth: p.yearOfBirth ?? null,
          seed: p.seed ?? null,
          categoryIds: p.categoryIds ?? [],
        })),
      games: games
        .filter((g) => !g.deletedAt)
        .map((g) => {
          const gameCards = cardsByGame.get(g.id) ?? [];
          return {
            id: g.id,
            round: g.round,
            board: g.board,
            whiteId: g.whiteId ?? null,
            blackId: g.blackId ?? null,
            result: g.result,
            isBye: g.isBye,
            categoryId: g.categoryId,
            whiteCards: g.whiteId
              ? countCardsForPlayer(gameCards, g.whiteId)
              : emptyCardCounts(),
            blackCards: g.blackId
              ? countCardsForPlayer(gameCards, g.blackId)
              : emptyCardCounts(),
          };
        }),
    };
  });
};
