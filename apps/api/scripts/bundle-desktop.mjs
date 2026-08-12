/**
 * Bundle the Fastify API into a single file for Electron extraResources.
 * Run from apps/api: pnpm run build:desktop
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const outDir = path.join(apiRoot, 'desktop-bundle');

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(apiRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(outDir, 'index.js'),
  packages: 'bundle',
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  alias: {
    '@sentry/node': path.join(__dirname, 'sentry-desktop-stub.js'),
  },
  external: [],
  sourcemap: false,
  logLevel: 'info',
});

fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: 'chess-alokas-api-bundle', type: 'module', main: 'index.js' }, null, 2),
);

console.log('Desktop API bundle written to', outDir);
