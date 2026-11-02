import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { test, expect, json, settle, signIn, seedDesk } from './fixtures/mockApi';
import { EVENT_SLUG, NOW, TOURNAMENT_ID, publicEventDetail } from './fixtures/data';

/**
 * The public registration page in each of its states, and the organizer's preview of it.
 *
 * The checks run in the `checks` project. With REG_SHOTS=before or after, the same states are
 * photographed into docs/design/screenshots/registration-page/ instead: nothing is compared.
 */
const SHOTS = process.env.REG_SHOTS;
const DIR = join(import.meta.dirname, '..', '..', '..', 'docs', 'design', 'screenshots', 'registration-page');

type Event = (typeof publicEventDetail)['event'];
type Detail = Omit<typeof publicEventDetail, 'event'> & { event: Event & Record<string, unknown> };

const DAY = 86_400_000;
const inDays = (days: number) => new Date(new Date(NOW).getTime() + days * DAY).toISOString();

/** A stand-in payment QR. Every question type, NRIC and age proof are in LONG_FORM below. */
const QR_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><path d="M1 1h7v7H1zM13 1h7v7h-7zM1 13h7v7H1z" fill="none" stroke="#000" stroke-width="1.6"/><path d="M3 3h3v3H3zM15 3h3v3h-3zM3 15h3v3H3zM10 2h2v2h-2zM10 6h1v3h-1zM9 10h3v2H9zM13 10h2v1h-2zM17 10h3v2h-3zM14 13h2v2h-2zM18 14h2v3h-2zM10 14h2v2h-2zM13 17h3v3h-3zM10 18h2v2h-2z" fill="#000"/></svg>',
  );

const LONG_FORM = {
  collectSchool: true,
  collectFideId: true,
  collectPhone: true,
  collectNric: true,
  collectAgeProof: true,
  malayLabels: false,
  customQuestions: [
    { id: 'shirt', label: 'T-shirt size', type: 'select', required: true, options: ['XS', 'S', 'M', 'L'] },
    { id: 'diet', label: 'Dietary needs', type: 'text', required: false },
    { id: 'photo', label: 'Photos of this player may appear on our page', type: 'checkbox', required: false },
    { id: 'letter', label: 'School letter', type: 'file', required: false },
  ],
};

const STATES: Record<string, (e: Event) => Partial<Detail['event']>> = {
  form: () => ({}),
  long: () => ({
    registrationFormSchema: LONG_FORM as unknown as Event['registrationFormSchema'],
    paymentQrUrl: QR_SVG as unknown as null,
    registrationDeadline: inDays(2.2),
    registeredCount: 8,
    maxParticipants: 64,
    latitude: 3.1 as unknown as null,
    longitude: 101.6 as unknown as null,
  }),
  closed: () => ({ registrationOpen: false }),
  full: (e) => ({ registeredCount: e.maxParticipants }),
  demo: () => ({ isDemo: true, entryFeeCents: 0, name: 'Demo Valley Weekend Rapid' }),
};

async function serveEvent(page: Page, state: keyof typeof STATES, onSubmit?: (body: Record<string, unknown>) => void) {
  const event = { ...publicEventDetail.event, ...STATES[state]!(publicEventDetail.event) };
  const detail = { ...publicEventDetail, event };
  const mine = (url: URL) => url.port === '3999' && url.pathname.startsWith(`/public/events/${EVENT_SLUG}`);
  await page.route(mine, async (route: Route) => {
    const req = route.request();
    const origin = (await req.headerValue('origin')) ?? 'http://localhost:4179';
    if (req.method() === 'OPTIONS') return route.fulfill(json({}, 200, origin));
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/register') && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      onSubmit?.(body);
      const fee = (event.entryFeeCents ?? 0) > 0;
      return route.fulfill(
        json(
          {
            registration: {
              id: '55555555-5555-4555-8555-555555555555',
              tournamentId: TOURNAMENT_ID,
              playerSnapshot: { name: body.name },
              customAnswers: {},
              paymentStatus: fee ? (body.receiptDataUrl ? 'submitted' : 'pending_receipt') : 'not_required',
              amountCents: event.entryFeeCents,
              status: state === 'full' ? 'waitlisted' : 'pending',
              createdAt: NOW,
              updatedAt: NOW,
            },
          },
          201,
          origin,
        ),
      );
    }
    if (path.endsWith('/schools')) return route.fulfill(json({ schools: [] }, 200, origin));
    return route.fulfill(json(detail, 200, origin));
  });
}

async function open(page: Page, state: keyof typeof STATES, onSubmit?: (body: Record<string, unknown>) => void) {
  await serveEvent(page, state, onSubmit);
  await page.goto(`/register/${EVENT_SLUG}`);
  await page.locator('h1').first().waitFor();
  await settle(page);
}

