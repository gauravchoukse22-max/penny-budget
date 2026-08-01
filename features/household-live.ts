// Live household sync.
//
// Polling alone is not "shared": a co-editor's change sat invisible for up to
// the poll interval, which reads as broken when two people are looking at the
// same budget together. Postgres change events on the household's slice of
// `household_records` let a write on one phone land on the other in about the
// time it takes to round-trip.
//
// The poll stays as a safety net — Realtime can drop a socket (backgrounded
// app, flaky network, a paused project) and we must not depend on every event
// being delivered. Both paths run the SAME pull, so a duplicate wake-up is
// harmless; the change token makes a redundant pull a no-op.
//
// REQUIRES the table to be in the realtime publication:
//   alter publication supabase_realtime add table public.household_records;
// Without it the subscription connects and simply never fires.
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export type LiveSubscription = { unsubscribe: () => void };

/**
 * Calls `onRemoteChange` whenever any member writes to this household.
 *
 * Returns a no-op handle when cloud accounts aren't configured, so callers
 * don't need to branch.
 */
export function subscribeToHousehold(householdId: string, onRemoteChange: () => void): LiveSubscription {
  if (!isSupabaseConfigured || !householdId) return { unsubscribe: () => {} };

  const channel = supabase
    .channel(`household:${householdId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'household_records',
        filter: `household_id=eq.${householdId}`,
      },
      () => {
        // Deliberately ignore the payload and re-pull instead of applying the
        // row directly: the pull path already handles tombstones, unknown
        // record types and the change token. Applying here too would be a
        // second, subtly different writer into the same tables.
        onRemoteChange();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}
