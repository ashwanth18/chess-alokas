import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { PairingInput, PairingOutput } from '../swiss.js';
import { BBP_VERSION, buildTrf, parseBbpPairOutput } from './trf.js';

const execFileAsync = promisify(execFile);

export class BbpPairingsError extends Error {
  constructor(
    message: string,
    public code?: number,
    public stderr?: string,
  ) {
    super(message);
    this.name = 'BbpPairingsError';
  }
}

const VENDOR_EXE = 'bbpPairings.exe';

function vendorSubdir(): string {
  if (process.platform === 'win32') return path.join('vendor', 'bbp-pairings', 'win-x64');
  return path.join('vendor', 'bbp-pairings', 'linux-x64');
}

function walkForVendor(start: string, maxUp = 8): string[] {
  const found: string[] = [];
  let dir = start;
  for (let i = 0; i < maxUp; i++) {
    found.push(path.join(dir, vendorSubdir(), VENDOR_EXE));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

export function resolveBbpBinary(): string | null {
  const candidates: string[] = [];
  const fromEnv = process.env['BBP_PAIRINGS_PATH'];
  if (fromEnv) candidates.push(fromEnv);

  const dir = process.env['BBP_PAIRINGS_DIR'];
  if (dir) {
    candidates.push(path.join(dir, 'bbpPairings.exe'));
    candidates.push(path.join(dir, 'bbpPairings'));
  }

  candidates.push(path.resolve(process.cwd(), vendorSubdir(), VENDOR_EXE));
  candidates.push(...walkForVendor(process.cwd()));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(...walkForVendor(here));
  } catch {
    /* ignore */
  }
  candidates.push('/app/vendor/bbp-pairings/linux-x64/bbpPairings.exe');
  const resources =
    typeof process === 'object' && process !== null && 'resourcesPath' in process
      ? String((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '')
      : '';
  if (resources) {
    candidates.push(path.join(resources, 'bbp-pairings', 'bbpPairings.exe'));
    candidates.push(path.join(resources, 'bbp-pairings', 'bbpPairings'));
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function bbpPairingsAvailable(): boolean {
  return resolveBbpBinary() != null;
}

export async function pairDutchWithBbp(input: PairingInput): Promise<PairingOutput> {
  const exe = resolveBbpBinary();
  if (!exe) {
    throw new BbpPairingsError(
      'FIDE Dutch requires bbpPairings v6. Run `pnpm fetch:bbp` or set BBP_PAIRINGS_PATH.',
    );
  }

  const trimmed: PairingInput = {
    ...input,
    pastGames: input.pastGames.filter((g) => g.round < input.round),
  };
  const { trf, idByPairing } = buildTrf(trimmed);
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alokas-bbp-'));
  const trfPath = path.join(tmp, 'round.trf');
  const outPath = path.join(tmp, 'pairs.txt');
  await fs.promises.writeFile(trfPath, trf, 'utf8');

  try {
    const { stdout, stderr } = await execFileAsync(exe, ['--dutch', trfPath, '-p', outPath], {
      timeout: 30_000,
      windowsHide: true,
    });
    void stdout;
    if (!fs.existsSync(outPath)) {
      throw new BbpPairingsError(
        `bbpPairings produced no pairing file. ${stderr || stdout || ''}`.trim(),
      );
    }
    const text = await fs.promises.readFile(outPath, 'utf8');
    return parseBbpPairOutput(text, idByPairing);
  } catch (err) {
    if (err instanceof BbpPairingsError) throw err;
    const e = err as { code?: number; stderr?: string; message?: string };
    throw new BbpPairingsError(
      e.stderr?.toString() || e.message || 'bbpPairings failed',
      typeof e.code === 'number' ? e.code : undefined,
      e.stderr?.toString(),
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export { BBP_VERSION };
