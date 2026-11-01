import AxeBuilder from '@axe-core/playwright';
import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { EVENT_SLUG, LIVE_TOKEN, TABLE_SLUG, TOURNAMENT_ID } from './fixtures/data';

/** Old pages keep their look with the contrast failures fixed: axe's AA check on the real pages. */

const GUEST = ['/login', '/discover', `/register/${EVENT_SLUG}`, `/live/${LIVE_TOKEN}`, `/live/${LIVE_TOKEN}/tv`, `/t/${TABLE_SLUG}`];
const DESK = ['/app', `/tournaments/${TOURNAMENT_ID}`, '/player', '/settings'];

async function failures(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const data = (n.any[0]?.data ?? {}) as { contrastRatio?: number; fgColor?: string; bgColor?: string };
      return `${n.target.join(' ')} ${data.contrastRatio}:1 ${data.fgColor} on ${data.bgColor}`;
    }),
  );
}

for (const path of GUEST) {
  test(`AA contrast: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await settle(page);
    expect(await failures(page)).toEqual([]);
  });
}

for (const path of DESK) {
  test(`AA contrast: ${path}`, async ({ page }) => {
    await signIn(page);
    await seedDesk(page);
    await page.goto(path);
    await settle(page);
    expect(await failures(page)).toEqual([]);
  });
}
