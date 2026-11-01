import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDesktopBbpBinary } from './bbpPath.js';
import { validateDutchInput, type ValidDutchInput } from './policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DesktopDutchOutput = {
  boards: Array<{ board: number; whiteId: string | null; blackId: string | null; isBye: boolean }>;
  byePlayerId: string | null;
};

export async function pairDutchFromMain(raw: unknown): Promise<DesktopDutchOutput> {
  const input = validateDutchInput(raw);
  if (process.platform === 'darwin') {
    throw new Error(
      'FIDE Dutch on macOS uses the cloud pairing service (no official bbpPairings Mac binary).',
    );
  }
  const exe = resolveDesktopBbpBinary();
  if (!exe) {
    throw new Error('FIDE Dutch engine (bbpPairings v6) is not installed in this app.');
  }
  process.env['BBP_PAIRINGS_PATH'] = exe;

  const bundled = path.join(__dirname, 'bbpEngine.js');
  const mod = (await import(pathToFileURL(bundled).href)) as {
    pairDutchWithBbp: (next: ValidDutchInput) => Promise<DesktopDutchOutput>;
  };
  return mod.pairDutchWithBbp(input);
}
