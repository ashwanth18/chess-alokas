import type { Table } from 'dexie';
import { db } from '../db/local';
import { supabase } from '../lib/supabase';
import {
  idsNotYetCleaned,
  idsNotYetNoticedAsHeld,
  markCleaned,
  markNoticedAsHeld,
  mergeNotice,
  planRevocation,
  readRevokedIds,
  recordRevokedList,
  type PullResponseForRevocation,
  type RevocationNoticeData,
} from './revocationPlan';

export const revocationNoticeKey = (userId: string) => `revocationNotice:${userId}`;

/** Carries the removed ids, so a screen showing one of them can leave. */
export const TOURNAMENTS_REVOKED_EVENT = 'alokas:tournaments-revoked';

const CURSOR_PREFIX = 'lastSyncAt:';

async function readNotice(key: string): Promise<RevocationNoticeData | null> {
  const row = await db.meta.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RevocationNoticeData;
  } catch {
    return null;
  }
}

type PurgeBridge = {
  backupPurgeTournaments?: (ids: string[]) => Promise<{ cleaned: number; failed: number }>;
};

/**
 * Takes the tournaments out of the desktop's automatic snapshots. No snapshot is taken first,
 * because it would keep the very data being removed.
 */
async function cleanSnapshots(userId: string, ids: string[]): Promise<number> {
  const bridge = window.desktop as unknown as PurgeBridge | undefined;
  if (!bridge?.backupPurgeTournaments) return 0;
  const pending = idsNotYetCleaned(userId, ids);
  if (pending.length === 0) return 0;
  try {
    const { failed } = await bridge.backupPurgeTournaments(pending);
    // Failures stay unmarked, so the next sync tries those files again.
    if (failed === 0) markCleaned(userId, pending);
    return failed;
  } catch (err) {
    console.warn('[sync] could not clean snapshots', err);
    return 1;
  }
}

/**
 * Removes what the server explicitly said this user may no longer hold. Returns the ids of the rows
 * dropped, so their refusals aren't also reported as changes waiting to sync.
 * See revocationPlan.ts for what stops anything being removed.
 */
export async function applyRevocations(
  response: PullResponseForRevocation & { tournaments: Array<{ id: string }> },
  syncUserId: string | null,
): Promise<Set<string>> {
  const dropped = new Set<string>();
  const sessionUserId = supabase
    ? ((await supabase.auth.getSession()).data.session?.user.id ?? null)
    : null;
  const revokedIds = readRevokedIds(response, syncUserId, sessionUserId);
  if (!revokedIds || !syncUserId) return dropped;
  recordRevokedList(syncUserId, revokedIds);
  if (revokedIds.length === 0) return dropped;

  const deliveredIds = new Set(response.tournaments.map((t) => t.id));
  const noticeKey = revocationNoticeKey(syncUserId);
  let removedIds: string[] = [];
  let heldBackIds: string[] = [];

  await db.transaction(
    'rw',
    [
      db.tournaments,
      db.categories,
      db.participants,
      db.games,
      db.certificateTemplates,
      db.tournamentTables,
      db.meta,
    ],
    async () => {
      const held = (await db.tournaments.bulkGet(revokedIds)).filter(
        (t): t is NonNullable<typeof t> => Boolean(t),
      );
      const heldIds = new Set(held.map((t) => t.id));

      const cursors = (await db.meta.toCollection().primaryKeys()) as string[];
      const otherCursors = cursors.filter(
        (key) => key.startsWith(CURSOR_PREFIX) && key !== `${CURSOR_PREFIX}${syncUserId}`,
      );

      type Related = Table<{ id: string; dirty: 1 | 0 }, string>;
      const children = [db.categories, db.participants, db.games] as unknown as Related[];
      const related = [...children, db.certificateTemplates, db.tournamentTables] as unknown as Related[];
      const pendingChanges = new Map<string, number>();
      const pendingRowIds = new Map<string, string[]>();
      for (const t of held) {
        const ids: string[] = t.dirty === 1 ? [t.id] : [];
        for (const table of children) {
          const rows = await table
            .where('tournamentId')
            .equals(t.id)
            .filter((row) => row.dirty === 1)
            .primaryKeys();
          ids.push(...rows);
        }
        pendingChanges.set(t.id, ids.length);
        pendingRowIds.set(t.id, ids);
      }

      const plan = planRevocation({
        revokedIds,
        heldIds,
        deliveredIds,
        pendingChanges,
        otherAccountsOnDevice: otherCursors.length > 0,
      });
      removedIds = plan.remove;
      heldBackIds = plan.heldBack;

      let droppedChanges = 0;
      for (const id of plan.remove) {
        for (const table of related) {
          await table.where('tournamentId').equals(id).delete();
        }
        await db.tournaments.delete(id);
        const rows = pendingRowIds.get(id) ?? [];
        droppedChanges += rows.length;
        rows.forEach((rowId) => dropped.add(rowId));
        // A parent pushed only because a child was dirty is refused too.
        dropped.add(id);
      }

      // Another account's own copy was just deleted too. A full pull brings back what they may see.
      if (plan.remove.length > 0 && otherCursors.length > 0) {
        await db.meta.bulkDelete(otherCursors);
      }

      const nameOf = (id: string) => held.find((t) => t.id === id)?.name ?? 'A tournament';
      const newlyHeld = idsNotYetNoticedAsHeld(syncUserId, plan.heldBack);
      if (plan.remove.length > 0 || newlyHeld.length > 0) {
        const merged = mergeNotice(await readNotice(noticeKey), {
          tournaments: plan.remove.map(nameOf),
          droppedChanges,
          heldBack: newlyHeld.map(nameOf),
          backupsNotCleaned: 0,
        });
        await db.meta.put({ key: noticeKey, value: JSON.stringify(merged) });
      }
    },
  );

  markNoticedAsHeld(syncUserId, heldBackIds);
  if (removedIds.length > 0) {
    window.dispatchEvent(new CustomEvent(TOURNAMENTS_REVOKED_EVENT, { detail: removedIds }));
  }
  for (const id of removedIds) {
    try {
      localStorage.removeItem(`chess-alokas-floor:${id}`);
      localStorage.removeItem(`alokas:pendingFloorPin:${id}`);
    } catch {
      /* ignore */
    }
  }

  // Everything on the list except what is deliberately still here, including tournaments this
  // device removed earlier or never held: an older snapshot can still contain them.
  const held = new Set(heldBackIds);
  const failed = await cleanSnapshots(
    syncUserId,
    revokedIds.filter((id) => !held.has(id)),
  );
  if (failed > 0) {
    const notice = await readNotice(noticeKey);
    await db.meta.put({
      key: noticeKey,
      value: JSON.stringify({
        ...(notice ?? { tournaments: [], droppedChanges: 0, heldBack: [] }),
        backupsNotCleaned: failed,
      }),
    });
  }
  return dropped;
}