/** A real image to attach: a picture of the page's own title. */
const somePng = (page: Page) => page.locator('h1').first().screenshot();

if (SHOTS) {
  mkdirSync(DIR, { recursive: true });
  const WIDTHS = [
    [390, 844],
    [1366, 768],
  ] as const;

  for (const [width, height] of WIDTHS) {
    test.describe(`shots at ${width}`, () => {
      test.beforeEach(async ({ page }) => page.setViewportSize({ width, height }));
      const shot = (page: Page, name: string) =>
        page.screenshot({ path: join(DIR, `${SHOTS}-${name}-${width}.png`), fullPage: true });

      for (const state of ['form', 'closed', 'full', 'demo'] as const) {
        test(state, async ({ page }) => {
          await open(page, state);
          await shot(page, state);
        });
      }

      test('long form, filled in', async ({ page }) => {
        await open(page, 'long');
        await page.getByLabel('Name (as in NRIC)').fill('Puteri Zugzwang binti Rook');
        await page.getByLabel('NRIC number').fill('140305145678');
        await page.getByLabel('Email').fill('zugzwang@example.test');
        const png = await somePng(page);
        await page
          .locator('input[type="file"]')
          .last()
          .setInputFiles({ name: 'duitnow-receipt.png', mimeType: 'image/png', buffer: png });
        await page.waitForTimeout(200);
        await shot(page, 'long');
      });

      test('sent', async ({ page }) => {
        await open(page, 'form');
        await page.getByLabel('Full name').fill('Tan Zugzwang');
        await page.getByRole('button', { name: /submit entry/i }).click();
        await page.waitForTimeout(300);
        await settle(page);
        await shot(page, 'sent');
      });

      test('organizer preview', async ({ page }) => {
        await signIn(page);
        await seedDesk(page);
        await page.goto(`/tournaments/${TOURNAMENT_ID}`);
        await page.getByRole('tab', { name: /registrations/i }).click();
        await page.getByRole('button', { name: 'Preview' }).first().click();
        await page.locator('dialog[open]').waitFor();
        await settle(page);
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(DIR, `${SHOTS}-preview-${width}.png`) });
      });
    });
  }
} else {
  const review = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Check and send' }) });

  test('the header card says what, when, where, how much and how long is left', async ({ page }) => {
    await open(page, 'form');
    const header = page.locator('.rg-event');
    await expect(header.getByRole('heading', { level: 1 })).toHaveText('Imaginary Bay Junior Rapid');
    await expect(header).toContainText('Pretend Heights Chess Academy');
    await expect(header).toContainText('Sat, 22 Aug 2026');
    await expect(header).toContainText('Entry RM 50');
    await expect(header).toContainText('20 confirmed · 120 places');
    await expect(header).toContainText('Closes 15 Aug, 23:59 · 32 days left');
    await expect(header.locator('.rg-urgent')).toHaveCount(0);
    await expect(header.getByRole('link', { name: /directions/i })).toHaveAttribute('href', /google\.com\/maps/);
  });

  test('an entry is checked, sent, and followed by what happens next', async ({ page }) => {
    const sent: Record<string, unknown>[] = [];
    await open(page, 'form', (body) => sent.push(body));

    // The name is required: the browser stops an empty entry before anything is sent.
    await page.getByRole('button', { name: 'Submit entry' }).click();
    expect(await page.getByLabel('Full name').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    expect(sent).toHaveLength(0);
    await expect(review(page)).toContainText('Name needed');

    await page.getByLabel('Full name').fill('Tan Zugzwang');
    await page.getByLabel('Email').fill('zugzwang@example.test');
    await page.getByLabel('U18').check();
    const receipt = { name: 'duitnow-receipt.png', mimeType: 'image/png', buffer: await somePng(page) };
    await page.getByLabel(/attach the payment receipt/i).setInputFiles(receipt);
    await expect(page.locator('.rg-file__thumb')).toBeVisible();
    await page.getByRole('button', { name: 'Remove duitnow-receipt.png' }).click();
    await expect(page.locator('.rg-file__thumb')).toHaveCount(0);
    await page.getByLabel(/attach the payment receipt/i).setInputFiles(receipt);
    await expect(review(page)).toContainText('RM 50 · receipt attached');
    await expect(review(page)).toContainText('U18');
    await expect(page.getByText('3 of 3 sections done')).toBeVisible();

    await page.getByRole('button', { name: 'Submit entry' }).click();
    await expect(page.getByRole('heading', { name: 'Entry sent for Tan Zugzwang' })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'Tan Zugzwang', guardianConsent: true, email: 'zugzwang@example.test' });
    expect(String(sent[0]!.receiptDataUrl)).toMatch(/^data:image\/png;base64,/);
    await expect(page.getByText('Waiting for approval')).toBeVisible();
    await expect(page.getByText('Receipt sent')).toBeVisible();

    // Another player from the same family keeps the contact details, never the name or the file.
    await page.getByRole('button', { name: 'Register another player' }).click();
    await expect(page.getByLabel('Full name')).toHaveValue('');
    await expect(page.getByLabel('Email')).toHaveValue('zugzwang@example.test');
    await expect(page.locator('.rg-file__thumb')).toHaveCount(0);
  });

  test('a long form: sections, an urgent deadline, and the NRIC masked in the review', async ({ page }) => {
    await open(page, 'long');
    await expect(page.locator('.rg-event .rg-urgent')).toContainText('2 days left');
    await expect(page.locator('.rg-event')).toContainText('8 confirmed · 64 places');
    const headings = await page.locator('form .rg-section h2').allTextContents();
    expect(headings).toEqual(['Player', 'Contact', 'Event questions', 'Documents', 'Payment', 'Check and send']);
    await expect(page.getByRole('navigation', { name: 'Form sections' }).getByRole('button')).toHaveCount(6);
    await expect(page.locator('.rg-pay__qr')).toBeVisible();

    await page.getByLabel('NRIC number').fill('140305145678');
    await expect(review(page)).toContainText('******-**-5678');
    await expect(review(page)).not.toContainText('140305');
    await expect(review(page)).toContainText('0 of 2 attached');
    await expect(page.locator('input[type="file"][required]')).toHaveCount(1);
  });

  test('closed: no form, a way to the live page and to other events', async ({ page }) => {
    await open(page, 'closed');
    await expect(page.getByRole('heading', { name: 'Registration is closed' })).toBeVisible();
    await expect(page.locator('.rg-event')).toContainText('Registration closed');
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Find another event' })).toBeVisible();
  });

  test('full: the entry joins the waitlist, and says so', async ({ page }) => {
    await open(page, 'full');
    await expect(page.getByText('All 120 places are taken. New entries join the waitlist.')).toBeVisible();
    await expect(page.locator('.rg-event')).toContainText('Full · waitlist open');
    await page.getByLabel('Full name').fill('Tan Zugzwang');
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(page.getByText('On the waitlist')).toBeVisible();
  });

  test('demo: marked as fictional, with the notice unchanged', async ({ page }) => {
    await open(page, 'demo');
    await expect(page.getByRole('note')).toHaveText(
      'This is a demo event. It is fictional: please don’t attend or pay. Entries are only saved from a demo player account.',
    );
    await expect(page.locator('.rg-event .rg-pill--demo')).toHaveText('Demo');
    await expect(page.locator('.rg-event')).toContainText('Free');
    await expect(page.getByRole('heading', { name: 'Payment' })).toHaveCount(0);
  });

  for (const [width, height] of [
    [360, 780],
    [390, 844],
    [768, 1024],
    [1366, 768],
  ] as const) {
    test(`no sideways scroll and 44 px targets at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, 'long');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(
          'main button, main a.ui-btn, main .rg-fact__link, main select, main input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), main .rg-choice, main .rg-checkcard, main .rg-drop, main summary',
        )]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ what: el.textContent?.trim().slice(0, 30) || el.tagName, h: el.getBoundingClientRect().height }))
          .filter((t) => t.h < 44),
      );
      expect(small).toEqual([]);
    });
  }

  test('the organizer previews the same page, at phone or computer width', async ({ page }) => {
    await signIn(page);
    await seedDesk(page);
    await page.goto(`/tournaments/${TOURNAMENT_ID}`);
    await page.getByRole('tab', { name: /registrations/i }).click();
    await page.getByRole('button', { name: 'Preview' }).first().click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByRole('heading', { name: 'Preview: what players see' })).toBeVisible();
    await expect(dialog.locator('.rg-frame .rg-event h1')).toBeVisible();
    await expect(dialog.locator('form .rg-section h2')).toHaveText(['Player', 'Contact', 'Check and send']);
    await expect(dialog).toContainText('Preview only. Nothing here is sent.');
    // Outside the desk's own styles, so nothing of the desk leaks into what players see.
    expect(await dialog.evaluate((el) => el.closest('.rf') === null)).toBe(true);
    await dialog.getByRole('button', { name: 'Phone' }).click();
    const frame = await dialog.locator('.rg-frame').boundingBox();
    expect(frame!.width).toBeLessThanOrEqual(392);
    await dialog.getByRole('button', { name: 'Submit entry' }).click();
    await dialog.getByLabel('Full name').fill('Tan Zugzwang');
    await dialog.getByRole('button', { name: 'Submit entry' }).click();
    await expect(dialog.getByText('Preview only. This entry was not sent.')).toBeVisible();
  });
}
