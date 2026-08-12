import { lichessGetById, lichessSearch, mapPool } from './lichess.js';
import {
  MIN_CANDIDATE_SCORE,
  UNIQUE_MIN_SCORE,
  UNIQUE_SCORE_GAP,
  nameSearchVariants,
  scoreNameMatch,
  toFederationCode,
} from './normalize.js';
import type {
  FideLookupPlayerIn,
  FideLookupResult,
  FideMatchStatus,
  FidePlayerRow,
} from './types.js';

const CANDIDATE_LIMIT = 15;
const LOOKUP_CONCURRENCY = 4;

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

/**
 * Pure helper for tests: decide match status from scored candidates + whether ID was used.
 * Candidates should already be sorted by score descending.
 */
export function decideMatchStatus(
  candidates: FidePlayerRow[],
  fromExactId: boolean,
  scores?: Map<number, number>,
): { status: FideMatchStatus; selectedFideId: number | null } {
  if (fromExactId && candidates.length === 1) {
    return { status: 'exact', selectedFideId: candidates[0]!.fideId };
  }
  if (candidates.length === 0) {
    return { status: 'not_found', selectedFideId: null };
  }

  const scoreOf = (c: FidePlayerRow) => scores?.get(c.fideId) ?? scoreNameMatch('', c.name);
  // When scores map omitted (legacy tests), treat single candidate as unique only if caller
  // already filtered — prefer explicit scores from matchOnePlayer.
  if (!scores) {
    if (candidates.length === 1) {
      return { status: 'unique', selectedFideId: candidates[0]!.fideId };
    }
    return { status: 'ambiguous', selectedFideId: null };
  }

  const top = candidates[0]!;
  const topScore = scoreOf(top);
  const secondScore = candidates.length > 1 ? scoreOf(candidates[1]!) : 0;

  if (
    topScore >= UNIQUE_MIN_SCORE &&
    (candidates.length === 1 || topScore >= secondScore + UNIQUE_SCORE_GAP)
  ) {
    return { status: 'unique', selectedFideId: top.fideId };
  }

  if (candidates.length >= 1) {
    return { status: 'ambiguous', selectedFideId: null };
  }
  return { status: 'not_found', selectedFideId: null };
}

async function searchVariants(queries: string[]): Promise<FidePlayerRow[]> {
  const collected: FidePlayerRow[] = [];
  for (const q of queries) {
    const hits = await lichessSearch(q);
    collected.push(...hits);
  }
  return dedupe(collected);
}

function hasAnyRating(row: FidePlayerRow): boolean {
  return (
    (row.standard != null && row.standard > 0) ||
    (row.rapid != null && row.rapid > 0) ||
    (row.blitz != null && row.blitz > 0)
  );
}

/** Search hits sometimes omit ratings; pull profile when sparse (still Unr. if FIDE has none). */
async function hydrateSparseProfiles(rows: FidePlayerRow[]): Promise<FidePlayerRow[]> {
  return mapPool(rows, 3, async (row) => {
    if (hasAnyRating(row)) return row;
    try {
      const full = await lichessGetById(row.fideId);
      return full ?? row;
    } catch {
      return row;
    }
  });
}

export async function matchOnePlayer(player: FideLookupPlayerIn): Promise<FideLookupResult> {
  if (player.fideId != null && player.fideId > 0) {
    const row = await lichessGetById(player.fideId);
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
  const variants = nameSearchVariants(player.name);
  let candidates = await searchVariants(variants);

  if (federation) {
    const fedHits = candidates.filter(
      (c) => !c.federation || c.federation.toUpperCase() === federation,
    );
    // Prefer federation-scoped when we have any; fall back to all if empty
    if (fedHits.length > 0) candidates = fedHits;
  }

  const scores = new Map<number, number>();
  for (const c of candidates) {
    scores.set(c.fideId, scoreNameMatch(player.name, c.name));
  }

  candidates = candidates
    .filter((c) => (scores.get(c.fideId) ?? 0) >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => (scores.get(b.fideId) ?? 0) - (scores.get(a.fideId) ?? 0))
    .slice(0, CANDIDATE_LIMIT);

  candidates = await hydrateSparseProfiles(candidates);

  const { status, selectedFideId } = decideMatchStatus(candidates, false, scores);
  return {
    participantId: player.id,
    status,
    selectedFideId,
    candidates,
  };
}

export async function matchPlayers(players: FideLookupPlayerIn[]): Promise<FideLookupResult[]> {
  return mapPool(players, LOOKUP_CONCURRENCY, (p) => matchOnePlayer(p));
}
