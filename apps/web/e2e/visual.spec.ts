import { test, expect, signIn, seedDesk, settle } from './fixtures/mockApi';
import { EVENT_SLUG, LIVE_TOKEN, TABLE_SLUG, TOURNAMENT_ID, players } from './fixtures/data';

// Full pages in parity mode only: real baselines are committed, and viewport shots keep them small.
const FULL_PAGE = process.env.E2E_PARITY === '1';

type Shot = { name: string; path: string; ready: string };

const GUEST: Shot[] = [
  { name: 'landing', path: '/', ready: '.lp' },
  { name: 'login', path: '/login', ready: 'form' },
  { name: 'discover', path: '/discover', ready: 'h1' },
  { name: 'register', path: `/register/${EVENT_SLUG}`, ready: 'form' },
  { name: 'live', path: `/live/${LIVE_TOKEN}`, ready: 'h1' },
  { name: 'live-player', path: `/live/${LIVE_TOKEN}/p/${players[0]!.id}`, ready: 'h1' },
  { name: 'hall', path: `/live/${LIVE_TOKEN}/tv`, ready: 'table' },
  { name: 'floor-pin', path: `/t/${TABLE_SLUG}`, ready: 'input' },
];

const DESK: Shot[] = [
  { name: 'desk-home', path: '/app', ready: 'main.page-content' },
  { name: 'desk-tournament', path: `/tournaments/${TOURNAMENT_ID}`, ready: 'main.page-content h1, main.page-content h2' },
  { name: 'player-portal', path: '/player', ready: 'main.page-content' },
  { name: 'settings', path: '/settings', ready: 'main.page-content' },
];

for (const shot of GUEST) {
  test(`guest ${shot.name}`, async ({ page }) => {
    await page.goto(shot.path);
    await page.locator(shot.ready).first().waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot(`${shot.name}.png`, { fullPage: FULL_PAGE });
  });
}

for (const shot of DESK) {
  test(`desk ${shot.name}`, async ({ page }) => {
    await signIn(page);
    await seedDesk(page);
    await page.goto(shot.path);
    await page.locator(shot.ready).first().waitFor();
    await settle(page);
    await expect(page).toHaveScreenshot(`${shot.name}.png`, { fullPage: FULL_PAGE });
  });
}
