/**
 * Bundle pairing-engine bbp spawn helper for Electron main (Node, not the renderer).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const entry = path.join(repoRoot, 'packages/pairing-engine/src/dutch/bbp.ts');
const outfile = path.join(desktopRoot, 'out/bbpEngine.js');

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    const fallbacks = [
      path.join(repoRoot, 'apps/api/node_modules/esbuild/lib/main.js'),
      path.join(repoRoot, 'node_modules/esbuild/lib/main.js'),
    ];
    for (const candidate of fallbacks) {
      try {
        return await import(pathToFileURL(candidate).href);
      } catch {
        /* try next */
      }
    }
    throw new Error('esbuild not found; run pnpm install from the repo root');
  }
}

const esbuild = await loadEsbuild();
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile,
  logLevel: 'info',
});
console.log('Desktop bbp engine written to', outfile);
