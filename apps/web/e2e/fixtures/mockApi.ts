import { test as base, expect, type Page } from '@playwright/test';
import {
  NOW,
  USER_ID,
  LIVE_TOKEN,
  EVENT_SLUG,
  dexieSeed,
  fixtureUser,
  floorView,
  floorZone,
  livePayload,
  publicEventDetail,
  publicEvents,
} from './data';

const API = 'http://localhost:3999';
const SUPABASE = 'http://localhost:3998';
const AUTH_KEY = 'sb-localhost-auth-token';

export type Mocks = {
  /** Every request that left the app's own origin and wasn't one of the two fake backends. */
  external: string[];
  /** Every same-origin asset requested, for bundle assertions. */
  assets: string[];
  /** console.error text and uncaught page errors. */
  errors: string[];
};

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    },
    body: JSON.stringify(body),
  };
}

function apiResponse(url: string, method: string) {
  const path = new URL(url).pathname;
  if (path === '/health') return json({ ok: true });
  if (path.startsWith('/public/analytics')) return json({ ok: true });
  if (path === `/public/live/${LIVE_TOKEN}`) return json(livePayload);
  if (path === '/public/events') return json(publicEvents);
  if (path === `/public/events/${EVENT_SLUG}`) return json(publicEventDetail);
  if (/^\/public\/tables\/[^/]+\/zone$/.test(path)) return json(floorZone);
  if (/^\/public\/tables\/[^/]+$/.test(path)) return json(floorView('needs_pin'));
  if (path === '/organizations') return json({ organizations: [] });
  if (path === '/player/profiles') return json({ profiles: [] });
  if (path === '/me') return json({ id: USER_ID, email: fixtureUser.email });
  return json({ error: `not mocked: ${method} ${path}` }, 404);
}

async function installMocks(page: Page, mocks: Mocks) {
  page.on('console', (m) => {
    if (m.type() === 'error') mocks.errors.push(m.text());
  });
  page.on('pageerror', (e) => mocks.errors.push(String(e)));

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.startsWith(API)) {
      if (method === 'OPTIONS') return route.fulfill(json({}));
      return route.fulfill(apiResponse(url, method));
    }
    if (url.startsWith(SUPABASE)) {
      if (method === 'OPTIONS') return route.fulfill(json({}));
      if (url.includes('/rest/v1/profiles')) {
        return route.fulfill(json({ display_name: 'Director Rook', is_platform_admin: false }));
      }
      return route.fulfill(json({}, 404));
    }
    if (url.startsWith('http://localhost:')) {
      mocks.assets.push(new URL(url).pathname);
      return route.continue();
    }
    if (url.startsWith('file:')) {
      mocks.assets.push(url);
      return route.continue();
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    mocks.external.push(url);
    return route.abort();
  });
  await page.routeWebSocket(/.*/, () => {
    /* Realtime: accepted and never answered. */
  });
  await page.clock.setFixedTime(new Date(NOW));

  if (process.env.E2E_PARITY === '1') {
    // documentElement can still be null when init scripts run, so wait for the parser.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '*,*::before,*::after{font-family:Arial,sans-serif!important}';
        document.head.appendChild(s);
      });
    });
  }
}

/** Puts a saved sign-in in localStorage, so supabase-js finds a valid session without any network. */
export async function signIn(page: Page) {
  const expiresAt = Math.floor(new Date(NOW).getTime() / 1000) + 3600 * 24 * 365;
  const session = {
    access_token: 'header.e2e-not-a-real-token.signature',
    refresh_token: 'e2e-not-a-real-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: fixtureUser,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key!, value!);
    },
    [AUTH_KEY, JSON.stringify(session)],
  );
}

/**
 * Seeds the local database through plain IndexedDB, so the test never reaches into app modules.
 * The app must have created the stores first, so this loads the desk and writes; navigate afterwards.
 */
export async function seedDesk(page: Page) {
  await page.goto('/app');
  await expect(page.locator('main.page-content')).toBeVisible();
  await page.evaluate(async (seed) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('chess-alokas');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Object.keys(seed);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) {
        for (const row of (seed as Record<string, unknown[]>)[name]!) tx.objectStore(name).put(row);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, dexieSeed());
}

/** Waits for fonts and network quiet, so a screenshot never catches a half-loaded page. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export const test = base.extend<{ mocks: Mocks }>({
  mocks: [
    async ({ page }, use) => {
      const mocks: Mocks = { external: [], assets: [], errors: [] };
      await installMocks(page, mocks);
      await use(mocks);
    },
    { auto: true },
  ],
});

export { expect };
