import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, ActivityIndicator, Platform, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useBudget, type JoinMode } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import {
  GroupedSection,
  AuthTextField,
  PrimaryButton,
  InlineError,
  InfoNote,
  OrDivider,
} from '../../components/AuthUI';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Button } from '../../components/Button';
import { createInvite, removeMember, type Household, type HouseholdMember } from '../../features/household';
import {
  describeSharedCurrency,
  getCurrencyState,
  setSharedCurrency,
  type CurrencyState,
} from '../../features/shared-settings';
import { currencySymbol } from '../../lib/format';
import { useHouseholdStatus, type HouseholdStatus } from '../../lib/useHouseholdStatus';
import { confirmAction } from '../../lib/confirm';

// The ONE screen that can change how this budget syncs.
//
// It used to be two: a "Sync across my devices" switch in Settings that CREATED
// a household, and this screen, which JOINED someone else's. Neither knew about
// the other and neither showed which household you were in, so an owner and his
// wife ended up in five separate households with both screens reporting
// success. Settings now only links here, and every path below states what it
// will do before it does it.

type BusyAction = 'device' | 'join' | 'create' | 'connect' | 'invite' | 'sync' | 'pause' | 'leave' | 'remove' | 'currency';

// Membership controls WHO RECEIVES CHANGES. It does not control who holds a
// copy — every member's device carries a complete offline copy of the budget,
// and nothing in the app or the backend can reach in and take it back. "Remove"
// therefore reads as far stronger than it is, so every screen and dialog that
// ends a membership says this in full rather than implying a revoke.
const COPY_STAYS_WITH_THEM =
  'The copy already on their device stays there and keeps working. It is a full copy of this budget, and removing them does not delete it or take it back.';
const COPY_STAYS_WITH_YOU =
  'The copy on this device stays and keeps working offline. You keep everything you can see now, and nobody else can take it back.';

