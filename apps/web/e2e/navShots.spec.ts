import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, signIn, seedDesk, settle, setPersona } from './fixtures/mockApi';
import { buildDesktopWithFakeBackends, desktopUrl, installDesktopBridge } from './fixtures/desktopBuild';
import { PERSONAS, type Persona } from './fixtures/personas';

/**
 * Writes the before-and-after pictures in docs/design/screenshots/navigation/. Not a check: nothing is
 * compared, and only `playwright.shots.config.ts` runs it. SHOT_PHASE names the files.
 */
const PHASE = process.env.SHOT_PHASE ?? 'after';
const DIR = join(import.meta.dirname, '..', '..', '..', 'docs', 'design', 'screenshots', 'navigation');
mkdirSync(DIR, { recursive: true });

const WIDTHS = [
  [390, 844],
  [1366, 768],
] as const;

async function openMenu(page: import('@playwright/test').Page, width: number) {
  const name = width <= 1100 ? 'Open menu' : 'Account menu';
  const button = page.getByRole('button', { name });
  if (await button.count()) await button.first().click();
}

const CASES: [string, Persona, string][] = [
  ['player', PERSONAS.player, '/'],
  ['organizer', PERSONAS.organizer, '/'],
  ['both', PERSONAS.both, '/'],
  ['arbiter', PERSONAS.arbiter, '/'],
];

for (const [width, height] of WIDTHS) {
  for (const [role, persona, path] of CASES) {
    test(`${role} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      setPersona(page, persona);
      await signIn(page);
      if (role !== 'player') await seedDesk(page);
      // Before this change every sign-in led to the desk, so a player's page needed its own URL.
      await page.goto(PHASE === 'before' && role === 'player' ? '/player' : path);
      await page.locator('main.page-content').first().waitFor();
      await settle(page);
      await page.screenshot({ path: join(DIR, `${PHASE}-${role}-${width}.png`) });
      await openMenu(page, width);
      await page.screenshot({ path: join(DIR, `${PHASE}-${role}-${width}-menu.png`) });
    });
  }

  test(`discover, signed in, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    setPersona(page, PERSONAS.both);
    await signIn(page);
    await page.goto('/discover');
    await page.locator('h1').first().waitFor();
    await settle(page);
    await page.screenshot({ path: join(DIR, `${PHASE}-discover-${width}.png`) });
  });

  test(`signup at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/signup?role=organizer');
    await page.locator('form').first().waitFor();
    await settle(page);
    await page.screenshot({ path: join(DIR, `${PHASE}-signup-${width}.png`) });
  });
}

test.describe('desktop build over file://', () => {
  test.beforeAll(() => buildDesktopWithFakeBackends());

  for (const [width, height] of WIDTHS) {
    test(`desktop at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      setPersona(page, PERSONAS.both);
      await installDesktopBridge(page);
      await signIn(page);
      await page.goto(desktopUrl('/app'));
      await page.locator('main.page-content').first().waitFor();
      await settle(page);
      await page.screenshot({ path: join(DIR, `${PHASE}-desktop-${width}.png`) });
      await openMenu(page, width);
      await page.screenshot({ path: join(DIR, `${PHASE}-desktop-${width}-menu.png`) });
    });
  }
});
