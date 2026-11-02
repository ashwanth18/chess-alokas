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
import { emptyDashboard, type Persona } from './personas';

const API ='http://localhost:3999';
const SUPABASE = 'http://localhost:3998';
const AUTH_KEY = 'sb-localhost-auth-token';

/** The landing page reads the latest desktop release to link the installer. Nothing else may leave. */
export const ALLOWED_EXTERNAL = 'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';

export type Mocks = {
  /** Every request that left the app's own origin and wasn't one of the two fake backends. */
  external: string[];
  /** Every same-origin asset requested, for bundle assertions. */
  assets: string[];
  /** console.error text and uncaught page errors. */
  errors: string[];
};

export function json(body: unknown, status = 200, origin = 'http://localhost:4179') {
  return {
    status,
    contentType: 'application/json',
    headers: {
      // The analytics beacon sends credentials, which a wildcard origin would refuse.
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    },
    body: JSON.stringify(body),
  };
}

function apiResponse(url: string, method: string, persona: Persona | null, origin: string) {
  const reply = (body: unknown, status?: number) => json(body, status, origin);
  const path = new URL(url).pathname;
  if (path === '/health') return reply({ ok: true });
  if (path.startsWith('/public/analytics')) return reply({ ok: true });
  if (path === `/public/live/${LIVE_TOKEN}`) return reply(livePayload);
  if (path === '/public/events') return reply(publicEvents);
  if (path === `/public/events/${EVENT_SLUG}`) return reply(publicEventDetail);
  if (/^\/public\/tables\/[^/]+\/zone$/.test(path)) return reply(floorZone);
  if (/^\/public\/tables\/[^/]+$/.test(path)) return reply(floorView('needs_pin'));
  // With no persona the signed-in user is an organizer with no organization yet, so the desk stays put.
  if (path === '/organizations') return reply({ organizations: persona?.organizations ?? [] });
  if (path === '/player/profiles') return reply({ profiles: persona?.profiles ?? [] });
  if (path === '/me') {
    return reply({ id: USER_ID, email: fixtureUser.email, accountRole: persona ? persona.accountRole : 'organizer' });
  }
  if (path === '/player/dashboard' && persona) return reply(emptyDashboard(persona.profiles));
  if (persona) {
    const members = path.match(/^\/organizations\/([^/]+)\/members$/);
    if (members) {
      const org = persona.organizations.find((o) => (o as { id: string }).id === members[1]) as { memberRole: string };
      return reply({ members: [], yourRole: org?.memberRole });
    }
    if (/^\/organizations\/[^/]+\/invites$/.test(path)) return reply({ invites: [] });
    if (path === '/tournaments') return reply([]);
    if (path === '/sync/pull') return reply({ tournaments: [], categories: [], participants: [], games: [], serverTime: NOW });
    if (path === '/sync/push') return reply({ accepted: 0, rejected: [], serverTime: NOW });
  }
  return reply({ error: `not mocked: ${method} ${path}` }, 404);
}

const personas = new WeakMap<Page, Persona>();

/** Sets who the API says is signed in. Call before the page first loads. */
export function setPersona(page: Page, persona: Persona) {
  personas.set(page, persona);
}

async function installMocks(page: Page, mocks: Mocks) {
  page.on('console', (m) => {
    if (m.type() === 'error') mocks.errors.push(m.text());
  });
  page.on('pageerror', (e) => mocks.errors.push(String(e)));

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    // Answer whichever origin asked: the desktop build runs from file://, whose origin is "null".
    const origin = (await route.request().headerValue('origin')) ?? 'http://localhost:4179';
    if (url.startsWith(API)) {
      if (method === 'OPTIONS') return route.fulfill(json({}, 200, origin));
      return route.fulfill(apiResponse(url, method, personas.get(page) ?? null, origin));
    }
    if (url.startsWith(SUPABASE)) {
      if (method === 'OPTIONS') return route.fulfill(json({}, 200, origin));
      if (url.includes('/rest/v1/profiles')) {
        return route.fulfill(json({ display_name: 'Director Rook', is_platform_admin: false }, 200, origin));
      }
      return route.fulfill(json({}, 404, origin));
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
    if (url !== ALLOWED_EXTERNAL) mocks.external.push(url);
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
