/** Display text for game results and scores. Pure functions; `Result` and `PairingTable` render them. */

/** `@chess-alokas/shared` GameResult, plus null for "nothing entered". */
export type ResultCode = '1-0' | '0-1' | '1/2-1/2' | '1-0F' | '0-1F' | '0-0' | 'bye' | 'pending' | (string & {});

const TEXT: Record<string, string> = {
  '1-0': '1 – 0',
  '0-1': '0 – 1',
  '1/2-1/2': '½ – ½',
  '1-0F': '1F – 0F',
  '0-1F': '0F – 1F',
  '0-0': '0F – 0F',
  bye: 'Bye',
};

const SPOKEN: Record<string, string> = {
  '1-0': 'White won',
  '0-1': 'Black won',
  '1/2-1/2': 'Draw',
  '1-0F': 'White wins by forfeit',
  '0-1F': 'Black wins by forfeit',
  '0-0': 'Both absent',
  bye: 'Bye',
};

/** Empty string means "no result yet". */
export function resultText(code: ResultCode | null | undefined): string {
  if (!code || code === 'pending') return '';
  return TEXT[code] ?? code;
}

export function resultSpoken(code: ResultCode | null | undefined): string {
  if (!code || code === 'pending') return 'No result yet';
  return SPOKEN[code] ?? code;
}

/** 1.5 becomes 1½, 0.5 becomes ½. Tables and standings all use this. */
export function formatPoints(points: number | null | undefined): string {
  if (points == null) return '';
  const whole = Math.floor(points);
  const half = points - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}
