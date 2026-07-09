import { db, getOrCreateClientId, getLastSyncAt, setLastSyncAt } from '../db/local';
import { apiSyncPush, apiSyncPull } from '../api/client';
import type { LocalTournament, LocalCategory, LocalParticipant, LocalGame } from '../db/local';

function toSyncItem(
  entity: 'tournament' | 'category' | 'participant' | 'game',
  record: { id: string; updatedAt: string; deletedAt?: string | null; dirty: 1 | 0 },
) {
  return {
    entity,
    id: record.id,
    payload: record as unknown as Record<string, unknown>,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

export async function syncOnline(): Promise<{ pushed: number; pulled: number }> {
  const clientId = await getOrCreateClientId();

  // ── Push dirty records ───────────────────────────────────────────────────
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
    if (pushResult.ok) {
      pushed = pushResult.data.accepted;
      // Mark records as clean
      await db.tournaments.where('dirty').equals(1).modify({ dirty: 0 });
      await db.categories.where('dirty').equals(1).modify({ dirty: 0 });
      await db.participants.where('dirty').equals(1).modify({ dirty: 0 });
      await db.games.where('dirty').equals(1).modify({ dirty: 0 });
    }
  }

  // ── Pull remote changes ─────────────────────────────────────────────────
  const since = (await getLastSyncAt()) ?? '1970-01-01T00:00:00.000Z';
  const pullResult = await apiSyncPull(since);

  if (pullResult.ok) {
    const { tournaments, categories, participants, games, serverTime } = pullResult.data;

    // LWW merge: if remote updatedAt > local updatedAt, overwrite
    for (const remote of tournaments) {
      const local = await db.tournaments.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        await db.tournaments.put({ ...remote, dirty: 0 } as LocalTournament);
        pulled++;
      }
    }
    for (const remote of categories) {
      const local = await db.categories.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        await db.categories.put({ ...remote, dirty: 0 } as LocalCategory);
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
          dirty: 0,
        } as LocalParticipant);
        pulled++;
      }
    }
    for (const remote of games) {
      const local = await db.games.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        await db.games.put({ ...remote, dirty: 0 } as LocalGame);
        pulled++;
      }
    }

    await setLastSyncAt(serverTime);
  }

  return { pushed, pulled };
}
