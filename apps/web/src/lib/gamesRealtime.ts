import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { db, type LocalGame } from '../db/local';

type GameRow = {
  id: string;
  tournament_id: string;
  category_id: string;
  round: number;
  board: number;
  white_id: string | null;
  black_id: string | null;
  result: string;
  is_bye: boolean;
  result_locked_at: string | null;
  result_entered_by_name: string | null;
  result_entered_by_role: string | null;
  result_override_count: number | null;
  updated_at: string;
  deleted_at: string | null;
};

function rowToLocalGame(row: GameRow): LocalGame {
  const role = row.result_entered_by_role;
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    categoryId: row.category_id,
    round: row.round,
    board: row.board,
    whiteId: row.white_id,
    blackId: row.black_id,
    result: row.result,
    isBye: Boolean(row.is_bye),
    resultLockedAt: row.result_locked_at,
    resultEnteredByName: row.result_entered_by_name,
    resultEnteredByRole: role === 'floor' || role === 'director' ? role : null,
    resultOverrideCount: row.result_override_count ?? 0,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
  };
}

async function upsertFromRemote(row: GameRow) {
  const remote = rowToLocalGame(row);
  const local = await db.games.get(remote.id);
  if (local?.dirty === 1 && local.updatedAt > remote.updatedAt) return;
  await db.games.put(remote);
}

/**
 * Live-merge game changes for a tournament into Dexie.
 * Returns unsubscribe + whether Realtime subscribed successfully.
 */
export function subscribeTournamentGames(
  tournamentId: string,
  onStatus?: (ok: boolean) => void,
): () => void {
  if (!supabase) {
    onStatus?.(false);
    return () => undefined;
  }

  let channel: RealtimeChannel | null = null;
  let alive = true;

  channel = supabase
    .channel(`games-live:${tournamentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'games',
        filter: `tournament_id=eq.${tournamentId}`,
      },
      (payload) => {
        if (!alive) return;
        const row = (payload.new ?? payload.old) as GameRow | null;
        if (!row?.id) return;
        if (payload.eventType === 'DELETE') {
          void db.games.update(row.id, {
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            dirty: 0,
          });
          return;
        }
        void upsertFromRemote(row);
      },
    )
    .subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      onStatus?.(ok);
    });

  return () => {
    alive = false;
    if (channel) {
      void supabase?.removeChannel(channel);
      channel = null;
    }
  };
}
