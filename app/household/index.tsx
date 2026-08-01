import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, ActivityIndicator, Platform, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useBudget } from '../../context/BudgetContext';
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
import { createInvite, type Household, type HouseholdMember } from '../../features/household';
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

type BusyAction = 'device' | 'join' | 'create' | 'connect' | 'invite' | 'sync' | 'pause' | 'leave';

export default function SharingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConfigured, user } = useAuth();
  const {
    settings,
    createHousehold,
    joinHousehold,
    connectToHousehold,
    startDeviceSync,
    pauseSharing,
    leaveHousehold,
    syncNow,
  } = useBudget();
  const status = useHouseholdStatus();

  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const run = async (action: BusyAction, fn: () => Promise<{ success: boolean; message: string } | void>) => {
    setBusy(action);
    setError(null);
    setInfo(null);
    try {
      const res = await fn();
      if (res && !res.success) setError(res.message);
      else if (res) setInfo(res.message);
      await status.reload();
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
        h.memberCount > 1
          ? `That budget already has ${h.memberCount} people in it. This device starts syncing with it, and what is on this device now is merged in.`
          : 'This device starts syncing with that budget, and what is on this device now is merged in.',
      confirmLabel: 'Use it',
    });
    if (!ok) return;
    run('connect', () => connectToHousehold(h.id));
  };

  // ── Join with an invite code ─────────────────────────────────────────────
  const doJoin = async () => {
    // Joining while already in a household leaves that one. Saying so here is
    // the difference between a deliberate switch and a silently split budget.
    const ok = status.sharingOn
      ? await confirmAction({
          title: `Leave ${currentName} and join the new one?`,
          message: `You can be in one shared budget at a time. This device stops syncing with ${currentName} and anyone else in it keeps their copy. The budget on this device is then merged into the new one.`,
          confirmLabel: 'Leave and join',
          destructive: true,
        })
      : await confirmAction({
          title: 'Join this shared budget?',
          message:
            'The budget on this device is merged into theirs, and from then on you both edit the same one. Back up first if you are unsure (Settings → Backup).',
          confirmLabel: 'Join',
        });
    if (!ok) return;
    await run('join', () => joinHousehold(code.trim()));
    setCode('');
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
      await Share.share({ message: `Join my Penny Budget with this code: ${invite}` });
    } catch {
      // Sharing was dismissed or is unavailable — the code stays on screen.
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
      message:
        'The budget on this device stays and keeps working offline, but it stops syncing and stops receiving their changes. The others keep the shared budget. Rejoining needs a new invite code.',
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    await run('leave', leaveHousehold);
    setInvite(null);
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
    return (
      <KeyboardAwareScreen
        backgroundColor={theme.groupedBackground}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <GroupedSection
          header="Sharing is on"
          footnote="Everyone listed here edits the same budget. Changes sync while the app is open."
        >
          <Text style={{ color: theme.label, fontSize: 17, fontWeight: '700' }}>{status.current?.name ?? 'Shared budget'}</Text>
          <Text style={{ color: theme.secondaryLabel, fontSize: 14, lineHeight: 20 }}>{membershipLine(status)}</Text>

          {status.loading && status.members.length === 0 ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            status.members.map((m) => <MemberRow key={m.userId} member={m} isYou={m.userId === user.id} />)
          )}

          {!status.loading && !status.checked && !status.detached && (
            <InfoNote message="This device is still set to sync. Open this screen again when you are online to see who else is in it." />
          )}
          {status.detached && (
            <InlineError message="This device points at a shared budget this account is no longer in, so nothing is syncing. Join again with an invite code, or turn sync off." />
          )}
        </GroupedSection>

        <GroupedSection
          header="Invite someone"
          footnote="They open Penny Budget, go to Settings → Sharing, choose Share with someone, and enter this code. Codes last 7 days."
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
          <PrimaryButton
            title="Join with this code"
            onPress={doJoin}
            loading={busy === 'join'}
            disabled={code.trim().length < 4 || (!!busy && busy !== 'join')}
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
        footnote="Joining merges this device's budget into theirs. Creating starts the shared budget from what is on this device."
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
        <PrimaryButton
          title="Join with their code"
          onPress={doJoin}
          loading={busy === 'join'}
          disabled={code.trim().length < 4 || (!!busy && busy !== 'join')}
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

function MemberRow({ member, isYou }: { member: HouseholdMember; isYou: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.memberRow}>
      <Ionicons name="person-circle-outline" size={24} color={theme.secondaryLabel} />
      <Text style={{ color: theme.label, marginLeft: 8, flex: 1 }}>
        {member.email ?? 'Member'}
        {isYou ? ' (you)' : ''}
      </Text>
      {member.role === 'owner' && <Text style={{ color: theme.tertiaryLabel, fontSize: 12, fontWeight: '600' }}>OWNER</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  membershipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  outlineButton: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5 },
  code: { fontSize: 22, letterSpacing: 4, padding: 14, borderRadius: radius.sm, textAlign: 'center', fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
