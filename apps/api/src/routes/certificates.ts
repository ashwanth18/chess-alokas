import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import {
  createCertificateIssueStore,
  type CertificateIssueStore,
} from '../certificates/store.js';
import { readCertificatePdf, saveCertificatePdf } from '../certificates/storage.js';
import { requireAuth } from '../auth.js';
import {
  DEFAULT_CERT_EMAIL_BODY,
  DEFAULT_CERT_EMAIL_SUBJECT,
  certBodyToHtml,
  certTypeLabel,
  renderCertTemplate,
} from '@chess-alokas/shared';

const MAX_EMAIL_PDF_BYTES = 8 * 1024 * 1024;

const IssueItemSchema = z.object({
  participantId: z.string().uuid().nullable().optional(),
  type: z.enum(['participation', 'winner']),
  rank: z.number().int().positive().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  recipientEmail: z.string().email().nullable().optional().or(z.literal('')).optional(),
  recipientName: z.string().min(1),
  serial: z.string().min(1).max(64).nullable().optional(),
  /** Base64-encoded compressed PDF */
  pdfBase64: z.string().min(1),
});

const IssueBodySchema = z.object({
  items: z.array(IssueItemSchema).min(1).max(500),
});

const EmailBodySchema = z.object({
  issueIds: z.array(z.string().uuid()).optional(),
  /** Email stored/failed issues only. Required unless issueIds is set. */
  allPending: z.boolean().optional(),
  /** If true, also include already-emailed issues (opt-in resend). */
  resend: z.boolean().optional(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(20_000).optional(),
});

const EmailTestBodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(20_000).optional(),
  issueId: z.string().uuid().optional(),
});

const ReserveSerialsBodySchema = z.object({
  count: z.number().int().min(1).max(500),
});

