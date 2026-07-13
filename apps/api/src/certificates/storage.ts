import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../../data/certificates');
const BUCKET = 'certificates';

export function certificatesRoot(): string {
  return process.env['CERTIFICATES_DIR'] ?? DEFAULT_ROOT;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env['SUPABASE_URL'];
  // Prefer new "secret" key; fall back to legacy service_role JWT
  const key =
    process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseStorageConfigured(): boolean {
  return Boolean(
    process.env['SUPABASE_URL'] &&
      (process.env['SUPABASE_SECRET_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY']),
  );
}

async function ensureCertificatesDir(): Promise<string> {
  const root = certificatesRoot();
  await mkdir(root, { recursive: true });
  return root;
}

async function saveLocal(
  tournamentId: string,
  issueId: string,
  pdf: Uint8Array,
): Promise<{ storagePath: string; contentSha256: string; byteSize: number; backend: 'local' }> {
  const root = await ensureCertificatesDir();
  const dir = path.join(root, tournamentId);
  await mkdir(dir, { recursive: true });
  const storagePath = `${tournamentId}/${issueId}.pdf`;
  await writeFile(path.join(root, storagePath), pdf);
  return {
    storagePath,
    contentSha256: sha256Hex(pdf),
    byteSize: pdf.byteLength,
    backend: 'local',
  };
}

async function saveSupabase(
  supabase: SupabaseClient,
  tournamentId: string,
  issueId: string,
  pdf: Uint8Array,
): Promise<{ storagePath: string; contentSha256: string; byteSize: number; backend: 'supabase' }> {
  const storagePath = `${tournamentId}/${issueId}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, pdf, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }
  return {
    storagePath,
    contentSha256: sha256Hex(pdf),
    byteSize: pdf.byteLength,
    backend: 'supabase',
  };
}

/** Prefer Supabase Storage when configured; otherwise local disk. */
export async function saveCertificatePdf(
  tournamentId: string,
  issueId: string,
  pdf: Uint8Array,
): Promise<{
  storagePath: string;
  contentSha256: string;
  byteSize: number;
  backend: 'supabase' | 'local';
}> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    return saveSupabase(supabase, tournamentId, issueId, pdf);
  }
  return saveLocal(tournamentId, issueId, pdf);
}

export async function readCertificatePdf(storagePath: string): Promise<Uint8Array | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (!error && data) {
      return new Uint8Array(await data.arrayBuffer());
    }
    // Fall through to local if cloud miss (legacy files)
  }

  const abs = path.join(certificatesRoot(), storagePath);
  try {
    await access(abs);
    const buf = await readFile(abs);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
