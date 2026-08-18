import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PIN_LEN = 6;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type ArbiterSessionPayload = {
  tournamentId: string;
  tableId: string;
  tableNumber: number;
  pinRound: number;
  exp: number;
};

function sessionSecret(): string {
  return (
    process.env['ARBITER_SESSION_SECRET'] ||
    process.env['SUPABASE_SECRET_KEY'] ||
    process.env['DATABASE_URL'] ||
    'dev-arbiter-session-secret'
  );
}

export function generateArbiterPin(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(PIN_LEN, '0');
}

export function hashArbiterPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin.normalize(), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyArbiterPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1]!, 'base64');
    const expected = Buffer.from(parts[2]!, 'base64');
    const actual = scryptSync(pin.normalize(), salt, expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function signArbiterSession(payload: Omit<ArbiterSessionPayload, 'exp'>): string {
  const body: ArbiterSessionPayload = {
    ...payload,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const sig = createHmac('sha256', sessionSecret()).update(raw).digest();
  return `${b64url(raw)}.${b64url(sig)}`;
}

export function verifyArbiterSession(token: string | undefined | null): ArbiterSessionPayload | null {
  if (!token) return null;
  const [rawPart, sigPart] = token.split('.');
  if (!rawPart || !sigPart) return null;
  try {
    const raw = fromB64url(rawPart);
    const sig = fromB64url(sigPart);
    const expected = createHmac('sha256', sessionSecret()).update(raw).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const payload = JSON.parse(raw.toString('utf8')) as ArbiterSessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!payload.tournamentId || !payload.tableId || !payload.pinRound) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Unguessable public slug for a table station (~128 bits). */
export function generateTableSlug(): string {
  return randomBytes(16).toString('base64url');
}

/** Public live viewer token (same entropy as table slugs). */
export function generatePublicLiveToken(): string {
  return randomBytes(16).toString('base64url');
}