function decodePdf(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.split(',')[1]! : base64;
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

function emailVars(opts: {
  playerName: string;
  tournament: string;
  type: string;
  serial?: string | null;
}) {
  return {
    playerName: opts.playerName,
    tournament: opts.tournament,
    certType: certTypeLabel(opts.type),
    serial: opts.serial?.trim() || '—',
  };
}

async function sendResendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  pdf?: Uint8Array;
  fileName?: string;
  requirePdf?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'] ?? 'Chess Alokas <onboarding@resend.dev>';
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  if (opts.requirePdf) {
    if (!opts.pdf) return { ok: false, error: 'PDF file missing' };
    if (opts.pdf.byteLength > MAX_EMAIL_PDF_BYTES) {
      return { ok: false, error: 'PDF is too large to email (over 8 MB)' };
    }
    if (!opts.fileName) return { ok: false, error: 'PDF file missing' };
  }

  const attachments =
    opts.pdf && opts.pdf.byteLength <= MAX_EMAIL_PDF_BYTES && opts.fileName
      ? [
          {
            filename: opts.fileName,
            content: Buffer.from(opts.pdf).toString('base64'),
          },
        ]
      : undefined;

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
      attachments,
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

  async function assertOwner(
    tournamentId: string,
    userId: string | undefined,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) {
    const tournament = await tournamentStore.getTournament(tournamentId);
    if (!tournament || tournament.deletedAt) {
      return { tournament: null as null, forbidden: false, missing: true };
    }
    if (userId && !(await tournamentStore.isTournamentOwnedBy(tournamentId, userId))) {
      reply.code(403).send({ error: 'Forbidden' });
      return { tournament: null, forbidden: true, missing: false };
    }
    return { tournament, forbidden: false, missing: false };
  }

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/certificates/reserve-serials',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tournament, forbidden, missing } = await assertOwner(
        request.params.id,
        request.userId,
        reply,
      );
      if (forbidden) return;
      if (missing || !tournament) return reply.code(404).send({ error: 'Tournament not found' });
      const parsed = ReserveSerialsBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      const serials = await tournamentStore.allocateCertificateSerials(
        request.params.id,
        parsed.data.count,
      );
      return { serials };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/certificates/issue',
    { preHandler: requireAuth },
    async (request, reply) => {
      const tournamentId = request.params.id;
      const { tournament, forbidden, missing } = await assertOwner(
        tournamentId,
        request.userId,
        reply,
      );
      if (forbidden) return;
      if (missing || !tournament) return reply.code(404).send({ error: 'Tournament not found' });

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
          serial: item.serial || null,
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

  app.get<{ Params: { id: string } }>(
    '/tournaments/:id/certificates',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tournament, forbidden, missing } = await assertOwner(
        request.params.id,
        request.userId,
        reply,
      );
      if (forbidden) return;
      if (missing || !tournament) return reply.code(404).send({ error: 'Tournament not found' });
      const issues = await certStore.listIssues(request.params.id);
      return { issues };
    },
  );

  app.get<{ Params: { issueId: string } }>(
    '/certificates/:issueId/download',
    { preHandler: requireAuth },
    async (request, reply) => {
      const issue = await certStore.getIssue(request.params.issueId);
      if (!issue) return reply.code(404).send({ error: 'Certificate not found' });
      if (
        request.userId &&
        !(await tournamentStore.isTournamentOwnedBy(issue.tournamentId, request.userId))
      ) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
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
    '/tournaments/:id/certificates/email-test',
    { preHandler: requireAuth },
    async (request, reply) => {
      const tournamentId = request.params.id;
      const { tournament, forbidden, missing } = await assertOwner(
        tournamentId,
        request.userId,
        reply,
      );
      if (forbidden) return;
      if (missing || !tournament) return reply.code(404).send({ error: 'Tournament not found' });

      const parsed = EmailTestBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }

      const all = await certStore.listIssues(tournamentId);
      const issue =
        (parsed.data.issueId
          ? all.find((i) => i.id === parsed.data.issueId)
          : all.find((i) => i.status === 'stored' || i.status === 'emailed' || i.status === 'failed')) ??
        null;
      const pdf = issue ? await readCertificatePdf(issue.storagePath) : null;

      const vars = emailVars({
        playerName: issue?.recipientName || 'Test recipient',
        tournament: tournament.name,
        type: issue?.type || 'participation',
        serial: issue?.serial || 'TEST/000/0000',
      });
      const subject = renderCertTemplate(
        parsed.data.subject || tournament.certEmailSubject || DEFAULT_CERT_EMAIL_SUBJECT,
        vars,
      );
      const html = certBodyToHtml(
        renderCertTemplate(
          parsed.data.body || tournament.certEmailBody || DEFAULT_CERT_EMAIL_BODY,
          vars,
        ),
      );

      const send = await sendResendEmail({
        to: parsed.data.to,
        subject: `[TEST] ${subject}`,
        html,
        pdf: pdf ?? undefined,
        fileName: issue
          ? `${issue.recipientName.replace(/[^\w.\-]+/g, '_')}.pdf`
          : undefined,
        requirePdf: false,
      });
      if (!send.ok) {
        return reply.code(502).send({ error: send.error, attachedPdf: Boolean(pdf) });
      }
      return { sent: true, attachedPdf: Boolean(pdf), to: parsed.data.to };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/tournaments/:id/certificates/email',
    { preHandler: requireAuth },
    async (request, reply) => {
      const tournamentId = request.params.id;
      const { tournament, forbidden, missing } = await assertOwner(
        tournamentId,
        request.userId,
        reply,
      );
      if (forbidden) return;
      if (missing || !tournament) return reply.code(404).send({ error: 'Tournament not found' });

      const parsed = EmailBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.format() });
      }
      if (!parsed.data.issueIds?.length && !parsed.data.allPending) {
        return reply.code(400).send({
          error: 'Pass allPending: true or issueIds. Mass email will not run without an explicit target.',
        });
      }

      const all = await certStore.listIssues(tournamentId);
      let targets = all;
      if (parsed.data.issueIds?.length) {
        const set = new Set(parsed.data.issueIds);
        targets = all.filter((i) => set.has(i.id));
        if (!parsed.data.resend) {
          targets = targets.filter((i) => i.status === 'stored' || i.status === 'failed');
        }
      } else if (parsed.data.resend) {
        targets = all.filter((i) => i.status !== 'pending');
      } else {
        targets = all.filter((i) => i.status === 'stored' || i.status === 'failed');
      }

      const subjectTpl =
        parsed.data.subject || tournament.certEmailSubject || DEFAULT_CERT_EMAIL_SUBJECT;
      const bodyTpl = parsed.data.body || tournament.certEmailBody || DEFAULT_CERT_EMAIL_BODY;

      const results: Array<{
        id: string;
        name: string;
        email: string | null;
        status: string;
        error?: string;
      }> = [];

      for (const issue of targets) {
        const email = issue.recipientEmail?.trim() || null;
        if (!email) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: 'Missing recipient email',
          });
          results.push({
            id: issue.id,
            name: issue.recipientName,
            email: null,
            status: 'failed',
            error: 'Missing recipient email',
          });
          continue;
        }

        const pdf = await readCertificatePdf(issue.storagePath);
        if (!pdf) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: 'PDF file missing',
          });
          results.push({
            id: issue.id,
            name: issue.recipientName,
            email,
            status: 'failed',
            error: 'PDF file missing',
          });
          continue;
        }
        if (pdf.byteLength > MAX_EMAIL_PDF_BYTES) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: 'PDF is too large to email (over 8 MB)',
          });
          results.push({
            id: issue.id,
            name: issue.recipientName,
            email,
            status: 'failed',
            error: 'PDF is too large to email (over 8 MB)',
          });
          continue;
        }

        const vars = emailVars({
          playerName: issue.recipientName,
          tournament: tournament.name,
          type: issue.type,
          serial: issue.serial,
        });
        const send = await sendResendEmail({
          to: email,
          subject: renderCertTemplate(subjectTpl, vars),
          html: certBodyToHtml(renderCertTemplate(bodyTpl, vars)),
          pdf,
          fileName: `${issue.recipientName.replace(/[^\w.\-]+/g, '_')}.pdf`,
          requirePdf: true,
        });

        if (send.ok) {
          await certStore.updateIssueStatus(issue.id, {
            status: 'emailed',
            emailedAt: new Date().toISOString(),
            error: null,
          });
          results.push({ id: issue.id, name: issue.recipientName, email, status: 'emailed' });
        } else {
          await certStore.updateIssueStatus(issue.id, {
            status: 'failed',
            error: send.error,
          });
          results.push({
            id: issue.id,
            name: issue.recipientName,
            email,
            status: 'failed',
            error: send.error,
          });
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