export default function SharingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConfigured, user } = useAuth();
  const {
    settings,
    refresh,
    createHousehold,
    joinHousehold,
    connectToHousehold,
    startDeviceSync,
    pauseSharing,
    leaveHousehold,
    syncNow,
  } = useBudget();
  const status = useHouseholdStatus();

  // Which currency this budget is actually shown in, and where that came from.
  //
  // Read here rather than taken from `settings.currency`, because the whole
  // point is the DIFFERENCE between the two: settings.currency is what is on
  // screen, and this also carries what this device's own preference is and
  // whether the shared budget is overriding it. Without that, a joiner watches
  // every amount change symbol with nothing anywhere saying why.
  const [currencyState, setCurrencyState] = useState<CurrencyState | null>(null);
  const loadCurrency = useCallback(async () => {
    setCurrencyState(await getCurrencyState());
  }, []);
  // settings.currency is in the deps so this re-reads after the Settings picker
  // changes it, and settings.householdId so joining or pausing re-resolves.
  useEffect(() => {
    loadCurrency();
  }, [loadCurrency, settings.currency, settings.householdId]);

  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // No default. Joining used to silently mean "merge", which is what left the
  // joiner holding private rows nobody else could see, so the choice is made
  // deliberately or not at all.
  const [joinMode, setJoinMode] = useState<JoinMode | null>(null);

  const run = async (action: BusyAction, fn: () => Promise<{ success: boolean; message: string } | void>) => {
    setBusy(action);
    setError(null);
    setInfo(null);
    try {
      const res = await fn();
      if (res && !res.success) setError(res.message);
      else if (res) setInfo(res.message);
      await status.reload();
      // Joining pulls the household's shared settings, so the currency answer
      // can be different the instant this returns. Re-read it here rather than
      // waiting for the next screen visit — the symbol on the amounts has
      // already changed by then.
      await loadCurrency();
    } finally {
      setBusy(null);
    }
  };

  const currentName = status.current?.name ?? 'this shared budget';

  // ── Turn sharing on for this device only ─────────────────────────────────
  const doStartDeviceSync = async () => {
    const ok = await confirmAction({
      title: 'Turn on device sync?',
      message:
        'Your budget is copied to your private cloud space so your other devices signed in to this account use the same one. Nobody else can see it. You can invite someone into it later.',
      confirmLabel: 'Turn on',
    });
    if (!ok) return;
    run('device', startDeviceSync);
  };

  // ── Use a household this account already belongs to ──────────────────────
  const doConnect = async (h: Household) => {
    const ok = await confirmAction({
      title: `Use ${h.name} on this device?`,
      message:
        // "Merged in" was wrong here in the same way it was wrong on join: this
        // path pulls the shared budget down and never sends this device's rows
        // up, so they stay local and read as duplicates.
        h.memberCount > 1
          ? `That budget already has ${h.memberCount} people in it. This device starts syncing with it. What is on this device now stays here and is not sent to them, so anything that budget already has will appear twice.`
          : 'This device starts syncing with that budget. What is on this device now stays here, alongside whatever that budget already holds.',
      confirmLabel: 'Use it',
    });
    if (!ok) return;
    run('connect', () => connectToHousehold(h.id));
  };

  // ── Join with an invite code ─────────────────────────────────────────────
  const doJoin = async () => {
    if (!joinMode) return;
    // Joining while already in a household leaves that one. Saying so here is
    // the difference between a deliberate switch and a silently split budget.
    const leaving = status.sharingOn
      ? `You can be in one shared budget at a time, so this device stops syncing with ${currentName} and anyone still in it keeps their copy. `
      : '';
    const ok =
      joinMode === 'replace'
        ? await confirmAction({
            title: 'Delete this budget and use the shared one?',
            message:
              leaving +
              'The cards, categories, transactions and savings goals on this device are deleted and replaced with the shared budget. This cannot be undone. To keep a copy, cancel and export one first from Settings → Backup.',
            confirmLabel: 'Delete and join',
            destructive: true,
          })
        : await confirmAction({
            title: 'Join and keep this budget?',
            message:
              leaving +
              'What is on this device is kept and the shared budget is added alongside it. Your existing items are not sent to the others, so only this device will ever show them, and anything the shared budget already has will appear twice.',
            confirmLabel: status.sharingOn ? 'Leave and join' : 'Join',
            destructive: status.sharingOn,
          });
    if (!ok) return;
    await run('join', () => joinHousehold(code.trim(), joinMode));
    setCode('');
    // Cleared even on failure: a pre-armed destructive choice must not sit
    // waiting behind a button the user comes back to later.
    setJoinMode(null);
  };

  // ── Create a shared budget and invite someone into it ────────────────────
  const doCreate = async () => {
    const existing = status.memberships;
    const ok =
      existing.length > 0
        ? await confirmAction({
            title: 'Start a second shared budget?',
            message: `This account already belongs to ${existing.map((h) => h.name).join(', ')}. A new budget is separate — nobody there can see it and the numbers will not match. Use the existing one if you meant to share with the same person.`,
            confirmLabel: 'Create separate budget',
            destructive: true,
          })
        : await confirmAction({
            title: 'Create a shared budget?',
            message: 'The budget on this device becomes the shared one. Anyone you invite can see and edit all of it.',
            confirmLabel: 'Create',
          });
    if (!ok) return;
    await run('create', () => createHousehold(name.trim() || undefined, { evenIfAlreadyAMember: existing.length > 0 }));
    setName('');
  };

  const doInvite = async () => {
    // The local id, not the fetched one: a roster read that failed must not stop
    // you inviting the person you are trying to connect to.
    const hid = settings.householdId;
    if (!hid) return;
    setBusy('invite');
    setError(null);
    try {
      const res = await createInvite(hid);
      if (res.success && res.data) setInvite(res.data);
      else setError(res.message);
    } finally {
      setBusy(null);
    }
  };

  const doShareCode = async () => {
    if (!invite) return;
    try {
      await Share.share({ message: `Join my KaiJar with this code: ${invite}` });
    } catch {
      // Sharing was dismissed or is unavailable — the code stays on screen.
    }
  };

  // ── Make this device's own currency the shared one ───────────────────────
  //
  // The escape hatch for the join rule. Joining deliberately never changes the
  // household's currency — an invite code must not restate everyone else's
  // money in a new symbol — so this is how a joiner who genuinely wants the
  // change gets it: deliberately, from a button that says whom it affects, with
  // a confirmation that says it again. That is the whole difference between
  // this and the silent rewrite the join path refuses to do.
  const doAdoptLocalCurrency = async () => {
    const hid = settings.householdId;
    if (!hid || !currencyState) return;
    const target = currencyState.local;
    const ok = await confirmAction({
      title: `Show this budget in ${target}?`,
      message: `Everyone in ${currentName} sees amounts in ${target} from now on, not just this device. Nothing is converted — the numbers stay exactly as they are and only the symbol changes.`,
      confirmLabel: `Use ${target}`,
    });
    if (!ok) return;
    setBusy('currency');
    setError(null);
    setInfo(null);
    try {
      await setSharedCurrency(hid, target);
      await loadCurrency();
      // The amounts on every other screen come from the budget context, so it
      // has to re-read for the change to be visible anywhere but here.
      await refresh();
      setInfo(`This shared budget now shows amounts in ${target}.`);
    } finally {
      setBusy(null);
    }
  };

  const doSync = async () => {
    setBusy('sync');
    setInfo(null);
    try {
      await syncNow();
      await status.reload();
      setInfo('Synced.');
    } finally {
      setBusy(null);
    }
  };

  const doPause = async () => {
    const ok = await confirmAction({
      title: 'Turn off sync on this device?',
      message:
        'Everything already on this device stays and keeps working offline. New changes stop syncing. You stay a member, so you can turn sync back on here later.',
      confirmLabel: 'Turn off',
    });
    if (!ok) return;
    run('pause', pauseSharing);
  };

  const doLeave = async () => {
    const ok = await confirmAction({
      title: `Leave ${currentName}?`,
      message: `You stop receiving their changes and can no longer edit the shared budget. ${COPY_STAYS_WITH_YOU} The others keep the shared budget, and rejoining needs a new invite code.`,
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    await run('leave', leaveHousehold);
    setInvite(null);
  };

  // ── Remove someone else from the shared budget ───────────────────────────
  const doRemove = async (member: HouseholdMember) => {
    const hid = settings.householdId;
    if (!hid) return;
    const who = member.email ?? 'this person';
    const ok = await confirmAction({
      title: `Remove ${who}?`,
      message: `They stop receiving changes and can no longer edit this shared budget. ${COPY_STAYS_WITH_THEM}`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await run('remove', async () => {
      const res = await removeMember(hid, member.userId);
      return res.success
        ? { success: true, message: `${who} no longer receives changes. The copy on their device stays with them.` }
        : res;
    });
  };

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header="Sharing" footnote="This build has no cloud accounts configured, so syncing and sharing are unavailable.">
          <Text style={{ color: theme.label, fontSize: 16 }}>Your budget stays on this device.</Text>
        </GroupedSection>
      </ScrollView>
    );
  }

  if (!user) {
    return (
      <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection
          header="Sharing"
          footnote="Syncing between your own devices and sharing with another person both need the optional account. Your budget works offline either way."
        >
          {/* Signed out with a household still set is a silently-not-syncing
              state — the exact kind this screen has to name out loud. */}
          {settings.householdId && (
            <InfoNote message="This device is set to sync with a shared budget, but nothing syncs until you sign in again." />
          )}
          <PrimaryButton title="Sign in to continue" onPress={() => router.push('/account')} />
        </GroupedSection>
      </ScrollView>
    );
  }

  // ── Sharing is on ────────────────────────────────────────────────────────
  if (status.sharingOn) {
    const alone = status.checked && status.others.length === 0;
    // Only the owner may remove anyone (the RPC enforces it too); showing the
    // control to a member would promise something the server refuses.
    const iAmOwner = status.members.some((m) => m.userId === user.id && m.role === 'owner');
    const canRemove = iAmOwner && status.others.length > 0;
    return (
      <KeyboardAwareScreen
        backgroundColor={theme.groupedBackground}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <GroupedSection
          header="Sharing is on"
          footnote={
            canRemove
              ? 'Everyone listed here edits the same budget. Changes sync while the app is open. Removing someone stops them receiving changes and stops them editing. The copy already on their device stays with them and cannot be taken back.'
              : 'Everyone listed here edits the same budget. Changes sync while the app is open.'
          }
        >
          <Text style={{ color: theme.label, fontSize: 17, fontWeight: '700' }}>{status.current?.name ?? 'Shared budget'}</Text>
          <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>{membershipLine(status)}</Text>

          {status.loading && status.members.length === 0 ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            status.members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                isYou={m.userId === user.id}
                onRemove={iAmOwner && m.userId !== user.id ? () => doRemove(m) : undefined}
                removeDisabled={!!busy}
              />
            ))
          )}

          {!status.loading && !status.checked && !status.detached && (
            <InfoNote message="This device is still set to sync. Open this screen again when you are online to see who else is in it." />
          )}
          {status.detached && (
            <InlineError message="This device points at a shared budget this account is no longer in, so nothing is syncing. Join again with an invite code, or turn sync off." />
          )}
        </GroupedSection>

        {/* Stated on every visit, not only right after a join: whichever member
            is looking, "why does my phone say £ when I chose $" has to have an
            answer somewhere they can find it later, not just in a message that
            has already scrolled away. */}
        {currencyState && (
          <GroupedSection
            header="Currency"
            footnote="Currency is part of the shared budget, so both phones show the same symbol on the same numbers. Changing it never converts anything — the amounts stay as they are."
          >
            <View style={styles.currencyRow}>
              <Text style={{ color: theme.label, fontSize: 17, fontWeight: '700' }}>
                {currencySymbol(currencyState.currency)}  {currencyState.currency}
              </Text>
              {currencyState.source === 'shared' && (
                <Text style={{ color: theme.tertiaryLabel, fontSize: 12, fontWeight: '600' }}>SHARED</Text>
              )}
            </View>
            <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>
              {describeSharedCurrency(currencyState)}
            </Text>
            {/* Shown in the two cases where pressing it would actually change
                something: this device's own preference is being overridden by
                the shared one, or the household has no shared currency yet and
                somebody has to set the first. Hidden when the shared value
                already IS this device's, where it would be a button that does
                nothing to a setting people are right to be careful with. */}
            {(currencyState.local !== currencyState.currency || !currencyState.shared) && (
              <Button
                label={`Use ${currencyState.local} for everyone`}
                onPress={doAdoptLocalCurrency}
                variant="tonal"
                loading={busy === 'currency'}
                disabled={!!busy && busy !== 'currency'}
                accessibilityLabel={
                  currencyState.shared
                    ? `Use ${currencyState.local} for everyone in this shared budget, instead of ${currencyState.currency}`
                    : `Set ${currencyState.local} as the currency for everyone in this shared budget`
                }
              />
            )}
          </GroupedSection>
        )}

        <GroupedSection
          header="Invite someone"
          footnote="They open KaiJar, go to Settings → Sharing, choose Share with someone, and enter this code. Codes last 7 days."
        >
          {alone && (
            <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>
              You are the only person in this budget. Send a code to share it — there is no need to turn sync off or start
              a new budget.
            </Text>
          )}
          {invite ? (
            <>
              <Text selectable style={[styles.code, { color: theme.label, backgroundColor: theme.fieldBackground }]}>
                {invite}
              </Text>
              <Pressable style={styles.actionRow} onPress={doShareCode} accessibilityRole="button">
                <Ionicons name="share-outline" size={20} color={theme.accent} />
                <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Send this code</Text>
              </Pressable>
            </>
          ) : null}
          <PrimaryButton
            title={invite ? 'Create another code' : 'Create invite code'}
            onPress={doInvite}
            loading={busy === 'invite'}
            disabled={!!busy && busy !== 'invite'}
          />
        </GroupedSection>

        <GroupedSection
          header="Have a code from someone else?"
          footnote={`Joining another person's budget leaves ${currentName}. You can be in one shared budget at a time.`}
        >
          <AuthTextField
            label="Invite code"
            value={code}
            onChangeText={setCode}
            placeholder="ABCD1234"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
          <JoinModeChoice value={joinMode} onChange={setJoinMode} disabled={!!busy} />
          <PrimaryButton
            title={joinButtonTitle(joinMode)}
            onPress={doJoin}
            loading={busy === 'join'}
            disabled={!joinMode || code.trim().length < 4 || (!!busy && busy !== 'join')}
          />
        </GroupedSection>

        <GroupedSection header="Sync">
          {info && <InfoNote message={info} tone="success" />}
          <Pressable style={styles.actionRow} onPress={doSync} disabled={!!busy} accessibilityRole="button">
            <Ionicons name="sync-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Sync now</Text>
          </Pressable>
        </GroupedSection>

        {error && <InlineError message={error} />}

        <Pressable
          style={[styles.outlineButton, { borderColor: theme.accent }]}
          onPress={doPause}
          disabled={!!busy}
          accessibilityRole="button"
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>Turn off sync on this device</Text>
        </Pressable>

        {/* Leaving is offered only once we can see there IS someone else to
            leave behind. Offered while alone, it reads as the way to turn
            sharing off — and leaving to start over is what multiplied the
            households in the first place. */}
        {status.checked && status.others.length > 0 && (
          <Pressable
            style={[styles.outlineButton, { borderColor: theme.systemRed }]}
            onPress={doLeave}
            disabled={!!busy}
            accessibilityRole="button"
          >
            <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Leave this shared budget</Text>
          </Pressable>
        )}
      </KeyboardAwareScreen>
    );
  }

  // ── Sharing is off: choose a path, with the consequence of each on screen ─
  return (
    <KeyboardAwareScreen
      backgroundColor={theme.groupedBackground}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <GroupedSection header="Sharing is off" footnote="Nothing leaves this device and nobody else can see this budget.">
        <Text style={{ color: theme.label, fontSize: 15, lineHeight: 21 }}>This budget lives on this device only.</Text>
        {status.loading && !status.membershipsChecked && <ActivityIndicator color={theme.accent} />}
        {!status.loading && !status.membershipsChecked && (
          <InfoNote message="Couldn't check whether this account already belongs to a shared budget. Open this screen again when you are online, so you don't start a second one by mistake." />
        )}
      </GroupedSection>

      {status.memberships.length > 0 && (
        <GroupedSection
          header="Budgets this account is already in"
          footnote="Use one of these rather than starting a new budget — a new one is separate, and its numbers will not match theirs."
        >
          {status.memberships.map((h) => (
            <View key={h.id} style={styles.membershipRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.label, fontSize: 16, fontWeight: '600' }}>{h.name}</Text>
                <Text style={{ color: theme.secondaryLabel, fontSize: 13, marginTop: 2 }}>
                  {h.memberCount > 1 ? `${h.memberCount} people` : 'Only you'} ·{' '}
                  {h.role === 'owner' ? 'you created it' : 'you joined it'}
                </Text>
              </View>
              <Pressable onPress={() => doConnect(h)} disabled={!!busy} hitSlop={8} accessibilityRole="button">
                <Text style={{ color: theme.accent, fontWeight: '600' }}>Use it</Text>
              </Pressable>
            </View>
          ))}
        </GroupedSection>
      )}

      {/* Offered only when this account is in no household at all. With one
          already in place, "just my devices" would silently mean "join that
          household" — which may hold another person — so the list above is the
          honest control instead. */}
      {status.membershipsChecked && status.memberships.length === 0 && (
        <GroupedSection header="Just my devices" footnote="You can invite someone into it later without starting over.">
          <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>
            Your budget syncs between your own devices signed in to this account. Nobody else can see it.
          </Text>
          <PrimaryButton
            title="Turn on device sync"
            onPress={doStartDeviceSync}
            loading={busy === 'device'}
            disabled={!!busy && busy !== 'device'}
          />
        </GroupedSection>
      )}

      <GroupedSection
        header="Share with someone"
        footnote="Joining puts this device on their budget. Creating starts the shared budget from what is on this device."
      >
        <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>
          You and another person edit one budget together — the same numbers on both phones. Enter the invite code they
          sent you, or create the budget here and send them a code.
        </Text>
        <AuthTextField
          label="Invite code from them"
          value={code}
          onChangeText={setCode}
          placeholder="ABCD1234"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
        <JoinModeChoice value={joinMode} onChange={setJoinMode} disabled={!!busy} />
        <PrimaryButton
          title={joinButtonTitle(joinMode)}
          onPress={doJoin}
          loading={busy === 'join'}
          disabled={!joinMode || code.trim().length < 4 || (!!busy && busy !== 'join')}
        />
        <OrDivider />
        <AuthTextField label="Name (optional)" value={name} onChangeText={setName} placeholder="Our Household" autoCapitalize="words" />
        <PrimaryButton
          title="Create a budget and invite them"
          onPress={doCreate}
          loading={busy === 'create'}
          disabled={!!busy && busy !== 'create'}
        />
      </GroupedSection>

      {info && <InfoNote message={info} tone="success" />}
      {error && <InlineError message={error} />}
    </KeyboardAwareScreen>
  );
}

