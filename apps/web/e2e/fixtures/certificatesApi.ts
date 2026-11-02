import type { Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { json } from './mockApi';
import { NOW, TOURNAMENT_ID, players } from './data';

/**
 * A stateful stand-in for the certificate routes, for Playwright. The real API is never contacted and
 * nothing is mailed: "sending" here only records which ids were asked for, the way the server would
 * hand them to Resend. Registered after mockApi's catch-all, so it answers first.
 */

export type FakeIssue = {
  id: string;
  tournamentId: string;
  participantId: string | null;
  categoryId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  type: 'participation' | 'winner';
  status: 'stored' | 'emailed' | 'failed';
  serial: string | null;
  error: string | null;
  emailedAt: string | null;
  createdAt: string;
};

export type CertificatesFake = {
  issues: FakeIssue[];
  /** Every bulk send the page asked for, in order: exactly the ids it posted. */
  sends: Array<{ issueIds: string[]; resend: boolean }>;
  /** Addresses that "bounce": the fake answers failed for them, as Resend would. */
  bounce: Set<string>;
  quota: { limit: number | null; used: number };
};

/** Invented addresses on a reserved domain. Two siblings share a parent's address on purpose. */
export const FIXTURE_EMAILS: Record<string, string | null> = Object.fromEntries(
  players.map((p, i) => {
    if (i === 3) return [p.id, null]; // no email on file
    if (i === 5) return [p.id, 'not-an-address']; // typed wrong at registration
    if (i === 0 || i === 1) return [p.id, 'parent.alekhine@example.invalid']; // siblings, one parent
    const local = p.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 24);
    return [p.id, `${local}@example.invalid`];
  }),
);

