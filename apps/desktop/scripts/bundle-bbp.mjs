/**
 * Post-tsc build steps for the Electron main process:
 *  - bundle the pairing-engine bbp spawn helper (Node, not the renderer)
 *  - bundle the preload as CommonJS, which sandboxed preloads require
 *  - write public client config (Sentry DSN, Supabase URL) for CSP and reporting
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const entry = path.join(repoRoot, 'packages/pairing-engine/src/dutch/bbp.ts');
const outDir = path.join(desktopRoot, 'out');
const outfile = path.join(outDir, 'bbpEngine.js');

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

await esbuild.build({
  entryPoints: [path.join(desktopRoot, 'src/preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  outfile: path.join(outDir, 'preload.cjs'),
  logLevel: 'info',
});
// tsc also emits an ESM preload; remove it so only the sandbox-safe one ships.
for (const stale of ['preload.js', 'preload.js.map']) {
  fs.rmSync(path.join(outDir, stale), { force: true });
}

/** Same precedence as Vite: non-empty process env first, then apps/web/.env.desktop. */
function publicEnv(key) {
  const fromEnv = (process.env[key] ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    const text = fs.readFileSync(path.join(repoRoot, 'apps/web/.env.desktop'), 'utf8');
    const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

fs.writeFileSync(
  path.join(outDir, 'build-config.json'),
  JSON.stringify(
    { sentryDsn: publicEnv('VITE_SENTRY_DSN'), supabaseUrl: publicEnv('VITE_SUPABASE_URL') },
    null,
    2,
  ),
);
