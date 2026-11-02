import type { Page } from '@playwright/test';
import { test, expect, signIn, settle, setPersona } from './fixtures/mockApi';
import { buildDesktopWithFakeBackends, desktopUrl, installDesktopBridge } from './fixtures/desktopBuild';
import { PERSONAS, type Persona } from './fixtures/personas';

/**
 * The desktop renderer signed in, over file:// with the HashRouter: organizer tools only.
 * Not Electron itself, so the real title bar overlay and packaged app stay unchecked here.
 */
test.beforeAll(() => buildDesktopWithFakeBackends());

async function open(page: Page, persona: Persona, route: string) {
  setPersona(page, persona);
  await installDesktopBridge(page);
  await signIn(page);
  await page.goto(desktopUrl(route));
}

test.use({ viewport: { width: 1366, height: 768 } });

test('links to /player go to the desk, through the hash router', async ({ page }) => {
  await open(page, PERSONAS.both, '/player');
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.locator('main.page-content')).toBeVisible();
  await expect(page.locator('.player-portal-page')).toHaveCount(0);
});

test('following a /player link from inside the app also lands on the desk', async ({ page }) => {
  await open(page, PERSONAS.both, '/settings');
  await page.locator('main.page-content').waitFor();
  await page.evaluate(() => {
    window.location.hash = '#/player';
  });
  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.locator('.player-portal-page')).toHaveCount(0);
});

for (const [name, persona] of [
  ['someone with both', PERSONAS.both],
  ['a player', PERSONAS.player],
  ['an organizer', PERSONAS.organizer],
] as const) {
  test(`${name} opens on the desk and has no player area in the menu`, async ({ page }) => {
    await open(page, persona, '/');
    await expect(page).toHaveURL(/#\/app$/);
    await settle(page);
    await expect(page.locator('.workspace-switcher, .workspace-pill')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'My page' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Tournaments' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    expect(await page.locator('.am-panel .am-item').allInnerTexts()).toEqual(['Account', 'Settings', 'Sign out']);
    await expect(page.locator('body')).not.toContainText('Player Portal');
    await expect(page.locator('body')).not.toContainText('Organizer Desk');
  });
}

test('a remembered player view from the web changes nothing on desktop', async ({ page }) => {
  await page.addInitScript((userId) => {
    window.localStorage.setItem(`alokas:view:${userId}`, 'player');
  }, '22222222-2222-4222-8222-222222222222');
  await open(page, PERSONAS.both, '/');
  await expect(page).toHaveURL(/#\/app$/);
});

test('an arbiter-only member opens on Floor duty', async ({ page }) => {
  await open(page, PERSONAS.arbiter, '/');
  await expect(page).toHaveURL(/#\/team$/);
  await expect(page.getByRole('heading', { name: 'Floor duty' })).toBeVisible();
});

test('/discover keeps the desk in reach and offers no player page', async ({ page }) => {
  await open(page, PERSONAS.both, '/discover');
  await page.locator('h1').first().waitFor();
  await expect(page.getByRole('link', { name: 'My Player & Family Profiles' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  expect(await page.locator('.am-panel .am-item').allInnerTexts()).toEqual(['My desk', 'Account', 'Settings', 'Sign out']);
  await page.getByRole('link', { name: 'My desk' }).click();
  await expect(page).toHaveURL(/#\/app$/);
});

test('the bar is one row at 1366, keeps the drag region and clears the window controls', async ({ page }) => {
  await open(page, PERSONAS.both, '/app');
  await page.locator('.topbar').waitFor();
  await settle(page);
  const bar = await page.locator('.topbar').boundingBox();
  expect(bar!.height).toBeLessThanOrEqual(64);

  const region = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'));
  expect(await region('.topbar')).toBe('drag');
  expect(await region('.am-button')).toBe('no-drag');
  expect(await region('.brand')).toBe('no-drag');

  // Windows draws its controls over the last 140 px of the bar.
  const button = await page.getByRole('button', { name: 'Account menu' }).boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(1366 - 140);

  await page.getByRole('button', { name: 'Account menu' }).click();
  expect(await region('.am-panel')).toBe('no-drag');
  const panel = await page.locator('.am-panel').boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(1366 - 140);
});
