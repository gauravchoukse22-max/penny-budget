import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote } from '../../components/AuthUI';
import { myHouseholds, listMembers, createInvite, type Household, type HouseholdMember } from '../../features/household';

export default function HouseholdScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConfigured, user } = useAuth();
  const { settings, createHousehold, joinHousehold, leaveHousehold, syncNow } = useBudget();

  const inHousehold = !!settings.householdId;

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [loading, setLoading] = useState(inHousehold);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Create/join form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const loadHousehold = useCallback(async () => {
    if (!settings.householdId) return;
    setLoading(true);
    try {
      const [hs, ms] = await Promise.all([myHouseholds(), listMembers(settings.householdId)]);
      setHousehold(hs.find((h) => h.id === settings.householdId) ?? null);
      setMembers(ms);
    } finally {
      setLoading(false);
    }
  }, [settings.householdId]);

  useEffect(() => {
    if (inHousehold) loadHousehold();
  }, [inHousehold, loadHousehold]);

  const doCreate = () => {
    Alert.alert(
      'Create shared household?',
      'Your current budget on this device becomes the shared household budget. Anyone you invite can view and edit it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await createHousehold(name.trim() || undefined);
              if (!res.success) setError(res.message);
              else await loadHousehold();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const doJoin = () => {
    Alert.alert(
      'Join shared household?',
      'Your current budget on this device will be merged with the shared household budget. This cannot be undone — consider backing up first (Settings → Backup).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Join',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await joinHousehold(code.trim());
              if (!res.success) setError(res.message);
              else await loadHousehold();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const doInvite = async () => {
    if (!settings.householdId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createInvite(settings.householdId);
      if (res.success && res.data) setInvite(res.data);
      else setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setBusy(true);
    setInfo(null);
    try {
      await syncNow();
      setInfo('Synced.');
    } finally {
      setBusy(false);
    }
  };

  const doLeave = () => {
    Alert.alert(
      'Leave shared household?',
      'This device stops syncing with the household. The budget data already on this device stays and keeps working offline.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveHousehold();
              setHousehold(null);
              setMembers([]);
              setInvite(null);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header="Family sharing" footnote="This build doesn't have cloud accounts configured, so sharing isn't available.">
          <Text style={{ color: theme.label, fontSize: 16 }}>Sharing needs a cloud account, which isn't set up in this build.</Text>
        </GroupedSection>
      </ScrollView>
    );
  }

  if (!user) {
    return (
      <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header="Family sharing" footnote="Sign in to create or join a shared household budget you can co-edit with family.">
          <PrimaryButton title="Sign in to continue" onPress={() => router.push('/account')} />
        </GroupedSection>
      </ScrollView>
    );
  }

  // ── In a household: manage ────────────────────────────────────────────────
  if (inHousehold) {
    return (
      <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header={household?.name ?? 'Your household'} footnote="Everyone here shares and co-edits one budget. Changes sync when the app is open.">
          {loading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            members.map((m) => (
              <View key={m.userId} style={styles.memberRow}>
                <Ionicons name="person-circle-outline" size={24} color={theme.secondaryLabel} />
                <Text style={{ color: theme.label, marginLeft: 8, flex: 1 }}>{m.email ?? 'Member'}</Text>
                {m.role === 'owner' && (
                  <Text style={{ color: theme.tertiaryLabel, fontSize: 12, fontWeight: '600' }}>OWNER</Text>
                )}
              </View>
            ))
          )}
        </GroupedSection>

        <GroupedSection header="Invite" footnote="Share this code with a family member. They enter it under Family Sharing → Join. Codes expire in 7 days.">
          {invite ? (
            <Text selectable style={[styles.code, { color: theme.label, backgroundColor: theme.fieldBackground }]}>
              {invite}
            </Text>
          ) : null}
          <PrimaryButton title={invite ? 'Create another code' : 'Create invite code'} onPress={doInvite} loading={busy} />
        </GroupedSection>

        <GroupedSection header="Sync">
          {info && <InfoNote message={info} tone="success" />}
          <Pressable style={styles.actionRow} onPress={doSync} disabled={busy}>
            <Ionicons name="sync-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Sync now</Text>
          </Pressable>
        </GroupedSection>

        {error && <InlineError message={error} />}

        <Pressable style={[styles.outlineButton, { borderColor: theme.systemRed }]} onPress={doLeave} disabled={busy}>
          <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Leave household</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── Not in a household: create or join ────────────────────────────────────
  return (
    <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Text style={[styles.intro, { color: theme.secondaryLabel }]}>
        Share one budget with your family — everyone can add transactions and see the same numbers. It stays optional; your data works offline either way.
      </Text>

      <GroupedSection header="Create a household" footnote="Starts a shared budget seeded from the budget on this device.">
        <AuthTextField label="Household name (optional)" value={name} onChangeText={setName} placeholder="Our Household" autoCapitalize="words" />
        <PrimaryButton title="Create household" onPress={doCreate} loading={busy} />
      </GroupedSection>

      <GroupedSection header="Join a household" footnote="Enter an invite code from a family member. Your current budget merges with theirs.">
        <AuthTextField label="Invite code" value={code} onChangeText={setCode} placeholder="ABCD1234" autoCapitalize="characters" autoCorrect={false} maxLength={8} />
        <PrimaryButton title="Join household" onPress={doJoin} loading={busy} disabled={code.trim().length < 4} />
      </GroupedSection>

      {error && <InlineError message={error} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  intro: { fontSize: 14, lineHeight: 20, marginHorizontal: spacing.xs },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  outlineButton: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5 },
  code: { fontSize: 22, letterSpacing: 4, padding: 14, borderRadius: radius.sm, textAlign: 'center', fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
