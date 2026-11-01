import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getServiceSupabase } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'registration-receipts';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface DecodedReceipt {
  contentType: string;
  bytes: Uint8Array;
}

function hasExpectedSignature(contentType: string, b: Uint8Array): boolean {
  switch (contentType) {
    case 'image/png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/webp':
      return (
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      );
    case 'application/pdf':
      return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    default:
      return false;
  }
}

/**
 * Accepts only PNG, JPEG, WebP or PDF data URLs whose bytes match the claimed type.
 * Returns null otherwise, so HTML or SVG can never be stored and served back.
 */
export function decodeReceiptDataUrl(dataUrl: string): DecodedReceipt | null {
  const match = /^data:([a-z]+\/[a-z.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl.trim());
  if (!match) return null;
  const contentType = match[1]!.toLowerCase();
  if (!EXTENSIONS[contentType]) return null;
  const bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIPT_BYTES) return null;
  if (!hasExpectedSignature(contentType, bytes)) return null;
  return { contentType, bytes };
}

function receiptsRoot(): string {
  return process.env['RECEIPTS_DIR'] ?? path.resolve(__dirname, '../../data/receipts');
}

/** Private Supabase bucket when configured; local disk otherwise (dev, tests, memory mode). */
export async function saveReceipt(
  tournamentId: string,
  registrationId: string,
  receipt: DecodedReceipt,
): Promise<string> {
  const storagePath = `${tournamentId}/${registrationId}.${EXTENSIONS[receipt.contentType]}`;
  const supabase = getServiceSupabase();
  if (supabase) {
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, receipt.bytes, {
      contentType: receipt.contentType,
      upsert: true,
    });
    if (error) throw new Error(`Receipt upload failed: ${error.message}`);
    return storagePath;
  }
  const abs = path.join(receiptsRoot(), storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, receipt.bytes);
  return storagePath;
}

/** Throws if it may still exist, so the purge tries again. A file already gone is fine. */
export async function deleteReceipt(storagePath: string): Promise<void> {
  const supabase = getServiceSupabase();
  if (supabase) {
    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) throw new Error(`Receipt removal failed: ${error.message}`);
    return;
  }
  await rm(path.join(receiptsRoot(), storagePath), { force: true });
}

export async function readReceipt(storagePath: string): Promise<Uint8Array | null> {
  const supabase = getServiceSupabase();
  if (supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  try {
    return new Uint8Array(await readFile(path.join(receiptsRoot(), storagePath)));
  } catch {
    return null;
  }
}
