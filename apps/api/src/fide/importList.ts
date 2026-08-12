import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { mkdtemp, unlink, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import sax from 'sax';
import yauzl from 'yauzl';
import type { Sql } from 'postgres';
import type { FideImportStatus } from './types.js';

export const FIDE_XML_ZIP_URL = 'https://ratings.fide.com/download/players_list_xml.zip';

/** Don't kill an import that updated progress recently (API redeploys). */
const STALE_RUNNING_MS = 15 * 60 * 1000;

let importRunning = false;

function num(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  return Number(t);
}

function csvCell(v: string | number | boolean | null): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (/[",\n\r]/.test(v) || v.includes('\\')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
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

/** Parse XML → local CSV (no DB round-trips). Returns row count. */
async function parseXmlToCsv(xmlStream: Readable, csvPath: string): Promise<number> {
  const out = createWriteStream(csvPath, { encoding: 'utf8' });
  const parser = sax.createStream(true, { trim: true, normalize: true });
  let current: Record<string, string> | null = null;
  let currentTag = '';
  let total = 0;
  let writeChain: Promise<void> = Promise.resolve();
  let failed: Error | null = null;

  const writeLine = (line: string) => {
    writeChain = writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!out.write(line)) {
            out.once('drain', () => resolve());
          } else {
            resolve();
          }
          out.once('error', reject);
        }),
    );
  };

  return new Promise((resolve, reject) => {
    parser.on('opentag', (node) => {
      if (node.name === 'player') current = {};
      else if (current) currentTag = node.name;
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
          const line =
            [
              csvCell(fideId),
              csvCell(playerName),
              csvCell((current['country'] ?? '').trim() || null),
              csvCell(num(current['birthday'])),
              csvCell((current['title'] ?? '').trim() || null),
              csvCell((current['sex'] ?? '').trim() || null),
              csvCell(num(current['rating'])),
              csvCell(num(current['rapid_rating'])),
              csvCell(num(current['blitz_rating'])),
              csvCell(flag.startsWith('i')),
            ].join(',') + '\n';
          writeLine(line);
          total += 1;
        }
        current = null;
      }
      currentTag = '';
    });

    parser.on('error', (err) => {
      failed = err;
      out.destroy(err);
      reject(err);
    });

    parser.on('end', () => {
      writeChain
        .then(() => {
          out.end();
          return finished(out);
        })
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

function parseCsvLine(line: string): {
  fide_id: number;
  name: string;
  federation: string | null;
  birth_year: number | null;
  title: string | null;
  sex: string | null;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  inactive: boolean;
} {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (let c = 0; c < line.length; c++) {
    const ch = line[c]!;
    if (inQ) {
      if (ch === '"' && line[c + 1] === '"') {
        cur += '"';
        c++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  const toInt = (s: string) => (s === '' ? null : Number(s));
  return {
    fide_id: Number(cols[0]),
    name: cols[1] ?? '',
    federation: cols[2] || null,
    birth_year: toInt(cols[3] ?? ''),
    title: cols[4] || null,
    sex: cols[5] || null,
    standard: toInt(cols[6] ?? ''),
    rapid: toInt(cols[7] ?? ''),
    blitz: toInt(cols[8] ?? ''),
    inactive: cols[9] === 'true',
  };
}

/** Bulk-load CSV into staging. Prefer COPY; fall back to streamed INSERT batches. */
async function loadCsvIntoStaging(sql: Sql, csvPath: string, rowCount: number): Promise<void> {
  await sql`TRUNCATE fide_players_staging`;

  try {
    const csv = await readFile(csvPath);
    const stream = await sql`
      COPY fide_players_staging
        (fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive)
      FROM STDIN WITH (FORMAT csv, NULL '')
    `.writable();
    stream.end(csv);
    await finished(stream);
    return;
  } catch (err) {
    // Transaction poolers often reject COPY — fall back to chunked INSERT.
    console.warn(
      '[fide] COPY unavailable, using batched INSERT:',
      err instanceof Error ? err.message : err,
    );
    // COPY may have left a partial load.
    await sql`TRUNCATE fide_players_staging`;
  }

  // Stream lines — full FIDE list is ~1.9M rows; avoid loading the whole CSV as one string.
  const BATCH = 5000;
  let batch: ReturnType<typeof parseCsvLine>[] = [];
  let loaded = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const objects = batch;
    batch = [];
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
    `;
    loaded += objects.length;
    if (loaded % (BATCH * 2) === 0 || loaded >= rowCount) {
      await setMeta(sql, {
        status: 'running',
        playerCount: loaded,
        sourceUrl: FIDE_XML_ZIP_URL,
        error: `Loading into database… ${loaded.toLocaleString()} / ${rowCount.toLocaleString()}`,
      }).catch(() => undefined);
    }
  };

  const rl = createInterface({ input: createReadStream(csvPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    batch.push(parseCsvLine(line));
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}

async function swapStagingToLive(sql: Sql): Promise<void> {
  // Rename swap is far faster than TRUNCATE + INSERT SELECT over the pooler.
  await sql.begin(async (tx) => {
    await tx`DROP TABLE IF EXISTS fide_players_old`;
    await tx`ALTER TABLE fide_players RENAME TO fide_players_old`;
    await tx`ALTER TABLE fide_players_staging RENAME TO fide_players`;
    await tx`
      CREATE TABLE fide_players_staging (
        fide_id integer primary key,
        name text not null,
        federation text,
        birth_year integer,
        title text,
        sex text,
        standard integer,
        rapid integer,
        blitz integer,
        inactive boolean not null default false
      )
    `;
    await tx`DROP TABLE fide_players_old`;
    await tx`CREATE INDEX IF NOT EXISTS idx_fide_players_name ON fide_players (name)`;
    await tx`CREATE INDEX IF NOT EXISTS idx_fide_players_fed_yob ON fide_players (federation, birth_year)`;
    await tx`
      CREATE INDEX IF NOT EXISTS idx_fide_players_name_trgm
      ON fide_players USING gin (lower(name) gin_trgm_ops)
    `;
    await tx`ALTER TABLE fide_players ENABLE ROW LEVEL SECURITY`;
    await tx`ALTER TABLE fide_players_staging ENABLE ROW LEVEL SECURITY`;
    await tx`REVOKE ALL ON TABLE fide_players FROM anon, authenticated`;
    await tx`REVOKE ALL ON TABLE fide_players_staging FROM anon, authenticated`;
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
        WHEN EXCLUDED.status = 'running' THEN EXCLUDED.player_count
        WHEN EXCLUDED.status = 'failed' THEN fide_import_meta.player_count
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
 * Only if progress is stale — recent updates mean an import may still be alive.
 */
export async function clearStaleFideImportLock(sql: Sql): Promise<boolean> {
  if (importRunning) return false;
  const status = await getFideImportStatus(sql);
  if (status.status !== 'running') return false;

  const updatedMs = status.updatedAt ? new Date(status.updatedAt).getTime() : 0;
  if (Number.isFinite(updatedMs) && Date.now() - updatedMs < STALE_RUNNING_MS) {
    return false;
  }

  const live = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fide_players`;
  const liveCount = live[0]?.n ?? 0;
  if (liveCount > 0) {
    // Keep usable catalog; mark failed so auto won't loop on "running".
    await setMeta(sql, {
      status: 'ok',
      importedAt: status.importedAt ?? new Date().toISOString(),
      playerCount: liveCount,
      error: 'Recovered: previous import interrupted, existing catalog kept',
      sourceUrl: FIDE_XML_ZIP_URL,
    });
    return true;
  }

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
  const csvPath = join(dir, 'players.csv');
  try {
    await setMeta(sql, { status: 'running', error: null, sourceUrl: FIDE_XML_ZIP_URL, playerCount: 0 });
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
    await setMeta(sql, {
      status: 'running',
      playerCount: 0,
      error: 'Parsing XML to local file…',
      sourceUrl: FIDE_XML_ZIP_URL,
    });
    const count = await parseXmlToCsv(xmlStream, csvPath);
    zip.close();

    if (count === 0) {
      throw new Error('FIDE XML contained no players');
    }

    await setMeta(sql, {
      status: 'running',
      playerCount: count,
      error: 'Loading into database…',
      sourceUrl: FIDE_XML_ZIP_URL,
    });
    await loadCsvIntoStaging(sql, csvPath, count);
    await swapStagingToLive(sql);

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
    await unlink(csvPath).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Parse a local XML string into row objects (for tests). */
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
