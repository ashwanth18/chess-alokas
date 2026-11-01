import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, signIn, seedDesk, settle, type Mocks } from './fixtures/mockApi';
import { EVENT_SLUG, LIVE_TOKEN, players, TABLE_SLUG, TOURNAMENT_ID } from './fixtures/data';

/**
 * Parent routes must never download the organizer's heavy code. Chunks get hashed names and rollup
 * can merge a module into any chunk, so asserting on filenames alone would pass by accident. Instead
 * this finds which built chunks really contain each library, by a string only that library has.
 */
const DIST = join(import.meta.dirname, '..', 'dist-e2e', 'assets');

const FINGERPRINTS: Record<string, RegExp> = {
  dexie: /Dexie\.semVer|__dbnames|dexie-observable/i,
  'pdf-lib': /PDFDocument|PDFName/,
  pdfjs: /pdfjsLib|GlobalWorkerOptions/,
  xlsx: /SheetJS|sheet_to_json/,
};

function forbiddenChunks(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(DIST)) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    if (name.startsWith('pdf.worker')) {
      out.set(name, 'pdfjs');
      continue;
    }
    const text = readFileSync(join(DIST, name), 'utf8');
    for (const [lib, re] of Object.entries(FINGERPRINTS)) {
      if (re.test(text)) {
        out.set(name, lib);
        break;
      }
    }
  }
  return out;
}

function assertClean(mocks: Mocks) {
  const forbidden = forbiddenChunks();
  const hits = mocks.assets
    .map((p) => p.split('/').pop()!)
    .filter((name) => forbidden.has(name))
    .map((name) => `${name} (${forbidden.get(name)})`);
  expect(hits).toEqual([]);
}

test('the fingerprints find the libraries, so a clean result means something', () => {
  const libs = new Set(forbiddenChunks().values());
  for (const lib of ['dexie', 'pdf-lib', 'pdfjs', 'xlsx']) expect(libs).toContain(lib);
});

const PARENT_ROUTES = [
  ['/', '.lp'],
  ['/login', 'form'],
  ['/discover', 'h1'],
  [`/register/${EVENT_SLUG}`, 'form'],
  [`/live/${LIVE_TOKEN}`, 'h1'],
  [`/live/${LIVE_TOKEN}/p/${players[0]!.id}`, 'h1'],
  [`/live/${LIVE_TOKEN}/tv`, 'table'],
  [`/t/${TABLE_SLUG}`, 'input'],
  ['/mobile-app', '.ma'],
  ['/privacy', 'h1'],
  ['/terms', 'h1'],
] as const;

for (const [path, ready] of PARENT_ROUTES) {
  test(`guest on ${path} loads no Dexie, pdf or xlsx, and opens no local database`, async ({ page, mocks }) => {
    await page.goto(path);
    await page.locator(ready).first().waitFor();
    await settle(page);
    assertClean(mocks);
    expect(mocks.external).toEqual([]);
    const dbs = await page.evaluate(() => indexedDB.databases());
    expect(dbs.map((d) => d.name)).not.toContain('chess-alokas');
  });
}

test('signed-in parent on /player loads no Dexie, and sees no sync controls', async ({ page, mocks }) => {
  await signIn(page);
  await page.goto('/player');
  await expect(page.locator('main.page-content')).toBeVisible();
  await settle(page);
  assertClean(mocks);
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toHaveCount(0);
  await expect(page.locator('.status-label')).toHaveCount(0);
  const dbs = await page.evaluate(() => indexedDB.databases());
  expect(dbs.map((d) => d.name)).not.toContain('chess-alokas');
});

test('the desk still opens the same database and finds existing data', async ({ page }) => {
  await signIn(page);
  await seedDesk(page);
  await page.goto('/app');
  await expect(page.getByText('Imaginary Bay Junior Rapid').first()).toBeVisible();
  await page.goto(`/tournaments/${TOURNAMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'Imaginary Bay Junior Rapid' })).toBeVisible();
  const db = await page.evaluate(async () => {
    const list = await indexedDB.databases();
    return list.find((d) => d.name === 'chess-alokas');
  });
  // Dexie stores version 9 as 90. A schema bump here would strand existing users' data.
  expect(db?.version).toBe(90);
  const meta = await page.evaluate(async () => {
    const open = indexedDB.open('chess-alokas');
    const idb = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const row = await new Promise<{ value?: string } | undefined>((res, rej) => {
      const get = idb.transaction('meta').objectStore('meta').get('ownerId');
      get.onsuccess = () => res(get.result as { value?: string } | undefined);
      get.onerror = () => rej(get.error);
    });
    idb.close();
    return row?.value;
  });
  // AuthContext now hands this to OrganizerShell instead of writing it itself.
  expect(meta).toBe('22222222-2222-4222-8222-222222222222');
});

test('a guest on an organizer route goes to sign-in', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('a signed-out visit to /team keeps where it was going through sign-in', async ({ page }) => {
  await page.goto('/team');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fteam$/);
  await page.locator('form').first().waitFor();
});

test('moving from the desk to a parent page and back keeps working', async ({ page }) => {
  await signIn(page);
  await seedDesk(page);
  await page.goto('/app');
  await page.locator('.workspace-switcher a', { hasText: 'Player Portal' }).click();
  await expect(page).toHaveURL(/\/player$/);
  await expect(page.locator('.status-label')).toHaveCount(0);
  await page.locator('.workspace-switcher a', { hasText: 'Organizer Desk' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.status-label')).toBeVisible();
  await expect(page.getByText('Imaginary Bay Junior Rapid').first()).toBeVisible();
});

test('every URL still has its route', async ({ page }) => {
  await signIn(page);
  for (const path of ['/tournaments/new', '/certificates', '/simulator', '/account', '/settings', '/backups', '/team']) {
    await page.goto(path);
    await expect(page.locator('main.page-content')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  }
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
