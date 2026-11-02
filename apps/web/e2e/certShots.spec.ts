import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, signIn, seedDesk, settle } from './fixtures/mockApi';
import { TOURNAMENT_ID, players } from './fixtures/data';
import { FIXTURE_EMAILS, installCertificatesApi, seedEmails, seededIssues, templatePdf } from './fixtures/certificatesApi';

/**
 * Writes the before-and-after pictures in docs/design/screenshots/certificates/. Not a check: nothing
 * is compared, and only `playwright.shots.config.ts` runs it. SHOT_PHASE names the files. The
 * "before" pictures were taken with the earlier version of this file, against the old page.
 */
const PHASE = process.env.SHOT_PHASE ?? 'after';
const DIR = join(import.meta.dirname, '..', '..', '..', 'docs', 'design', 'screenshots', 'certificates');
mkdirSync(DIR, { recursive: true });

const WIDTHS = [
  [390, 844],
  [1366, 768],
] as const;

const shot = async (page: Page, name: string, width: number, fullPage = true) => {
  await settle(page);
  await page.screenshot({ path: join(DIR, `${PHASE}-${name}-${width}.png`), fullPage });
};

async function open(page: Page, width: number, height: number, path: string) {
  await page.setViewportSize({ width, height });
  await signIn(page);
  await seedDesk(page);
  await seedEmails(page);
  await page.goto(path);
  await page.locator('.cw h2').first().waitFor();
}

for (const [width, height] of WIDTHS) {
  test(`empty at ${width}`, async ({ page }) => {
    await installCertificatesApi(page);
    await open(page, width, height, '/certificates');
    await shot(page, 'empty', width);
  });

  test(`every step at ${width}`, async ({ page }) => {
    await installCertificatesApi(page, { issues: seededIssues(), bounce: new Set([FIXTURE_EMAILS[players[10]!.id]!]) });
    await open(page, width, height, `/certificates?tournament=${TOURNAMENT_ID}`);
    await shot(page, 'template-upload', width);

    await page.getByLabel('Upload PDF').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: await templatePdf() });
    await page.getByRole('button', { name: 'Put Full name in the middle' }).click();
    await page.getByRole('radio', { name: /^Category/ }).click();
    await page.getByRole('button', { name: 'Small', exact: true }).click();
    const box = await page.locator('.cw-dz__page').boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.64);
    await shot(page, 'designer', width);

    await page.getByRole('button', { name: 'Next: Recipients' }).click();
    await shot(page, 'recipients', width);

    await page.getByRole('button', { name: 'Next: Preview and issue' }).click();
    await page.getByRole('button', { name: 'Show preview' }).click();
    await page.getByRole('img', { name: /^Certificate for / }).waitFor();
    await shot(page, 'preview', width);

    await page.getByRole('button', { name: 'Issue 20 certificates' }).click();
    await page.getByText(/^Issued 20 certificates/).waitFor();
    await shot(page, 'issued', width);

    await page.getByRole('button', { name: 'Next: email them' }).click();
    await page.getByRole('img', { name: /^Attached: / }).waitFor();
    await shot(page, 'email-review', width);

    for (const p of [players[1]!, players[8]!]) {
      await page.getByRole('checkbox', { name: new RegExp(`^Send to ${p.name.replace(/[()/]/g, '.')}`) }).uncheck();
    }
    await page.getByRole('button', { name: 'Send 15 emails' }).click();
    await page.getByRole('dialog').waitFor();
    await shot(page, 'email-confirm', width, false);

    await page.getByRole('dialog').getByRole('button', { name: 'Send 15 emails' }).click();
    await page.getByRole('heading', { name: 'Last send' }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'email-results', width);
  });
}
