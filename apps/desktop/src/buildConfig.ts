import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Public client values written at build time by scripts/bundle-bbp.mjs. */
export type BuildConfig = { sentryDsn?: string | null; supabaseUrl?: string | null };

let cached: BuildConfig | null = null;

export function readBuildConfig(): BuildConfig {
  if (cached) return cached;
  try {
    cached = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'build-config.json'), 'utf8'),
    ) as BuildConfig;
  } catch {
    cached = {};
  }
  return cached;
}
