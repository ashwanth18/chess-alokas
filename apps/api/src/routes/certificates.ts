import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import {
  createCertificateIssueStore,
  type CertificateIssueStore,
} from '../certificates/store.js';
import { readCertificatePdf, saveCertificatePdf } from '../certificates/storage.js';

const IssueItemSchema = z.object({
  participantId: z.string().uuid().nullable().optional(),
  type: z.enum(['participation', 'winner']),
  rank: z.number().int().positive().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  recipientEmail: z.string().email().nullable().optional().or(z.literal('')).optional(),
  recipientName: z.string().min(1),
  /** Base64-encoded compressed PDF */
  pdfBase64: z.string().min(1),
});

const IssueBodySchema = z.object({
  items: z.array(IssueItemSchema).min(1).max(500),
});

const EmailBodySchema = z.object({
  issueIds: z.array(z.string().uuid()).optional(),
  /** If true, email all stored issues that have not been emailed yet. */
  allPending: z.boolean().optional(),
});

function decodePdf(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.split(',')[1]! : base64;
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  pdf: Uint8Array;
  fileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'] ?? 'Chess Alokas <onboarding@resend.dev>';
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  const attachment =
    opts.pdf.byteLength > 8 * 1024 * 1024
      ? undefined
      : [
          {
            filename: opts.fileName,
            content: Buffer.from(opts.pdf).toString('base64'),
          },
        ];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      attachments: attachment,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text.slice(0, 300) || `Resend HTTP ${res.status}` };
  }
  return { ok: true };
}

interface PluginOptions {
  store: Store;
  certificateStore?: CertificateIssueStore;
}

export const certificatesPlugin: FastifyPluginAsync<PluginOptions> = async (app, opts) => {
  const tournamentStore = opts.store;
  const certStore = opts.certificateStore ?? createCertificateIssueStore();

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/certificates/issue',
    async (request, reply) => {
      const tournamentId = request.params.id;
      const tournament = await tournamentStore.getTournament(tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }

      const parsed = IssueBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }

      const created = [];
      let storageBackend: 'supabase' | 'local' = 'local';
      for (const item of parsed.data.items) {
        const pdf = decodePdf(item.pdfBase64);
        const id = crypto.randomUUID();
        const saved = await saveCertificatePdf(tournamentId, id, pdf);
        storageBackend = saved.backend;
        const issue = await certStore.createIssue({
          id,
          tournamentId,
          participantId: item.participantId ?? null,
          type: item.type,
          rank: item.rank ?? null,
          categoryId: item.categoryId ?? null,
          recipientEmail: item.recipientEmail || null,
          recipientName: item.recipientName,
          storagePath: saved.storagePath,
          contentSha256: saved.contentSha256,
          byteSize: saved.byteSize,
          status: 'stored',
          createdAt: new Date().toISOString(),
        });
        created.push(issue);
      }

      return reply.code(201).send({
        issued: created.length,
        issues: created,
        storageBackend,
      });
    },
  );

  app.get<{ Params: { id: string } }>('/tournaments/:id/certificates', async (request, reply) => {
    const tournament = await tournamentStore.getTournament(request.params.id);
    if (!tournament || tournament.deletedAt) {
      return reply.code(404).send({ error: 'Tournament not found' });
    }
    const issues = await certStore.listIssues(request.params.id);
    return { issues };
  });

  app.get<{ Params: { issueId: string } }>(
    '/certificates/:issueId/download',
    async (request, reply) => {
      const issue = await certStore.getIssue(request.params.issueId);
      if (!issue) return reply.code(404).send({ error: 'Certificate not found' });
      const pdf = await readCertificatePdf(issue.storagePath);
      if (!pdf) return reply.code(404).send({ error: 'PDF file missing' });
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="${issue.recipientName.replace(/[^\w.\-]+/g, '_')}.pdf"`,
        )
        .send(Buffer.from(pdf));
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/certificates/email',
    async (request, reply) => {
      const tournamentId = request.params.id;
      const tournament = await tournamentStore.getTournament(tournamentId);
      if (!tournament || tournament.deletedAt) {
        return reply.code(404).send({ error: 'Tournament not found' });
      }

      const parsed = EmailBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }

      const all = await certStore.listIssues(tournamentId);
      let targets = all;
      if (parsed.data.issueIds?.length) {
        const set = new Set(parsed.data.issueIds);
        targets = all.filter((i) => set.has(i.id));
      } else if (parsed.data.allPending) {
        targets = all.filter((i) => i.status === 'stored' || i.status === 'failed');
      }

      const results: Array<{ id: string; status: string; error?: string }> = [];

      for (const issue of targets) {
        const email = issue.recipientEmail?.trim();
        if (!email) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: 'Missing recipient email',
          });
          results.push({ id: issue.id, status: 'failed', error: 'Missing recipient email' });
          continue;
        }

        const pdf = await readCertificatePdf(issue.storagePath);
        if (!pdf) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: 'PDF file missing',
          });
          results.push({ id: issue.id, status: 'failed', error: 'PDF file missing' });
          continue;
        }

        const kind = issue.type === 'winner' ? 'Winner' : 'Participation';
        const send = await sendResendEmail({
          to: email,
          subject: `${kind} certificate — ${tournament.name}`,
          html: `<p>Dear ${issue.recipientName},</p>
<p>Please find attached your ${kind.toLowerCase()} certificate for <strong>${tournament.name}</strong>.</p>
<p>— Chess Alokas</p>`,
          pdf,
          fileName: `${issue.recipientName.replace(/[^\w.\-]+/g, '_')}.pdf`,
        });

        if (send.ok) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'emailed',
            emailedAt: new Date().toISOString(),
            error: null,
          });
          results.push({ id: issue.id, status: 'emailed' });
        } else {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: send.error,
          });
          results.push({ id: issue.id, status: 'failed', error: send.error });
        }
      }

      return {
        sent: results.filter((r) => r.status === 'emailed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        results,
      };
    },
  );
};
