import { matchesFilter } from '@chess-alokas/shared';
import { db, nowIso, type LocalCategory } from '../db/local';
import {
  ageFromNric,
  categoryNameMatchesLabel,
  isAgeCategoryColumn,
  normalizeGender,
  nricFromCustomFields,
} from './importParse';

/** Legacy sentinel used before pool categories were always real UUIDs. */
export const MIXED_POOL_SENTINEL = '__mixed__';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Ensure the tournament has at least one real category to attach games to (required by Postgres). */
export async function ensurePoolCategoryId(
  tournamentId: string,
  existing?: LocalCategory[] | null,
): Promise<string> {
  const cats =
    existing?.filter((c) => !c.deletedAt) ??
    (await db.categories
      .where('tournamentId')
      .equals(tournamentId)
      .filter((c) => !c.deletedAt)
      .toArray());

  const first = cats[0];
  if (first) return first.id;

  const now = nowIso();
  const id = crypto.randomUUID();
  await db.categories.put({
    id,
    tournamentId,
    name: 'Open',
    filter: { logic: 'and', rules: [] },
    sortOrder: 0,
    updatedAt: now,
    dirty: 1,
  });
  return id;
}

/**
 * Rewrite any games that still use a non-UUID categoryId (e.g. legacy `__mixed__`)
 * so sync push can succeed against Postgres uuid columns.
 */
export async function repairInvalidGameCategoryIds(): Promise<number> {
  const games = await db.games.toArray();
  const broken = games.filter((g) => !g.deletedAt && !isUuid(g.categoryId));
  if (broken.length === 0) return 0;

  const now = nowIso();
  const poolByTournament = new Map<string, string>();
  let fixed = 0;

  for (const game of broken) {
    let poolId = poolByTournament.get(game.tournamentId);
    if (!poolId) {
      poolId = await ensurePoolCategoryId(game.tournamentId);
      poolByTournament.set(game.tournamentId, poolId);
    }
    await db.games.update(game.id, {
      categoryId: poolId,
      updatedAt: now,
      dirty: 1,
    });
    fixed++;
  }

  return fixed;
}

/**
 * Soft-delete active games whose categoryId is not an active category for that tournament.
 * These rows are invisible in category tabs but used to block next-round pairing.
 */
export async function softDeleteOrphanGames(tournamentId?: string): Promise<number> {
  const games = tournamentId
    ? await db.games.where('tournamentId').equals(tournamentId).toArray()
    : await db.games.toArray();
  const active = games.filter((g) => !g.deletedAt);
  if (active.length === 0) return 0;

  const tournamentIds = [...new Set(active.map((g) => g.tournamentId))];
  const now = nowIso();
  let removed = 0;

  for (const tid of tournamentIds) {
    const cats = await db.categories
      .where('tournamentId')
      .equals(tid)
      .filter((c) => !c.deletedAt)
      .toArray();
    const catIds = new Set(cats.map((c) => c.id));
    // No categories yet — leave games alone (mixed / open pool).
    if (catIds.size === 0) continue;

    for (const game of active.filter((g) => g.tournamentId === tid)) {
      if (catIds.has(game.categoryId)) continue;
      await db.games.update(game.id, {
        deletedAt: now,
        updatedAt: now,
        dirty: 1,
      });
      removed++;
    }
  }

  return removed;
}

/**
 * Fix age=0 / unnormalized gender from bad CSV mapping, then recompute categoryIds.
 * Safe to run on every tournament load.
 */
export async function repairParticipantCategories(tournamentId: string): Promise<number> {
  const [participants, categories] = await Promise.all([
    db.participants
      .where('tournamentId')
      .equals(tournamentId)
      .filter((p) => !p.deletedAt)
      .toArray(),
    db.categories
      .where('tournamentId')
      .equals(tournamentId)
      .filter((c) => !c.deletedAt)
      .toArray(),
  ]);

  if (participants.length === 0) return 0;

  const now = nowIso();
  let fixed = 0;

  for (const p of participants) {
    let age = p.age;
    let gender = p.gender;

    if (!age || age <= 0) {
      const fromNric = ageFromNric(nricFromCustomFields(p.customFields));
      if (fromNric != null) age = fromNric;
    }

    const normalized = normalizeGender(gender);
    if (normalized && normalized !== gender) gender = normalized;

    const fields = {
      name: p.name,
      age,
      gender,
      rating: p.rating,
      club: p.club,
      customFields: p.customFields,
    };

    let label: string | undefined;
    if (p.customFields) {
      for (const [key, val] of Object.entries(p.customFields)) {
        if (!isAgeCategoryColumn(key)) continue;
        const text = val == null ? '' : String(val).trim();
        if (text) {
          label = text;
          break;
        }
      }
    }

    const catIds = categories
      .filter(
        (cat) =>
          matchesFilter(fields, cat.filter) ||
          (label ? categoryNameMatchesLabel(cat.name, label) : false),
      )
      .map((c) => c.id);

    const ageChanged = age !== p.age;
    const genderChanged = gender !== p.gender;
    const catsChanged =
      catIds.length !== (p.categoryIds?.length ?? 0) ||
      catIds.some((id) => !p.categoryIds?.includes(id));

    if (!ageChanged && !genderChanged && !catsChanged) continue;

    await db.participants.update(p.id, {
      age,
      gender: gender ?? null,
      categoryIds: catIds,
      updatedAt: now,
      dirty: 1,
    });
    fixed++;
  }

  return fixed;
}

/** Run all local data repairs for a tournament (or all tournaments for game category ids). */
export async function repairTournamentLocalData(tournamentId: string): Promise<void> {
  const tournament = await db.tournaments.get(tournamentId);
  const mix = tournament?.mixCategories === true;
  const cats = await db.categories
    .where('tournamentId')
    .equals(tournamentId)
    .filter((c) => !c.deletedAt)
    .toArray();

  if (mix || cats.length === 0) {
    await repairInvalidGameCategoryIds();
  } else {
    // Separate pools: legacy non-UUID categoryIds are invisible orphans — remove them
    // instead of attaching them to the first category (which would leave pending boards).
    const games = await db.games.where('tournamentId').equals(tournamentId).toArray();
    const now = nowIso();
    for (const game of games) {
      if (game.deletedAt || isUuid(game.categoryId)) continue;
      await db.games.update(game.id, {
        deletedAt: now,
        updatedAt: now,
        dirty: 1,
      });
    }
  }

  await softDeleteOrphanGames(tournamentId);
  await repairParticipantCategories(tournamentId);
}
