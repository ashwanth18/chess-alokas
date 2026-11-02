import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { TOURNAMENT_ID, players } from './fixtures/data';
import { FIXTURE_EMAILS, installCertificatesApi, seedEmails, seededIssues, templatePdf } from './fixtures/certificatesApi';

/**
 * The certificates page end to end, against the fake certificate API: design, issue, review the bulk
 * email, untick two, send, read the results, retry the one that failed. Nothing leaves the browser.
 */

const NG_PAWN = players[10]!; // "Ng Pawn Mei": this address bounces on the first try
const UNTICK = [players[1]!, players[8]!]; // one of the two siblings, and Chong Rook Hao

async function openWithTemplate(page: Page) {
  await signIn(page);
  await seedDesk(page);
  await seedEmails(page);
  await page.goto(`/certificates?tournament=${TOURNAMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'Design the certificate' })).toBeVisible();
  await page.getByLabel('Upload PDF').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: await templatePdf() });
  await expect(page.getByText('certificate.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Put Full name in the middle' }).click();
  await expect(page.getByRole('heading', { name: 'On the certificate (1)' })).toBeVisible();
}

async function issueAll(page: Page) {
  await page.getByRole('button', { name: 'Next: Recipients' }).click();
  await expect(page.getByText('20 of 20 chosen').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next: Preview and issue' }).click();
  await page.getByRole('button', { name: 'Issue 20 certificates' }).click();
  await expect(page.getByText(/^Issued 20 certificates/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: email them' }).click();
  await expect(page.getByRole('heading', { name: 'Email certificates' })).toBeVisible();
}

/** Elements that stick out past the right edge, named so a failure says where to look. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth) return [];
    return [...document.querySelectorAll<HTMLElement>('.cw *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
  });
}

const sendBox = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^Send to ${name.replace(/[()/]/g, '.')}`) });

