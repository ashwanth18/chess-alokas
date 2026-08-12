import { mkdtemp, unlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sax from 'sax';
import yauzl from 'yauzl';
import type { Sql } from 'postgres';
import type { FideImportStatus } from './types.js';

export const FIDE_XML_ZIP_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

type StagingRow = [
  number,
  string,
  string | null,
  number | null,
  string | null,
  string | null,
  number | null,
  number | null,
  number | null,
  boolean,
];

let importRunning = false;

function num(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  return Number(t);
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('Failed to open zip'));
      else resolve(zip);
    });
  });
}

function readZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('Failed to read zip entry'));
      else resolve(stream);
    });
  });
}

async function downloadZip(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FIDE download failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function flushStagingBatch(sql: Sql, rows: StagingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const objects = rows.map((row) => ({
    fide_id: row[0],
    name: row[1],
    federation: row[2],
    birth_year: row[3],
    title: row[4],
    sex: row[5],
    standard: row[6],
    rapid: row[7],
    blitz: row[8],
    inactive: row[9],
  }));
  await sql`
    INSERT INTO fide_players_staging ${sql(
      objects,
      'fide_id',
      'name',
      'federation',
      'birth_year',
      'title',
      'sex',
      'standard',
      'rapid',
      'blitz',
      'inactive',
    )}
    ON CONFLICT (fide_id) DO UPDATE SET
      name = EXCLUDED.name,
      federation = EXCLUDED.federation,
      birth_year = EXCLUDED.birth_year,
      title = EXCLUDED.title,
      sex = EXCLUDED.sex,
      standard = EXCLUDED.standard,
      rapid = EXCLUDED.rapid,
      blitz = EXCLUDED.blitz,
      inactive = EXCLUDED.inactive
  `;
}

async function parseXmlIntoStaging(
  xmlStream: Readable,
  sql: Sql,
  onBatch: (n: number) => void,
): Promise<number> {
  const parser = sax.createStream(true, { trim: true, normalize: true });
  let current: Record<string, string> | null = null;
  let currentTag = '';
  let batch: StagingRow[] = [];
  let total = 0;
  let flushing: Promise<void> = Promise.resolve();
  let failed: Error | null = null;

  const enqueueFlush = () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    xmlStream.pause();
    flushing = flushing
      .then(async () => {
        await flushStagingBatch(sql, rows);
        total += rows.length;
        onBatch(total);
        xmlStream.resume();
      })
      .catch((err: Error) => {
        failed = err;
        xmlStream.destroy(err);
      });
  };

  return new Promise((resolve, reject) => {
    parser.on('opentag', (node) => {
      if (node.name === 'player') {
        current = {};
      } else if (current) {
        currentTag = node.name;
      }
    });

    parser.on('text', (text) => {
      if (current && currentTag) {
        current[currentTag] = (current[currentTag] ?? '') + text;
      }
    });

    parser.on('closetag', (name) => {
      if (name === 'player' && current) {
        const fideId = num(current['fideid']);
        const playerName = (current['name'] ?? '').trim();
        if (fideId != null && playerName) {
          const flag = (current['flag'] ?? '').toLowerCase();
          batch.push([
            fideId,
            playerName,
            (current['country'] ?? '').trim() || null,
            num(current['birthday']),
            (current['title'] ?? '').trim() || null,
            (current['sex'] ?? '').trim() || null,
            num(current['rating']),
            num(current['rapid_rating']),
            num(current['blitz_rating']),
            flag.startsWith('i'),
          ]);
          if (batch.length >= 2000) enqueueFlush();
        }
        current = null;
      }
      currentTag = '';
    });

    parser.on('error', (err) => reject(err));
    parser.on('end', () => {
      enqueueFlush();
      flushing
        .then(() => {
          if (failed) reject(failed);
          else resolve(total);
        })
        .catch(reject);
    });

    xmlStream.on('error', reject);
    xmlStream.pipe(parser);
  });
}

