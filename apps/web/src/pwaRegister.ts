export {};

/** Registers the offline worker and offers a reload when a new version has been downloaded. */

const PROMPT_ID = 'alokas-update-prompt';
const UPDATE_CHECK_MS = 30 * 60 * 1000;

function showUpdatePrompt(waiting: ServiceWorker) {
  if (document.getElementById(PROMPT_ID)) return;
  const bar = document.createElement('div');
  bar.id = PROMPT_ID;
  bar.className = 'pwa-update-prompt';
  bar.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = 'A new version of Chess Alokas is ready.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn-sm btn-primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn btn-sm btn-ghost';
  later.textContent = 'Later';
  later.addEventListener('click', () => bar.remove());

  bar.append(text, reload, later);
  document.body.append(bar);
}

async function register() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (window.desktop?.isDesktop) return;

  const reg = await navigator.serviceWorker.register('/sw.js');
  if (reg.waiting && navigator.serviceWorker.controller) showUpdatePrompt(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // No controller means first install: nothing is running that needs replacing.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdatePrompt(installing);
      }
    });
  });

  const check = () => {
    if (navigator.onLine) void reg.update().catch(() => {});
  };
  window.setInterval(check, UPDATE_CHECK_MS);
  window.addEventListener('online', check);
}

void register().catch((err) => {
  console.warn('[pwa] service worker registration failed', err);
});
