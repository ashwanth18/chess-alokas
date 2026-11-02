import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { TOURNAMENT_ID } from './fixtures/data';
import { installCertificatesApi, seedEmails, seededIssues, templatePdf } from './fixtures/certificatesApi';

/**
 * Baselines for the Certificates page, run by every width project like visual.spec.ts. Kept in their
 * own file so the page's pictures change without touching the shared list.
 */

// Full pages in parity mode only: real baselines are committed, and viewport shots keep them small.
const FULL_PAGE = process.env.E2E_PARITY === '1';

test('desk certificates', async ({ page }) => {
  await signIn(page);
  await seedDesk(page);
  await page.goto(`/certificates?tournament=${TOURNAMENT_ID}`);
  await page.locator('.cw h2').first().waitFor();
  await settle(page);
  await expect(page).toHaveScreenshot('certificates.png', { fullPage: FULL_PAGE });
});

// The bulk email review, scrolled to the table: what an organizer checks before anything is sent.
test('desk certificates-review', async ({ page }) => {
  await installCertificatesApi(page, { issues: seededIssues() });
  await signIn(page);
  await seedDesk(page);
  await seedEmails(page);
  await page.goto(`/certificates?tournament=${TOURNAMENT_ID}`);
  await page.getByLabel('Upload PDF').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: await templatePdf() });
  await page.getByRole('button', { name: 'Put Full name in the middle' }).click();
  await page.getByRole('button', { name: 'Next: Recipients' }).click();
  await page.getByRole('button', { name: 'Next: Preview and issue' }).click();
  await page.getByRole('button', { name: 'Issue 20 certificates' }).click();
  await page.getByRole('button', { name: 'Next: email them' }).click();
  await page.getByRole('img', { name: /^Attached: / }).waitFor();
  await settle(page);
  await page.getByRole('heading', { name: 'Who gets it' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await expect(page).toHaveScreenshot('certificates-review.png', { fullPage: FULL_PAGE });
});