/** Plain-language answer to "am I actually sharing with anyone?". */
function membershipLine(status: HouseholdStatus): string {
  if (status.detached) return 'This account is not a member of it.';
  if (!status.checked) return status.loading ? 'Checking who is in it…' : 'Who else is in it could not be confirmed.';
  if (status.others.length === 0) return 'Just your devices. Nobody else can see this budget.';
  if (status.others.length === 1) return `Shared with ${status.others[0].email ?? '1 other person'}. You both edit the same budget.`;
  return `Shared with ${status.others.length} other people. Everyone edits the same budget.`;
}

function MemberRow({
  member,
  isYou,
  onRemove,
  removeDisabled,
}: {
  member: HouseholdMember;
  isYou: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.memberRow}>
      <Ionicons name="person-circle-outline" size={24} color={theme.secondaryLabel} />
      <Text style={{ color: theme.label, marginLeft: 8, flex: 1 }}>
        {member.email ?? 'Member'}
        {isYou ? ' (you)' : ''}
      </Text>
      {member.role === 'owner' && <Text style={{ color: theme.tertiaryLabel, fontSize: 12, fontWeight: '600' }}>OWNER</Text>}
      {onRemove && (
        <Pressable
          onPress={onRemove}
          disabled={removeDisabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.email ?? 'this person'} from the shared budget`}
          style={{ marginLeft: 12, opacity: removeDisabled ? 0.5 : 1 }}
        >
          <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The button never says only "Join" — the label carries which of the two very
 * different things is about to happen to the budget on this device. */
function joinButtonTitle(mode: JoinMode | null): string {
  if (mode === 'replace') return 'Join and replace this budget';
  if (mode === 'merge') return 'Join and keep this budget';
  return 'Choose an option above to join';
}

/**
 * The question joining never used to ask.
 *
 * Nothing is preselected: merge was the silent default and it is the one that
 * produced invisible duplicates, while replace deletes data outright. Neither is
 * safe to assume, so the join button stays disabled until the user picks.
 */
function JoinModeChoice({
  value,
  onChange,
  disabled,
}: {
  value: JoinMode | null;
  onChange: (mode: JoinMode) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: theme.label, fontSize: 15, fontWeight: '600' }}>
        What happens to the budget already on this device?
      </Text>
      <ChoiceRow
        selected={value === 'merge'}
        title="Keep it and add theirs"
        detail="Nothing here is deleted. Nothing here is sent to them either, so your existing cards and transactions stay visible on this device only, and anything the shared budget already has will appear twice."
        onPress={() => onChange('merge')}
        disabled={disabled}
      />
      <ChoiceRow
        selected={value === 'replace'}
        title="Replace it with theirs"
        detail="This device's budget is deleted and the shared one is used instead. This cannot be undone. Export a copy from Settings → Backup first if you want to keep it."
        onPress={() => onChange('replace')}
        disabled={disabled}
        destructive
      />
    </View>
  );
}

function ChoiceRow({
  selected,
  title,
  detail,
  onPress,
  disabled,
  destructive,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? theme.systemRed : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${title}. ${detail}`}
      style={[
        styles.choiceRow,
        {
          borderColor: selected ? tint : theme.separator,
          backgroundColor: selected ? theme.fieldBackground : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? tint : theme.tertiaryLabel}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.label, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: theme.secondaryLabel, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  membershipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  currencyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 44,
  },
  outlineButton: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5 },
  code: { fontSize: 22, letterSpacing: 4, padding: 14, borderRadius: radius.sm, textAlign: 'center', fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
