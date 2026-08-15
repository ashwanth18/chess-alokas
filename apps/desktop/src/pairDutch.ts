import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDesktopBbpBinary } from './bbpPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DesktopDutchInput = {
  players: Array<{ id: string; name: string; rating?: number | null; seed?: number | null }>;
  pastGames: Array<{
    round: number;
    whiteId: string | null;
    blackId: string | null;
    result: string;
    isBye: boolean;
  }>;
  round: number;
  totalRounds?: number;
  initialColor?: 'W' | 'B';
};

export type DesktopDutchOutput = {
  boards: Array<{ board: number; whiteId: string | null; blackId: string | null; isBye: boolean }>;
  byePlayerId: string | null;
};

export async function pairDutchFromMain(input: DesktopDutchInput): Promise<DesktopDutchOutput> {
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
    pairDutchWithBbp: (next: DesktopDutchInput) => Promise<DesktopDutchOutput>;
  };
  return mod.pairDutchWithBbp(input);
}
