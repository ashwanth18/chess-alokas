import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import {
  createCertificateIssueStore,
  type CertificateIssueStore,
} from '../certificates/store.js';
import { readCertificatePdf, saveCertificatePdf } from '../certificates/storage.js';
import { authEnabled, requireAuth } from '../auth.js';
import { MAX_EMAIL_PDF_BYTES, sendResendEmail } from '../lib/resend.js';
import {
  DEFAULT_CERT_EMAIL_BODY,
  DEFAULT_CERT_EMAIL_SUBJECT,
  certBodyToHtml,
  certTypeLabel,
  renderCertTemplate,
  type Organization,
  type OrganizationPlanTier,
} from '@chess-alokas/shared';


/** Rolling 24-hour caps. A trial keeps its 5 test emails and has no bulk sending. */
const TRIAL_TEST_EMAILS_PER_DAY = 5;
const VERIFIED_TEST_EMAILS_PER_DAY = 50;
const BULK_EMAILS_PER_DAY: Partial<Record<OrganizationPlanTier, number>> = {
  event_pass: 500,
  pro: 2000,
  enterprise: 5000,
};

function testEmailLimit(org: Organization | null): number {
  return org?.verificationStatus === 'verified'
    ? VERIFIED_TEST_EMAILS_PER_DAY
    : TRIAL_TEST_EMAILS_PER_DAY;
}

/** 0 means this organization may not bulk-send at all. */
function bulkEmailLimit(org: Organization | null): number {
  if (org?.verificationStatus !== 'verified') return 0;
  return BULK_EMAILS_PER_DAY[org.planTier] ?? 0;
}

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

      for (const item of parsed.data.items) {
        if (item.participantId) {
          const participant = await tournamentStore.getParticipant(item.participantId);
          if (participant?.tournamentId !== tournamentId) {
            return reply.code(400).send({ error: 'participantId is not in this tournament.' });
          }
        }
        if (item.categoryId) {
          const category = await tournamentStore.getCategory(item.categoryId);
          if (category?.tournamentId !== tournamentId) {
            return reply.code(400).send({ error: 'categoryId is not in this tournament.' });
          }
        }
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
        if ('registerCertificateIssue' in tournamentStore && typeof tournamentStore.registerCertificateIssue === 'function') {
          tournamentStore.registerCertificateIssue(issue);
        }
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
      if (request.userId) {
        let allowed = await tournamentStore.isTournamentOwnedBy(
          issue.tournamentId,
          request.userId,
        );
        if (!allowed) {
          const profiles = await tournamentStore.listPlayerProfiles(request.userId);
          const profileIds = new Set(profiles.map((p) => p.id));
          if (issue.participantId) {
            const part = await tournamentStore.getParticipant(issue.participantId);
            if (part?.playerProfileId && profileIds.has(part.playerProfileId)) {
              allowed = true;
            }
          }
          // profile.email is typed in by the user, so it proves nothing.
          if (
            !allowed &&
            issue.recipientEmail &&
            request.confirmedEmail &&
            issue.recipientEmail.trim().toLowerCase() === request.confirmedEmail
          ) {
            allowed = true;
          }
        }
        if (!allowed) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
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

      // With auth on, a test goes only to the sender's own confirmed address. Otherwise any
      // account could use the platform's domain to mail strangers.
      if (authEnabled() || request.confirmedEmail) {
        const own = request.confirmedEmail ?? null;
        if (!own) {
          return reply.code(403).send({ error: 'Confirm your account email to send a test.' });
        }
        if (parsed.data.to.trim().toLowerCase() !== own) {
          return reply.code(403).send({
            error: 'Test emails can only be sent to your own account email address.',
          });
        }
      }

      const org = tournament.organizationId
        ? await tournamentStore.getOrganization(tournament.organizationId)
        : null;
      const testCap = await tournamentStore.reserveEmailSends({
        kind: 'test',
        scopeKey: request.userId ? `user:${request.userId}` : `tournament:${tournamentId}`,
        count: 1,
        limit: testEmailLimit(org),
        tournamentId,
        userId: request.userId ?? null,
      });
      if (!testCap.allowed) {
        return reply.code(429).send({
          error: `Daily test email limit reached (${testCap.limit} per day).`,
        });
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

      const bulkOrg = tournament.organizationId
        ? await tournamentStore.getOrganization(tournament.organizationId)
        : null;
      // Local desktop use has no organizations and sends through the user's own Resend key.
      if (authEnabled() || request.userId) {
        const bulkLimit = bulkEmailLimit(bulkOrg);
        if (bulkLimit === 0) {
          return reply.code(403).send({
            error: 'Organizer Verification is required to email certificates to players.',
          });
        }
        const recipients = targets.filter((i) => i.recipientEmail?.trim()).length;
        if (recipients > 0) {
          const cap = await tournamentStore.reserveEmailSends({
            kind: 'bulk',
            scopeKey: `org:${bulkOrg!.id}`,
            count: recipients,
            limit: bulkLimit,
            tournamentId,
            userId: request.userId ?? null,
          });
          if (!cap.allowed) {
            return reply.code(429).send({
              error: `Daily certificate email limit reached: ${cap.used} of ${cap.limit} used, and this send needs ${recipients}.`,
            });
          }
        }
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