test('issue, review, untick two, send, see results, retry the failure', async ({ page, mocks }) => {
  const fake = await installCertificatesApi(page, {
    issues: seededIssues(),
    bounce: new Set([FIXTURE_EMAILS[NG_PAWN.id]!]),
  });
  await openWithTemplate(page);
  await issueAll(page);

  // 20 issued. Held back: one sent last week, one with no email, one typed wrong.
  const count = page.getByTestId('review-count');
  await expect(count).toContainText('17 of 20 will be sent');
  await expect(page.getByText('1 already sent. 1 with no email. 1 with an email that isn\'t valid. 2 share an address with someone else.')).toBeVisible();
  await expect(page.getByTestId('quota-line')).toHaveText('1,988 of 2,000 emails left today.');
  await expect(page.getByText('Shared with 1 other player')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: /Tan Zwischen Zug .*No email, can't send/ })).toBeDisabled();
  await expect(sendBox(page, players[2]!.name)).not.toBeChecked(); // already sent

  // The previews: the email for the first ticked player, and their attached certificate.
  await expect(page.getByLabel('Email preview')).toContainText('Imaginary Bay Junior Rapid');
  await expect(page.getByRole('img', { name: /^Attached: / })).toBeVisible();

  for (const p of UNTICK) await sendBox(page, p.name).uncheck();
  await expect(count).toContainText('15 of 20 will be sent');

  await page.getByRole('button', { name: 'Send 15 emails' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send 15 emails now?' });
  await expect(dialog).toContainText('This uses 15 of the 1,988 emails left today.');
  // A double click on the final button must still send each certificate once.
  await dialog.getByRole('button', { name: 'Send 15 emails' }).dblclick();

  await expect(page.getByRole('heading', { name: 'Last send' })).toBeVisible();
  await expect(page.getByText('14 emails sent. 1 failed.')).toBeVisible();

  // Exactly the ticked ones reached the server, in two batches.
  const sentIds = fake.sends.flatMap((s) => s.issueIds);
  const sentNames = sentIds.map((id) => fake.issues.find((i) => i.id === id)!.recipientName).sort();
  const expected = players
    .filter((_, i) => ![2, 3, 5].includes(i))
    .filter((p) => !UNTICK.includes(p))
    .map((p) => p.name)
    .sort();
  expect(sentNames).toEqual(expected);
  expect(new Set(sentIds).size).toBe(15);
  expect(fake.sends.map((s) => s.issueIds.length)).toEqual([10, 5]);
  expect(fake.sends.every((s) => !s.resend)).toBe(true);

  // Per-recipient results, with the reason for the failure.
  const failedRow = page.locator('.cw-table--results tr[data-outcome="failed"]');
  await expect(failedRow).toHaveCount(1);
  await expect(failedRow).toContainText('The recipient address bounced');

  // The review now knows who was sent: those 14 start unticked, the failed one ticked.
  await expect(count).toContainText('1 of 20 will be sent');

  fake.bounce.clear();
  await page.getByRole('button', { name: 'Retry 1 failed email' }).click();
  const retry = page.getByRole('dialog', { name: 'Send 1 email now?' });
  await retry.getByRole('button', { name: 'Send 1 email' }).click();
  await expect(page.getByText('1 email sent.', { exact: true })).toBeVisible();
  expect(fake.sends.at(-1)!.issueIds).toHaveLength(1);
  expect(fake.issues.find((i) => i.id === fake.sends.at(-1)!.issueIds[0])!.recipientName).toBe(NG_PAWN.name);
  await expect(count).toContainText('0 of 20 will be sent');
  await expect(page.getByText('Tick at least one player to send.')).toBeVisible();

  expect(mocks.external).toEqual([]);
});

test('"Use new address" re-issues one certificate to the address on file now', async ({ page }) => {
  const sibling = players[1]!;
  const fake = await installCertificatesApi(page, {
    issues: [
      ...seededIssues(),
      {
        id: 'ffffffff-0000-4000-8000-000000000001',
        tournamentId: TOURNAMENT_ID,
        participantId: sibling.id,
        categoryId: null,
        recipientName: sibling.name,
        recipientEmail: 'old.parent@example.invalid',
        type: 'participation',
        status: 'stored',
        serial: 'CERT/003/2026',
        error: null,
        emailedAt: null,
        createdAt: '2026-07-07T02:00:00.000Z',
      },
    ],
  });
  await openWithTemplate(page);
  await page.getByRole('navigation', { name: 'Certificate steps' }).getByRole('button', { name: /Email/ }).click();
  await expect(page.getByText('Address on file now: parent.alekhine@example.invalid')).toBeVisible();
  await page.getByRole('button', { name: /^Use new address for PUTERI ALEKHINE DAMIA BINTI QUEEN INDIAN/ }).click();
  await expect(page.getByRole('button', { name: /^Use new address for/ })).toHaveCount(0);
  const mine = fake.issues.filter((i) => i.participantId === sibling.id);
  expect(mine).toHaveLength(2);
  expect(mine.at(-1)).toMatchObject({ recipientEmail: FIXTURE_EMAILS[sibling.id], status: 'stored' });
  expect(mine.at(-1)!.serial).not.toBe('CERT/003/2026');
});

test('send stays off, with the reason, when the day\'s limit is too small', async ({ page }) => {
  await installCertificatesApi(page, { issues: seededIssues(), quota: { limit: 2000, used: 1990 } });
  await openWithTemplate(page);
  await issueAll(page);
  await expect(page.getByText('Only 10 emails are left today. Untick 7, or send the rest tomorrow.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send 17 emails' })).toBeDisabled();
});

for (const width of [390, 1366]) {
  test(`review screen at ${width}: no sideways scroll, and axe finds nothing`, async ({ page, mocks }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
    await installCertificatesApi(page, { issues: seededIssues() });
    await openWithTemplate(page);
    await issueAll(page);
    await settle(page);
    expect(await overflowing(page), `sideways scroll at ${width}`).toEqual([]);
    const results = await new AxeBuilder({ page }).include('.cw').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(mocks.errors.filter((e) => !/status of 404|ERR_FAILED|WebSocket/.test(e))).toEqual([]);
  });

  test(`designer at ${width}: no sideways scroll, and axe finds nothing`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
    await installCertificatesApi(page);
    await openWithTemplate(page);
    await settle(page);
    expect(await overflowing(page), `sideways scroll at ${width}`).toEqual([]);
    const results = await new AxeBuilder({ page }).include('.cw').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
