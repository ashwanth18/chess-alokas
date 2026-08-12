import type { Sql } from 'postgres';
import { nameSearchVariants, toFederationCode } from './normalize.js';
import type {
  FideLookupPlayerIn,
  FideLookupResult,
  FideMatchStatus,
  FidePlayerRow,
} from './types.js';

const CANDIDATE_LIMIT = 8;

type DbRow = {
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
};

function toPlayer(row: DbRow): FidePlayerRow {
  return {
    fideId: row.fide_id,
    name: row.name,
    federation: row.federation,
    birthYear: row.birth_year,
    title: row.title,
    sex: row.sex,
    standard: row.standard,
    rapid: row.rapid,
    blitz: row.blitz,
    inactive: Boolean(row.inactive),
  };
}

function dedupe(rows: FidePlayerRow[]): FidePlayerRow[] {
  const seen = new Set<number>();
  const out: FidePlayerRow[] = [];
  for (const r of rows) {
    if (seen.has(r.fideId)) continue;
    seen.add(r.fideId);
    out.push(r);
  }
  return out;
}

export async function countFidePlayers(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fide_players`;
  return rows[0]?.n ?? 0;
}

async function getById(sql: Sql, fideId: number): Promise<FidePlayerRow | null> {
  const rows = await sql<DbRow[]>`
    SELECT fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive
    FROM fide_players WHERE fide_id = ${fideId} LIMIT 1
  `;
  return rows[0] ? toPlayer(rows[0]) : null;
}

async function searchByName(
  sql: Sql,
  pattern: string,
  federation: string | null,
  birthYear: number | null,
  limit: number,
): Promise<FidePlayerRow[]> {
  const like = `%${pattern}%`;
  if (federation && birthYear != null) {
    const rows = await sql<DbRow[]>`
      SELECT fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive
      FROM fide_players
      WHERE lower(name) LIKE lower(${like})
        AND federation = ${federation}
        AND birth_year = ${birthYear}
      ORDER BY inactive ASC, name ASC
      LIMIT ${limit}
    `;
    return rows.map(toPlayer);
  }
  if (federation) {
    const rows = await sql<DbRow[]>`
      SELECT fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive
      FROM fide_players
      WHERE lower(name) LIKE lower(${like})
        AND federation = ${federation}
      ORDER BY inactive ASC, name ASC
      LIMIT ${limit}
    `;
    return rows.map(toPlayer);
  }
  const rows = await sql<DbRow[]>`
    SELECT fide_id, name, federation, birth_year, title, sex, standard, rapid, blitz, inactive
    FROM fide_players
    WHERE lower(name) LIKE lower(${like})
    ORDER BY inactive ASC, name ASC
    LIMIT ${limit}
  `;
  return rows.map(toPlayer);
}

/**
 * Pure helper for tests: decide match status from candidates + whether ID was used.
 */
export function decideMatchStatus(
  candidates: FidePlayerRow[],
  fromExactId: boolean,
): { status: FideMatchStatus; selectedFideId: number | null } {
  if (fromExactId && candidates.length === 1) {
    return { status: 'exact', selectedFideId: candidates[0]!.fideId };
  }
  if (candidates.length === 1) {
    return { status: 'unique', selectedFideId: candidates[0]!.fideId };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', selectedFideId: null };
  }
  return { status: 'not_found', selectedFideId: null };
}

export async function matchOnePlayer(
  sql: Sql,
  player: FideLookupPlayerIn,
): Promise<FideLookupResult> {
  if (player.fideId != null && player.fideId > 0) {
    const row = await getById(sql, player.fideId);
    if (row) {
      return {
        participantId: player.id,
        status: 'exact',
        selectedFideId: row.fideId,
        candidates: [row],
      };
    }
  }

  const federation = toFederationCode(player.country);
  const birthYear =
    player.yearOfBirth != null && player.yearOfBirth > 1900 ? player.yearOfBirth : null;
  const variants = nameSearchVariants(player.name);

  let candidates: FidePlayerRow[] = [];

  // 1) name + fed + yob
  if (federation && birthYear != null) {
    for (const v of variants) {
      candidates = await searchByName(sql, v, federation, birthYear, CANDIDATE_LIMIT);
      if (candidates.length > 0) break;
    }
  }

  // 2) name + fed
  if (candidates.length === 0 && federation) {
    for (const v of variants) {
      candidates = await searchByName(sql, v, federation, null, CANDIDATE_LIMIT);
      if (candidates.length === 1) break;
      if (candidates.length > 1) break;
    }
  }

  // 3) distinctive token + fed (already covered by variants), or broader name-only as last resort
  if (candidates.length === 0) {
    for (const v of variants) {
      // Prefer federation-scoped when available already tried; try remaining without yob constraint
      candidates = await searchByName(sql, v, federation, null, CANDIDATE_LIMIT);
      if (candidates.length > 0) break;
    }
  }

  candidates = dedupe(candidates).slice(0, CANDIDATE_LIMIT);
  const { status, selectedFideId } = decideMatchStatus(candidates, false);
  return {
    participantId: player.id,
    status,
    selectedFideId,
    candidates,
  };
}

export async function matchPlayers(
  sql: Sql,
  players: FideLookupPlayerIn[],
): Promise<FideLookupResult[]> {
  const results: FideLookupResult[] = [];
  for (const p of players) {
    results.push(await matchOnePlayer(sql, p));
  }
  return results;
}
