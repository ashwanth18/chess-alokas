import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveDesktopBbpBinary(): string | null {
  const fromEnv = process.env['BBP_PAIRINGS_PATH'];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const exeName = 'bbpPairings.exe';
  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bbp-pairings', exeName));
    candidates.push(path.join(process.resourcesPath, 'bbp-pairings', 'bbpPairings'));
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  if (process.platform === 'win32') {
    candidates.push(path.join(repoRoot, 'vendor', 'bbp-pairings', 'win-x64', exeName));
  } else if (process.platform === 'linux') {
    candidates.push(path.join(repoRoot, 'vendor', 'bbp-pairings', 'linux-x64', exeName));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
