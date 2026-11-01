import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { EVENT_SLUG, LIVE_TOKEN, TABLE_SLUG, TOURNAMENT_ID } from './fixtures/data';

/** What must hold on every key route: the checks from the design audit, not pixels. */

const GUEST = ['/', '/login', '/discover', `/register/${EVENT_SLUG}`, `/live/${LIVE_TOKEN}`, `/live/${LIVE_TOKEN}/tv`, `/t/${TABLE_SLUG}`];
const DESK = ['/app', `/tournaments/${TOURNAMENT_ID}`, '/player', '/settings'];

/** Same-origin console noise from the fake backends, which answer 404 for anything unmocked. */
const isFixtureNoise = (text: string) => /status of 404|ERR_FAILED|WebSocket/.test(text);

async function check(page: import('@playwright/test').Page, width: number, mocks: { external: string[]; errors: string[] }) {
  await settle(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow, `sideways scroll at ${width}`).toBeLessThanOrEqual(0);
  expect(mocks.external, 'requests outside the app').toEqual([]);
  expect(mocks.errors.filter((e) => !isFixtureNoise(e))).toEqual([]);
}

for (const width of [360, 390, 1366, 1920]) {
  for (const path of GUEST) {
    test(`${width} guest ${path}`, async ({ page, mocks }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      await check(page, width, mocks);
    });
  }
  for (const path of DESK) {
    test(`${width} desk ${path}`, async ({ page, mocks }) => {
      await page.setViewportSize({ width, height: 844 });
      await signIn(page);
      await seedDesk(page);
      await page.goto(path);
      await check(page, width, mocks);
    });
  }
}
