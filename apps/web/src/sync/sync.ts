import { db, getOrCreateClientId, getLastSyncAt, setLastSyncAt, ensureDbOpen } from '../db/local';
import { apiSyncPush, apiSyncPull } from '../api/client';
import type { LocalTournament, LocalCategory, LocalParticipant, LocalGame } from '../db/local';
import { repairInvalidGameCategoryIds, softDeleteOrphanGames } from '../lib/poolCategory';
import { supabase } from '../lib/supabase';

function toSyncItem(
  entity: 'tournament' | 'category' | 'participant' | 'game',
  record: { id: string; updatedAt: string; deletedAt?: string | null; dirty: 1 | 0 },
) {
  // Strip local-only fields before sending
  const {
    dirty: _dirty,
    arbiterPin: _arbiterPin,
    publicToken: _publicToken,
    publicEnabled: _publicEnabled,
    ...payload
  } = record as Record<string, unknown> & {
    dirty: 1 | 0;
    arbiterPin?: string | null;
    publicToken?: string | null;
    publicEnabled?: boolean;
  };
  return {
    entity,
    id: record.id,
    payload: payload as Record<string, unknown>,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

let syncInFlight: Promise<{ pushed: number; pulled: number }> | null = null;

/**
 * Runs a full push/pull sync. Multiple triggers (timers, window focus, a
 * manual button, desktop auto-sync) can call this at nearly the same time —
 * overlapping runs would race on the same dirty rows, so a call that arrives
 * while one is already in flight just awaits that same run instead of
 * starting a second one.
 */
export function syncOnline(): Promise<{ pushed: number; pulled: number }> {
  if (syncInFlight) return syncInFlight;
  const run = syncOnlineImpl().finally(() => {
    if (syncInFlight === run) syncInFlight = null;
  });
  syncInFlight = run;
  return run;
}

async function syncOnlineImpl(): Promise<{ pushed: number; pulled: number }> {
  const opened = await ensureDbOpen();
  if (!opened.ok) throw opened.error;

  const clientId = await getOrCreateClientId();

  // Legacy mixed-pool games used categoryId "__mixed__", which Postgres rejects.
  await repairInvalidGameCategoryIds();
  await softDeleteOrphanGames();

  // Scope what gets pushed to the currently signed-in owner, so a previous
  // user's leftover unsynced edits on a shared device never get pushed
  // under a different account's session. Local rows with no owner yet
  // (created before the tournament's first sync) are treated as belonging
  // to whoever is currently signed in.
  const currentUserId = supabase
    ? ((await supabase.auth.getSession()).data.session?.user.id ?? null)
    : null;
  const ownsRow = (ownerId: string | null | undefined) =>
    !currentUserId || !ownerId || ownerId === currentUserId;

  const allDirtyTournaments = await db.tournaments.where('dirty').equals(1).toArray();
  const dirtyTournaments = allDirtyTournaments.filter((t) => ownsRow(t.ownerId));
  const ownedTournamentIds = currentUserId
    ? new Set(
        (await db.tournaments.filter((t) => ownsRow(t.ownerId)).toArray()).map((t) => t.id),
      )
    : null;

  const allDirtyCategories = await db.categories.where('dirty').equals(1).toArray();
  const allDirtyParticipants = await db.participants.where('dirty').equals(1).toArray();
  const allDirtyGames = await db.games.where('dirty').equals(1).toArray();
  const dirtyCategories = ownedTournamentIds
    ? allDirtyCategories.filter((c) => ownedTournamentIds.has(c.tournamentId))
    : allDirtyCategories;
  const dirtyParticipants = ownedTournamentIds
    ? allDirtyParticipants.filter((p) => ownedTournamentIds.has(p.tournamentId))
    : allDirtyParticipants;
  const dirtyGames = ownedTournamentIds
    ? allDirtyGames.filter((g) => ownedTournamentIds.has(g.tournamentId))
    : allDirtyGames;

  // Always push parent tournaments before children so ownership/FK sync cannot 403.
  const dirtyTournamentIds = new Set(dirtyTournaments.map((t) => t.id));
  const parentIds = new Set<string>();
  for (const row of [...dirtyCategories, ...dirtyParticipants, ...dirtyGames]) {
    if (row.tournamentId) parentIds.add(row.tournamentId);
  }
  const tournamentsToPush = [...dirtyTournaments];
  for (const tid of parentIds) {
    if (dirtyTournamentIds.has(tid)) continue;
    const parent = await db.tournaments.get(tid);
    if (parent && !parent.deletedAt) tournamentsToPush.push(parent);
  }

  const items = [
    ...tournamentsToPush.map((r) => toSyncItem('tournament', r)),
    ...dirtyCategories.map((r) => toSyncItem('category', r)),
    ...dirtyParticipants.map((r) => toSyncItem('participant', r)),
    ...dirtyGames.map((r) => toSyncItem('game', r)),
  ];

  let pushed = 0;
  let pulled = 0;

  // Only clear `dirty` on rows whose updatedAt still matches what we just
  // pushed — if the user (or another sync trigger) edited a row again while
  // this request was in flight, its updatedAt will have moved on and it
  // must stay dirty so the newer edit gets picked up by the next push.
  function clearDirtyIfUnchanged<T extends { id: string; updatedAt: string; dirty: 1 | 0 }>(
    table: { where(index: string): { anyOf(keys: string[]): { modify(fn: (rec: T) => void): Promise<number> } } },
    snapshot: T[],
  ) {
    if (snapshot.length === 0) return Promise.resolve(0);
    const byId = new Map(snapshot.map((r) => [r.id, r.updatedAt]));
    return table
      .where('id')
      .anyOf(snapshot.map((r) => r.id))
      .modify((rec) => {
        if (byId.get(rec.id) === rec.updatedAt) {
          rec.dirty = 0;
        }
      });
  }

  if (items.length > 0) {
    const pushResult = await apiSyncPush({ clientId, items });
    if (!pushResult.ok) {
      throw new Error(pushResult.error ?? 'Sync push failed');
    }
    pushed = pushResult.data.accepted;

    await clearDirtyIfUnchanged(db.tournaments, dirtyTournaments);
    await clearDirtyIfUnchanged(db.categories, dirtyCategories);
    await clearDirtyIfUnchanged(db.participants, dirtyParticipants);
    await clearDirtyIfUnchanged(db.games, dirtyGames);
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
      const prev = local;
      await db.tournaments.put({
        ...remote,
        mixCategories: remote.mixCategories ?? false,
        confirmedRounds:
          remote.confirmedRounds ?? Math.max(0, (remote.currentRound ?? 0) - 1),
        prizePlaces: remote.prizePlaces ?? 3,
        awardScope: remote.awardScope ?? 'per_category',
        tiebreakOrder: remote.tiebreakOrder ?? null,
        sharedPlaces: remote.sharedPlaces ?? true,
        ownerId: remote.ownerId ?? null,
        arbiterPinRound: remote.arbiterPinRound ?? null,
        tableCount: remote.tableCount ?? 0,
        publicToken: remote.publicToken ?? null,
        publicEnabled: remote.publicEnabled ?? false,
        // Keep local plaintext PIN when round still matches.
        arbiterPin:
          prev?.arbiterPinRound === remote.arbiterPinRound ? (prev?.arbiterPin ?? null) : null,
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
      const remoteRating =
        remote.rating != null && Number(remote.rating) > 0 ? Number(remote.rating) : null;
      const remoteFideId =
        remote.fideId != null && Number(remote.fideId) > 0 ? Number(remote.fideId) : null;
      await db.participants.put({
        ...remote,
        // Explicit fields — omitted JSON keys must not wipe local fide/rating.
        rating: remoteRating,
        fideId: remoteFideId,
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
        resultLockedAt: remote.resultLockedAt ?? null,
        resultEnteredByName: remote.resultEnteredByName ?? null,
        resultEnteredByRole: remote.resultEnteredByRole ?? null,
        resultOverrideCount: remote.resultOverrideCount ?? 0,
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
