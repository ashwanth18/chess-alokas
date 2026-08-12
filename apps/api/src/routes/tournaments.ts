import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  CreateTournamentInputSchema,
  FilterGroupSchema,
} from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { requireAuth } from '../auth.js';
import { generatePublicLiveToken } from '../floor/pin.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

async function assertOwner(
  store: Store,
  tournamentId: string,
  userId: string | undefined,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  if (!userId) return true;
  const ok = await store.isTournamentOwnedBy(tournamentId, userId);
  if (!ok) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export const tournamentsPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;

  app.get('/tournaments', { preHandler: requireAuth }, async (request) => {
    return store.listTournaments(request.userId ?? null);
  });

  app.post<{ Body: unknown }>('/tournaments', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateTournamentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
    }
    const input = parsed.data;
    const now = new Date().toISOString();
    const tournamentId = crypto.randomUUID();

    const tournament = await store.createTournament({
      id: tournamentId,
      name: input.name,
      date: input.date ?? null,
      style: input.style,
      rounds: input.rounds,
      status: 'draft',
      currentRound: 0,
      confirmedRounds: 0,
      tableCount: 0,
      arbiterPinRound: null,
      mixCategories: input.mixCategories ?? false,
      prizePlaces: input.prizePlaces ?? 3,
      awardScope: input.awardScope ?? 'per_category',
      tiebreakOrder: input.tiebreakOrder ?? null,
      sharedPlaces: input.sharedPlaces ?? true,
      ownerId: request.userId ?? null,
      publicToken: null,
      publicEnabled: false,
      updatedAt: now,
    });

    const categories = await Promise.all(
      input.categories.map((cat, i) =>
        store.createCategory({
          id: crypto.randomUUID(),
          tournamentId,
          name: cat.name,
          filter: cat.filter,
          sortOrder: cat.sortOrder ?? i,
          prizePlaces: cat.prizePlaces ?? null,
          updatedAt: now,
        }),
      ),
    );

    return reply.code(201).send({ ...tournament, categories });
  });

  app.get<{ Params: { id: string } }>(
    '/tournaments/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const [tournament, categories, participants, games] = await Promise.all([
        store.getTournament(id),
        store.listCategories(id),
        store.listParticipants(id),
        store.listGames(id),
      ]);
      if (!tournament) return reply.code(404).send({ error: 'Tournament not found' });
      return { ...tournament, categories, participants, games };
    },
  );

  const PatchTournamentSchema = z.object({
    name: z.string().min(1).optional(),
    date: z.string().nullable().optional(),
    style: z.enum(['swiss', 'round_robin']).optional(),
    rounds: z.number().int().positive().optional(),
    status: z.enum(['draft', 'ready', 'in_progress', 'completed']).optional(),
    currentRound: z.number().int().nonnegative().optional(),
    confirmedRounds: z.number().int().nonnegative().optional(),
    mixCategories: z.boolean().optional(),
    prizePlaces: z.number().int().min(1).max(20).optional(),
    awardScope: z.enum(['overall', 'per_category']).optional(),
    clientId: z.string().optional(),
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const parsed = PatchTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const updated = await store.updateTournament(id, {
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      });
      if (!updated) return reply.code(404).send({ error: 'Tournament not found' });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/tournaments/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const now = new Date().toISOString();
      const updated = await store.updateTournament(id, { deletedAt: now, updatedAt: now });
      if (!updated) return reply.code(404).send({ error: 'Tournament not found' });
      return reply.code(204).send();
    },
  );

  const CreateCategorySchema = z.object({
    name: z.string().min(1),
    filter: FilterGroupSchema,
    sortOrder: z.number().int().optional(),
    prizePlaces: z.number().int().min(1).max(20).nullable().optional(),
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/categories',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      const parsed = CreateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const existingCats = await store.listCategories(id);
      const maxOrder = existingCats.reduce((m, c) => Math.max(m, c.sortOrder), -1);
      const category = await store.createCategory({
        id: crypto.randomUUID(),
        tournamentId: id,
        name: parsed.data.name,
        filter: parsed.data.filter,
        sortOrder: parsed.data.sortOrder ?? maxOrder + 1,
        prizePlaces: parsed.data.prizePlaces ?? null,
        updatedAt: new Date().toISOString(),
      });
      return reply.code(201).send(category);
    },
  );

  const PatchCategorySchema = z.object({
    name: z.string().min(1).optional(),
    filter: FilterGroupSchema.optional(),
    sortOrder: z.number().int().optional(),
    prizePlaces: z.number().int().min(1).max(20).nullable().optional(),
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/categories/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await store.getCategory(id);
      if (!existing) return reply.code(404).send({ error: 'Category not found' });
      if (!(await assertOwner(store, existing.tournamentId, request.userId, reply))) return;
      const parsed = PatchCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const updated = await store.updateCategory(id, {
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      });
      if (!updated) return reply.code(404).send({ error: 'Category not found' });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/categories/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await store.getCategory(id);
      if (!existing) return reply.code(404).send({ error: 'Category not found' });
      if (!(await assertOwner(store, existing.tournamentId, request.userId, reply))) return;
      const now = new Date().toISOString();
      const updated = await store.updateCategory(id, { deletedAt: now, updatedAt: now });
      if (!updated) return reply.code(404).send({ error: 'Category not found' });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tournaments/:id/public-live/enable',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      const now = new Date().toISOString();
      const updated = await store.updateTournament(id, {
        publicToken: tournament.publicToken ?? generatePublicLiveToken(),
        publicEnabled: true,
        updatedAt: now,
      });
      if (!updated) return reply.code(404).send({ error: 'Tournament not found' });
      return {
        publicToken: updated.publicToken,
        publicEnabled: updated.publicEnabled,
        updatedAt: updated.updatedAt,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tournaments/:id/public-live/rotate',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      const now = new Date().toISOString();
      const updated = await store.updateTournament(id, {
        publicToken: generatePublicLiveToken(),
        publicEnabled: true,
        updatedAt: now,
      });
      if (!updated) return reply.code(404).send({ error: 'Tournament not found' });
      return {
        publicToken: updated.publicToken,
        publicEnabled: updated.publicEnabled,
        updatedAt: updated.updatedAt,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tournaments/:id/public-live/disable',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await assertOwner(store, id, request.userId, reply))) return;
      const tournament = await store.getTournament(id);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }
      const now = new Date().toISOString();
      const updated = await store.updateTournament(id, {
        publicEnabled: false,
        updatedAt: now,
      });
      if (!updated) return reply.code(404).send({ error: 'Tournament not found' });
      return {
        publicToken: updated.publicToken,
        publicEnabled: updated.publicEnabled,
        updatedAt: updated.updatedAt,
      };
    },
  );
};
