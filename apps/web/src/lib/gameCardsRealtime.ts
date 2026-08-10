import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Live notify when yellow/red cards change for a tournament.
 * Caller should refetch card lists (cards are not stored in Dexie).
 */
export function subscribeTournamentGameCards(
  tournamentId: string,
  onChange: () => void,
  onStatus?: (ok: boolean) => void,
): () => void {
  if (!supabase) {
    onStatus?.(false);
    return () => undefined;
  }

  let channel: RealtimeChannel | null = null;
  let alive = true;

  channel = supabase
    .channel(`game-cards-live:${tournamentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_cards',
        filter: `tournament_id=eq.${tournamentId}`,
      },
      () => {
        if (!alive) return;
        onChange();
      },
    )
    .subscribe((status) => {
      onStatus?.(status === 'SUBSCRIBED');
    });

  return () => {
    alive = false;
    if (channel) {
      void supabase?.removeChannel(channel);
      channel = null;
    }
  };
}