async function setMeta(
  sql: Sql,
  patch: {
    status: FideImportStatus['status'];
    importedAt?: string | null;
    playerCount?: number;
    sourceUrl?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO fide_import_meta (id, status, imported_at, player_count, source_url, error, updated_at)
    VALUES (
      1,
      ${patch.status},
      ${patch.importedAt ?? null},
      ${patch.playerCount ?? 0},
      ${patch.sourceUrl ?? FIDE_XML_ZIP_URL},
      ${patch.error ?? null},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      imported_at = COALESCE(EXCLUDED.imported_at, fide_import_meta.imported_at),
      player_count = CASE
        WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.player_count
        ELSE fide_import_meta.player_count
      END,
      source_url = COALESCE(EXCLUDED.source_url, fide_import_meta.source_url),
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getFideImportStatus(sql: Sql): Promise<FideImportStatus> {
  const rows = await sql<
    {
      status: string;
      imported_at: Date | string | null;
      player_count: number;
      source_url: string | null;
      error: string | null;
      updated_at: Date | string | null;
    }[]
  >`SELECT status, imported_at, player_count, source_url, error, updated_at FROM fide_import_meta WHERE id = 1`;
  const row = rows[0];
  if (!row) {
    return {
      status: importRunning ? 'running' : 'idle',
      importedAt: null,
      playerCount: 0,
      sourceUrl: FIDE_XML_ZIP_URL,
      error: null,
      updatedAt: null,
    };
  }
  const status = (importRunning ? 'running' : row.status) as FideImportStatus['status'];
  return {
    status,
    importedAt: row.imported_at
      ? row.imported_at instanceof Date
        ? row.imported_at.toISOString()
        : String(row.imported_at)
      : null,
    playerCount: row.player_count ?? 0,
    sourceUrl: row.source_url,
    error: row.error,
    updatedAt: row.updated_at
      ? row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at)
      : null,
  };
}

export function isFideImportRunning(): boolean {
  return importRunning;
}

/**
 * Whether an automatic monthly refresh should download the FIDE zip.
 * - Empty catalog → always due
 * - Already running → not due
 * - Last successful import in current UTC calendar month → not due
 * - Before the 8th UTC (and catalog non-empty) → wait for typical FIDE publish window
 * - On/after the 8th and last import is a previous month → due
 */
export function isFideRefreshDue(
  status: Pick<FideImportStatus, 'status' | 'importedAt' | 'playerCount'>,
  now: Date = new Date(),
): boolean {
  // Only the in-process mutex blocks; DB "running" may be stale after a crash.
  if (importRunning) return false;
  if (status.status === 'running') return false;

  const importedAt = status.importedAt;
  const empty = !importedAt || (status.playerCount ?? 0) <= 0;
  if (empty) return true;

  const day = now.getUTCDate();
  if (day < 8) return false;

  const imported = new Date(importedAt);
  if (Number.isNaN(imported.getTime())) return true;

  const sameMonth =
    imported.getUTCFullYear() === now.getUTCFullYear() &&
    imported.getUTCMonth() === now.getUTCMonth();
  return !sameMonth;
}

/** Start import in background. Returns false if already running. */
export function startFideImport(sql: Sql): boolean {
  if (importRunning) return false;
  importRunning = true;
  void runFideImport(sql).finally(() => {
    importRunning = false;
  });
  return true;
}

/**
 * Clear a DB "running" flag left behind when the API process died mid-import.
 * Without this, auto-refresh and Admin both stay blocked forever.
 */
export async function clearStaleFideImportLock(sql: Sql): Promise<boolean> {
  if (importRunning) return false;
  const status = await getFideImportStatus(sql);
  if (status.status !== 'running') return false;
  await setMeta(sql, {
    status: 'failed',
    error: 'Previous import did not finish (API restart). Retry when due.',
    sourceUrl: FIDE_XML_ZIP_URL,
  });
  return true;
}

/**
 * If a monthly refresh is due, start it in the background.
 * Returns whether an import was started.
 */
export async function maybeStartFideImport(sql: Sql, now: Date = new Date()): Promise<boolean> {
  if (importRunning) return false;
  await clearStaleFideImportLock(sql);
  const status = await getFideImportStatus(sql);
  if (!isFideRefreshDue(status, now)) return false;
  return startFideImport(sql);
}

export async function runFideImport(sql: Sql): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'fide-'));
  const zipPath = join(dir, 'players_list_xml.zip');
  try {
    await setMeta(sql, { status: 'running', error: null, sourceUrl: FIDE_XML_ZIP_URL });
    await sql`TRUNCATE fide_players_staging`;
    await downloadZip(FIDE_XML_ZIP_URL, zipPath);

    const zip = await openZip(zipPath);
    const entry = await new Promise<yauzl.Entry>((resolve, reject) => {
      let found: yauzl.Entry | null = null;
      zip.on('entry', (e: yauzl.Entry) => {
        if (/\.xml$/i.test(e.fileName) && !found) {
          found = e;
          resolve(e);
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!found) reject(new Error('No XML file in FIDE zip'));
      });
      zip.on('error', reject);
      zip.readEntry();
    });

    const xmlStream = await readZipEntry(zip, entry);
    const count = await parseXmlIntoStaging(xmlStream, sql, () => {
      /* progress tracked in meta at end */
    });
    zip.close();

    if (count === 0) {
      throw new Error('FIDE XML contained no players');
    }

    await sql.begin(async (tx) => {
      await tx`TRUNCATE fide_players`;
      await tx`
        INSERT INTO fide_players
          (fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive)
        SELECT fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive
        FROM fide_players_staging
      `;
      await tx`TRUNCATE fide_players_staging`;
    });

    const now = new Date().toISOString();
    await setMeta(sql, {
      status: 'ok',
      importedAt: now,
      playerCount: count,
      sourceUrl: FIDE_XML_ZIP_URL,
      error: null,
    });
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FIDE import failed';
    await setMeta(sql, { status: 'failed', error: message, sourceUrl: FIDE_XML_ZIP_URL }).catch(
      () => undefined,
    );
    throw err;
  } finally {
    await unlink(zipPath).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Parse a local XML string/stream into row objects (for tests). */
export async function parseFideXmlPlayers(
  xml: string,
): Promise<
  Array<{
    fideId: number;
    name: string;
    federation: string | null;
    birthYear: number | null;
    title: string | null;
    sex: string | null;
    standard: number | null;
    rapid: number | null;
    blitz: number | null;
    inactive: boolean;
  }>
> {
  const parser = sax.parser(true, { trim: true, normalize: true });
  const out: Array<{
    fideId: number;
    name: string;
    federation: string | null;
    birthYear: number | null;
    title: string | null;
    sex: string | null;
    standard: number | null;
    rapid: number | null;
    blitz: number | null;
    inactive: boolean;
  }> = [];
  let current: Record<string, string> | null = null;
  let currentTag = '';

  return new Promise((resolve, reject) => {
    parser.onopentag = (node) => {
      if (node.name === 'player') current = {};
      else if (current) currentTag = node.name;
    };
    parser.ontext = (text) => {
      if (current && currentTag) {
        current[currentTag] = (current[currentTag] ?? '') + text;
      }
    };
    parser.onclosetag = (name) => {
      if (name === 'player' && current) {
        const fideId = num(current['fideid']);
        const playerName = (current['name'] ?? '').trim();
        if (fideId != null && playerName) {
          const flag = (current['flag'] ?? '').toLowerCase();
          out.push({
            fideId,
            name: playerName,
            federation: (current['country'] ?? '').trim() || null,
            birthYear: num(current['birthday']),
            title: (current['title'] ?? '').trim() || null,
            sex: (current['sex'] ?? '').trim() || null,
            standard: num(current['rating']),
            rapid: num(current['rapid_rating']),
            blitz: num(current['blitz_rating']),
            inactive: flag.startsWith('i'),
          });
        }
        current = null;
      }
      currentTag = '';
    };
    parser.onerror = (err) => reject(err);
    parser.onend = () => resolve(out);
    parser.write(xml).close();
  });
}
