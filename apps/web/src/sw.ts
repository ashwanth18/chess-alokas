/**
 * Service worker for the hosted web app (never the Electron build).
 *
 * Replaces the 2026-08 self-destroying worker, which dropped offline support to escape two failures:
 *  - a worker intercepted /api and broke Sync: classifyRequest passes /api and other origins through.
 *  - a cached shell hid deploys: navigations are network-first, so online users always get the
 *    current index.html. The cached copy is only used when the network fails.
 *
 * Only the static app shell is stored: index.html and hashed build files. No API response, token
 * or personal data ever enters a cache. A new version waits until the user accepts the reload
 * prompt (see pwaRegister.ts).
 */
import { classifyRequest } from './lib/swRouting';

type PrecacheEntry = { url: string; revision: string | null };

type SwScope = {
  __WB_MANIFEST: (PrecacheEntry | string)[];
  location: Location;
  // `self` is the worker scope at runtime; the app's DOM types can't describe it.
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, listener: (event: never) => void): void;
};
type WaitEvent = { waitUntil(p: Promise<unknown>): void };
type FetchEvt = { request: Request; respondWith(p: Promise<Response>): void };
type MessageEvt = { data?: { type?: string } };

const sw = self as unknown as SwScope;

// The build replaces the literal text `self.__WB_MANIFEST`, so it must stay written exactly so.
const manifest = (self as unknown as SwScope).__WB_MANIFEST.map((e) =>
  typeof e === 'string' ? { url: e, revision: null } : e,
);
// Caches are named after this build, so old and new versions never mix.
const version = manifest
  .map((e) => `${e.url}:${e.revision ?? ''}`)
  .join('|')
  .split('')
  .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
  .toString(36);
const SHELL_CACHE = `alokas-shell-${version}`;
const ASSET_CACHE = `alokas-assets-${version}`;
const NETWORK_TIMEOUT_MS = 4000;

function toUrl(url: string): string {
  return new URL(url, sw.location.origin).href;
}

sw.addEventListener('install', (event: WaitEvent) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      for (const entry of manifest) {
        // cache: 'reload' so a stale HTTP cache cannot be pinned as this version's shell.
        const res = await fetch(toUrl(entry.url), { cache: 'reload' });
        if (!res.ok) throw new Error(`precache failed: ${entry.url}`);
        await cache.put(toUrl(entry.url), res);
      }
    }),
  );
});

sw.addEventListener('activate', (event: WaitEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (event: MessageEvt) => {
  if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

async function cachedShell(): Promise<Response | undefined> {
  const shell = await caches.open(SHELL_CACHE);
  return (await shell.match(toUrl('/index.html'))) ?? undefined;
}

async function networkFirstNavigation(request: Request): Promise<Response> {
  const network = fetch(request);
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS),
  );
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner !== 'timeout' && winner.ok) return winner;
    const shell = await cachedShell();
    if (shell) return shell;
    return await network;
  } catch (err) {
    const shell = await cachedShell();
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirstAsset(request: Request): Promise<Response> {
  const hit = await caches.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  // A network-first page can be newer than this worker's precache; keep its hashed files too.
  if (res.ok) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request.url, res.clone());
  }
  return res;
}

sw.addEventListener('fetch', (event: FetchEvt) => {
  const { request } = event;
  const route = classifyRequest({
    url: request.url,
    origin: sw.location.origin,
    method: request.method,
    mode: request.mode,
    hasAuthHeader: request.headers.has('authorization'),
  });
  if (route === 'navigate') event.respondWith(networkFirstNavigation(request));
  else if (route === 'asset') event.respondWith(cacheFirstAsset(request));
});
