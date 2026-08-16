import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, net, protocol } from 'electron';
import log from 'electron-log/main';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Privileged scheme so IndexedDB has a stable origin (not file://).
 * Do not use `app://` — Windows 11 treats that as an “app link” and opens the Store. */
export const APP_SCHEME = 'chess-alokas';
export const APP_HOST = 'desktop';
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '../../web/dist');
}

function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

let registered = false;

export function registerAppProtocol(): void {
  if (registered) return;
  registered = true;

  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname || '/');
      if (rel === '/' || rel === '') rel = '/index.html';
      rel = rel.replace(/^[/\\]+/, '');
      const root = webRoot();
      let filePath = path.normalize(path.join(root, rel));
      if (!isInsideRoot(root, filePath)) {
        return new Response('Not found', { status: 404 });
      }
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href);
    } catch (err) {
      log.error('chess-alokas:// protocol failed', err);
      return new Response('Not found', { status: 404 });
    }
  });
}
