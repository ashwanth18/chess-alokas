import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { ColumnMappingSchema, assignCategories } from '@chess-alokas/shared';
import type { ParticipantFields } from '@chess-alokas/shared';
import type { Store } from '../db.js';
import { parseParticipantsFile } from '../import.js';
import { requireAuth } from '../auth.js';

interface PluginOptions extends FastifyPluginOptions {
  store: Store;
}

export const importPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const { store } = opts;
  app.addHook('preHandler', requireAuth);

  /**
   * POST /tournaments/:id/import
   *
   * Multipart fields:
   *   file     – CSV or XLSX attachment
   *   mapping  – JSON string matching ColumnMappingSchema
   *   mode     – "append" (default) | "replace"
   */
  app.post<{ Params: { id: string } }>(
    '/tournaments/:id/import',
    async (request, reply) => {
      const { id: tournamentId } = request.params;

      const tournament = await store.getTournament(tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }

      // --- Parse multipart parts ---
      let fileBuffer: Buffer | null = null;
      let filename = 'upload';
      let mappingRaw = '';
      let mode: 'append' | 'replace' = 'append';

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          filename = part.filename || 'upload';
        } else {
          const value = part.value as string;
          if (part.fieldname === 'mapping') mappingRaw = value;
          else if (part.fieldname === 'mode' && (value === 'append' || value === 'replace')) {
            mode = value;
          }
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }
      if (!mappingRaw) {
        return reply.code(400).send({ error: 'Missing "mapping" field' });
      }

      let mappingJson: unknown;
      try {
        mappingJson = JSON.parse(mappingRaw);
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON in "mapping" field' });
      }

      const mappingParsed = ColumnMappingSchema.safeParse(mappingJson);
      if (!mappingParsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid column mapping', details: mappingParsed.error.format() });
      }

      // --- Parse file ---
      let rows;
      try {
        rows = parseParticipantsFile(fileBuffer, filename, mappingParsed.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(422).send({ error: `File parse error: ${msg}` });
      }

      if (rows.length === 0) {
        return reply.code(422).send({ error: 'No valid rows found in file' });
      }

      // --- Assign categories ---
      const categories = await store.listCategories(tournamentId);
      // ParsedParticipantRow matches ParticipantFields at runtime; cast at boundary
      const categoryMap = assignCategories(rows as unknown as ParticipantFields[], categories);

      // --- Build Participant records ---
      const now = new Date().toISOString();
      const participants = rows.map((row, idx) => ({
        id: crypto.randomUUID(),
        tournamentId,
        name: row.name,
        age: row.age,
        gender: row.gender,
        rating: row.rating,
        club: row.club,
        customFields: row.customFields,
        categoryIds: categoryMap.get(idx) ?? [],
        updatedAt: now,
      }));

      // --- Replace or append ---
      if (mode === 'replace') {
        await store.softDeleteParticipantsByTournament(tournamentId);
      }

      const created = await store.upsertParticipants(participants);
      return reply.code(201).send({ imported: created.length, participants: created });
    },
  );
};
