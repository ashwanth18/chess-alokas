import { db, getOrCreateClientId, getLastSyncAt, setLastSyncAt } from '../db/local';
import { apiSyncPush, apiSyncPull } from '../api/client';
import type { LocalTournament, LocalCategory, LocalParticipant, LocalGame } from '../db/local';
import { repairInvalidGameCategoryIds, softDeleteOrphanGames } from '../lib/poolCategory';

function toSyncItem(
  entity: 'tournament' | 'category' | 'participant' | 'game',
  record: { id: string; updatedAt: string; deletedAt?: string | null; dirty: 1 | 0 },
) {
  // Strip local-only fields before sending
  const { dirty: _dirty, ...payload } = record as Record<string, unknown> & { dirty: 1 | 0 };
  return {
    entity,
    id: record.id,
    payload: payload as Record<string, unknown>,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

export async function syncOnline(): Promise<{ pushed: number; pulled: number }> {
  const clientId = await getOrCreateClientId();

  // Legacy mixed-pool games used categoryId "__mixed__", which Postgres rejects.
  await repairInvalidGameCategoryIds();
  await softDeleteOrphanGames();

  const dirtyTournaments = await db.tournaments.where('dirty').equals(1).toArray();
  const dirtyCategories = await db.categories.where('dirty').equals(1).toArray();
  const dirtyParticipants = await db.participants.where('dirty').equals(1).toArray();
  const dirtyGames = await db.games.where('dirty').equals(1).toArray();

  const items = [
    ...dirtyTournaments.map((r) => toSyncItem('tournament', r)),
    ...dirtyCategories.map((r) => toSyncItem('category', r)),
    ...dirtyParticipants.map((r) => toSyncItem('participant', r)),
    ...dirtyGames.map((r) => toSyncItem('game', r)),
  ];

  let pushed = 0;
  let pulled = 0;

  if (items.length > 0) {
    const pushResult = await apiSyncPush({ clientId, items });
    if (!pushResult.ok) {
      throw new Error(pushResult.error ?? 'Sync push failed');
    }
    pushed = pushResult.data.accepted;

    if (dirtyTournaments.length > 0) {
      await db.tournaments
        .where('id')
        .anyOf(dirtyTournaments.map((r) => r.id))
        .modify({ dirty: 0 });
    }
    if (dirtyCategories.length > 0) {
      await db.categories
        .where('id')
        .anyOf(dirtyCategories.map((r) => r.id))
        .modify({ dirty: 0 });
    }
    if (dirtyParticipants.length > 0) {
      await db.participants
        .where('id')
        .anyOf(dirtyParticipants.map((r) => r.id))
        .modify({ dirty: 0 });
    }
    if (dirtyGames.length > 0) {
      await db.games
        .where('id')
        .anyOf(dirtyGames.map((r) => r.id))
        .modify({ dirty: 0 });
    }
  }

  const since = (await getLastSyncAt()) ?? '1970-01-01T00:00:00.000Z';
  const pullResult = await apiSyncPull(since);

  if (!pullResult.ok) {
    throw new Error(pullResult.error ?? 'Sync pull failed');
  }

  const { tournaments, categories, participants, games, serverTime } = pullResult.data;

  for (const remote of tournaments) {
    const local = await db.tournaments.get(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.tournaments.put({
        ...remote,
        mixCategories: remote.mixCategories ?? false,
        confirmedRounds:
          remote.confirmedRounds ?? Math.max(0, (remote.currentRound ?? 0) - 1),
        prizePlaces: remote.prizePlaces ?? 3,
        awardScope: remote.awardScope ?? 'per_category',
        ownerId: remote.ownerId ?? null,
        deletedAt: remote.deletedAt ?? null,
        dirty: 0,
      } as LocalTournament);
      pulled++;
    }
  }
  for (const remote of categories) {
    const local = await db.categories.get(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.categories.put({
        ...remote,
        prizePlaces: remote.prizePlaces ?? null,
        deletedAt: remote.deletedAt ?? null,
        dirty: 0,
      } as LocalCategory);
      pulled++;
    }
  }
  for (const remote of participants) {
    const local = await db.participants.get(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.participants.put({
        ...remote,
        customFields: (remote.customFields ?? {}) as Record<string, unknown>,
        categoryIds: remote.categoryIds ?? [],
        email: remote.email ?? null,
        deletedAt: remote.deletedAt ?? null,
        dirty: 0,
      } as LocalParticipant);
      pulled++;
    }
  }
  for (const remote of games) {
    const local = await db.games.get(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.games.put({
        ...remote,
        deletedAt: remote.deletedAt ?? null,
        dirty: 0,
      } as LocalGame);
      pulled++;
    }
  }

  // Clean empty shell duplicates created by the old dual create (local UUID + POST /tournaments).
  await softDeleteEmptyDuplicateTournaments();

  await setLastSyncAt(serverTime ?? new Date().toISOString());

  return { pushed, pulled };
}

/**
 * If several active tournaments share the same name, soft-delete empty shells
 * (no categories / players / games) so the real local copy remains.
 */
async function softDeleteEmptyDuplicateTournaments(): Promise<void> {
  const active = await db.tournaments.filter((t) => !t.deletedAt).toArray();
  const byName = new Map<string, typeof active>();
  for (const t of active) {
    const key = `${t.ownerId ?? ''}|${t.name.trim().toLowerCase()}`;
    const list = byName.get(key) ?? [];
    list.push(t);
    byName.set(key, list);
  }

  const now = new Date().toISOString();
  for (const group of byName.values()) {
    if (group.length < 2) continue;

    const scored = await Promise.all(
      group.map(async (t) => {
        const [cats, parts, games] = await Promise.all([
          db.categories.where('tournamentId').equals(t.id).filter((c) => !c.deletedAt).count(),
          db.participants.where('tournamentId').equals(t.id).filter((p) => !p.deletedAt).count(),
          db.games.where('tournamentId').equals(t.id).filter((g) => !g.deletedAt).count(),
        ]);
        return { t, weight: cats + parts + games };
      }),
    );

    const keepers = scored.filter((s) => s.weight > 0);
    const empties = scored.filter((s) => s.weight === 0);
    if (empties.length === 0) continue;

    // Only remove empty shells when at least one non-empty twin exists,
    // or when there are multiple empties (keep the newest empty).
    const toRemove =
      keepers.length > 0
        ? empties
        : empties
            .slice()
            .sort((a, b) => b.t.updatedAt.localeCompare(a.t.updatedAt))
            .slice(1);

    for (const { t } of toRemove) {
      await db.tournaments.update(t.id, {
        deletedAt: now,
        updatedAt: now,
        dirty: 1,
      });
    }
  }
}
