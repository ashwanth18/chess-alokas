const FLAG = 'alokas-sw-cleared';

/**
 * Unregister any controlling service worker and drop Cache Storage.
 * Does not touch IndexedDB or cookies (those hold local tournaments and the session).
 */
async function clearServiceWorkers(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  return regs.length > 0 || Boolean(navigator.serviceWorker.controller);
}

void (async () => {
  try {
    const hadSw = await clearServiceWorkers();
    if (hadSw && !sessionStorage.getItem(FLAG)) {
      sessionStorage.setItem(FLAG, '1');
      location.reload();
    }
  } catch {
    /* ignore */
  }
})();
