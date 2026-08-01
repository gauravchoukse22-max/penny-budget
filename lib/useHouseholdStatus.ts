import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { listMembers, myHouseholdsResult, type Household, type HouseholdMember } from '../features/household';

// One source of truth for "is this budget shared, and with whom".
//
// The divergence this exists to prevent: two screens each reported sharing was
// on while the two phones sat in different households. Any screen that can
// change sharing shows this, so the answer is on screen instead of inferred
// from the numbers disagreeing days later.

export type HouseholdStatus = {
  /** This device is syncing through a household right now. */
  sharingOn: boolean;
  loading: boolean;
  /** The household this device uses, when the roster could be read. */
  current: Household | null;
  members: HouseholdMember[];
  /** Members other than the signed-in user — literally "who else sees this". */
  others: HouseholdMember[];
  /** Every household this account belongs to, including ones not in use here. */
  memberships: Household[];
  /** Who is in this household was actually read back. False means "we don't
   * know" — never render that as "you are alone", which is the kind of
   * confident wrong answer this screen exists to stop giving. */
  checked: boolean;
  /** The list of households this account belongs to was read back. False means
   * the list below may be stale or empty for want of a connection. */
  membershipsChecked: boolean;
  /** Sharing is on, the list loaded, and this account is not in that household —
   * the device is journaling writes nobody will ever receive. */
  detached: boolean;
  reload: () => Promise<void>;
};

export function useHouseholdStatus(): HouseholdStatus {
  const { isConfigured, user } = useAuth();
  const { settings } = useBudget();
  const householdId = settings.householdId;

  const [memberships, setMemberships] = useState<Household[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [membershipsChecked, setMembershipsChecked] = useState(false);

  const reload = useCallback(async () => {
    if (!isConfigured || !user) {
      setMemberships([]);
      setMembers([]);
      setChecked(false);
      setMembershipsChecked(false);
      return;
    }
    setLoading(true);
    try {
      const [hs, ms] = await Promise.all([
        myHouseholdsResult(),
        householdId ? listMembers(householdId) : Promise.resolve<HouseholdMember[]>([]),
      ]);
      // Keep the last good answer on a failed read rather than replacing it with
      // an empty list that looks like a fact.
      if (hs.success) setMemberships(hs.data ?? []);
      if (!householdId) setMembers([]);
      else if (ms.length > 0) setMembers(ms);
      setMembershipsChecked(hs.success);
      // A household you are in always contains at least you, so an empty roster
      // means the read failed (or membership ended) rather than "you are alone".
      setChecked(!householdId || ms.length > 0);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, user?.id, householdId]);

  // Refetch whenever the screen comes forward: an invite accepted on the other
  // phone should show up here without needing an app restart.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const current = householdId ? memberships.find((h) => h.id === householdId) ?? null : null;

  return {
    sharingOn: !!householdId,
    loading,
    current,
    members,
    others: members.filter((m) => m.userId !== user?.id),
    memberships,
    checked,
    membershipsChecked,
    detached: !!householdId && membershipsChecked && !current,
    reload,
  };
}

/** One-line state, used verbatim wherever sharing is summarised. */
export function sharingSummary(status: HouseholdStatus, signedIn: boolean): string {
  if (!signedIn) return 'Off — needs the optional account';
  if (!status.sharingOn) {
    return status.memberships.length > 0 ? 'Off on this device' : 'Off — this budget stays on this device';
  }
  if (!status.checked) return status.loading ? 'On — checking who is in it' : 'On';
  if (status.others.length === 0) return 'On — just your devices';
  if (status.others.length === 1) return `On — shared with ${status.others[0].email ?? '1 other person'}`;
  return `On — shared with ${status.others.length} other people`;
}