let counter = 0;
const nextId = () => `eeeeeeee-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

/** A plain landscape certificate drawn on the spot, so no file is committed or read from disk. */
export async function templatePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  const forest = rgb(0.06, 0.24, 0.18);
  const gold = rgb(0.72, 0.56, 0.2);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 24, y: 24, width: 794, height: 547, borderColor: forest, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: 774, height: 527, borderColor: gold, borderWidth: 1 });
  const centred = (text: string, y: number, size: number, font = plain) =>
    page.drawText(text, { x: (842 - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: forest });
  centred('Pretend Heights Chess Academy', 510, 16);
  centred('Certificate of Participation', 450, 38, bold);
  centred('presented to', 360, 14);
  return Buffer.from(await doc.save());
}

/** Issues already on the server before the page opens: one sent last week, one that failed. */
export function seededIssues(): FakeIssue[] {
  const sent = players[2]!;
  const failed = players[6]!;
  return [
    {
      id: nextId(),
      tournamentId: TOURNAMENT_ID,
      participantId: sent.id,
      categoryId: null,
      recipientName: sent.name,
      recipientEmail: FIXTURE_EMAILS[sent.id]!,
      type: 'participation',
      status: 'emailed',
      serial: 'CERT/001/2026',
      error: null,
      emailedAt: '2026-07-07T03:00:00.000Z',
      createdAt: '2026-07-07T02:00:00.000Z',
    },
    {
      id: nextId(),
      tournamentId: TOURNAMENT_ID,
      participantId: failed.id,
      categoryId: null,
      recipientName: failed.name,
      recipientEmail: FIXTURE_EMAILS[failed.id]!,
      type: 'participation',
      status: 'failed',
      serial: 'CERT/002/2026',
      error: 'Mailbox is full',
      emailedAt: null,
      createdAt: '2026-07-07T02:00:00.000Z',
    },
  ];
}

export async function installCertificatesApi(page: Page, opts: Partial<CertificatesFake> = {}): Promise<CertificatesFake> {
  const fake: CertificatesFake = {
    issues: opts.issues ?? [],
    sends: [],
    bounce: opts.bounce ?? new Set(),
    quota: opts.quota ?? { limit: 2000, used: 12 },
  };
  let serial = 10;
  const pdf = await templatePdf();

  // The stored PDF of one certificate, for the email step's preview.
  await page.route(/localhost:3999\/certificates\/[^/]+\/download/, async (route) => {
    const origin = (await route.request().headerValue('origin')) ?? 'http://localhost:4179';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/pdf', headers: cors, body: pdf });
  });

  await page.route(/localhost:3999\/tournaments\/[^/]+\/certificates/, async (route) => {
    const req = route.request();
    const origin = (await req.headerValue('origin')) ?? 'http://localhost:4179';
    const reply = (body: unknown, status = 200) => route.fulfill(json(body, status, origin));
    if (req.method() === 'OPTIONS') return reply({});
    const path = new URL(req.url()).pathname;
    const tournamentId = path.split('/')[2]!;
    const body = req.postDataJSON?.() as Record<string, unknown> | null;

    if (path.endsWith('/certificates') && req.method() === 'GET') {
      return reply({ issues: fake.issues.filter((i) => i.tournamentId === tournamentId) });
    }
    if (path.endsWith('/reserve-serials')) {
      const count = Number(body?.count ?? 0);
      return reply({ serials: Array.from({ length: count }, () => `CERT/${String(++serial).padStart(3, '0')}/2026`) });
    }
    if (path.endsWith('/issue')) {
      const items = (body?.items ?? []) as Array<Record<string, unknown>>;
      const created = items.map((item) => {
        const issue: FakeIssue = {
          id: nextId(),
          tournamentId,
          participantId: (item.participantId as string) ?? null,
          categoryId: (item.categoryId as string) ?? null,
          recipientName: String(item.recipientName),
          recipientEmail: (item.recipientEmail as string) || null,
          type: item.type as FakeIssue['type'],
          status: 'stored',
          serial: (item.serial as string) ?? null,
          error: null,
          emailedAt: null,
          createdAt: NOW,
        };
        fake.issues.push(issue);
        return issue;
      });
      return reply({ issued: created.length, issues: created, storageBackend: 'supabase' }, 201);
    }
    if (path.endsWith('/email-quota')) {
      const { limit, used } = fake.quota;
      return reply({
        canSend: limit === null || limit > 0,
        demo: false,
        emailConfigured: true,
        limit,
        used,
        remaining: limit === null ? null : Math.max(0, limit - used),
        reason: null,
      });
    }
    if (path.endsWith('/email-test')) {
      return reply({ sent: true, attachedPdf: true, to: body?.to });
    }
    if (path.endsWith('/email')) {
      const issueIds = (body?.issueIds ?? []) as string[];
      const resend = Boolean(body?.resend);
      fake.sends.push({ issueIds, resend });
      const results = issueIds.map((id) => {
        const issue = fake.issues.find((i) => i.id === id)!;
        const email = issue.recipientEmail;
        if (fake.bounce.has(email ?? '')) {
          issue.status = 'failed';
          issue.error = 'The recipient address bounced';
          return { id, name: issue.recipientName, email, status: 'failed', error: issue.error };
        }
        issue.status = 'emailed';
        issue.error = null;
        issue.emailedAt = NOW;
        return { id, name: issue.recipientName, email, status: 'emailed' };
      });
      fake.quota.used += results.length;
      return reply({
        sent: results.filter((r) => r.status === 'emailed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: 0,
        results,
      });
    }
    return route.fallback();
  });
  return fake;
}

/** Gives the seeded players the fixture addresses, straight into IndexedDB like seedDesk does. */
export async function seedEmails(page: Page) {
  await page.evaluate(async (emails) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chess-alokas');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('participants', 'readwrite');
      const store = tx.objectStore('participants');
      for (const [id, email] of Object.entries(emails)) {
        const get = store.get(id);
        get.onsuccess = () => {
          if (get.result) store.put({ ...get.result, email });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, FIXTURE_EMAILS);
}
