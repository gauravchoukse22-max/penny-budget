import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Link, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { BANK_LINKING_ENABLED } from '../../lib/feature-flags';
import { linkBankAccount, syncLinkedBanks, unlinkBank, type LinkedItem } from '../../features/bank-link';
import { confirmAction, notify } from '../../lib/confirm';

// Linked Banks (Plaid, family-only — hidden unless EXPO_PUBLIC_BANK_LINKING=1).
// Transactions land in the local database against an auto-created Card per
// bank account; unlinking stops future syncs but keeps everything already
// imported, consistent with "your budget lives on your device".

export default function BankScreen() {
  const theme = useTheme();
  const { user, isConfigured } = useAuth();
  const { refresh } = useBudget();
  const [items, setItems] = useState<LinkedItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await syncLinkedBanks();
    if ('error' in result) {
      setItems([]);
      setLoadError(result.error);
      return;
    }
    setItems(result.items);
    if (result.imported > 0) await refresh();
  }, [refresh]);

  useEffect(() => {
    if (BANK_LINKING_ENABLED && user) load();
    else setItems([]);
  }, [user, load]);

  const doLink = async () => {
    // Explicit consent before anything leaves the device — linking is the one
    // feature that moves financial data off-device, so it must never happen
    // on a single accidental tap.
    if (await confirmAction({
      title: 'Link a bank account?',
      message: 'You’ll sign in on your bank’s own page through Plaid, our linking provider. Penny Budget never sees your bank password. Your transactions from the linked account will sync to this device through your Penny Budget account.',
      confirmLabel: 'Continue',
    })) {
      runLink();
    }
  };

  const runLink = async () => {
    setBusy(true);
    try {
      const result = await linkBankAccount();
      if (!result.linked) {
        notify('Not linked', result.message);
        return;
      }
      notify('Bank linked', `${result.institution ?? 'Your bank'} is connected. Pulling transactions…`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setBusy(true);
    try {
      const result = await syncLinkedBanks();
      if ('error' in result) {
        notify('Sync failed', result.error);
        return;
      }
      setItems(result.items);
      await refresh();
      const notes = [
        `${result.imported} new transaction(s) imported.`,
        result.cardsCreated > 0 ? `${result.cardsCreated} card(s) created for linked accounts.` : null,
        result.uncategorized > 0 ? `${result.uncategorized} need a category.` : null,
      ].filter(Boolean);
      notify('Sync complete', notes.join('\n'));
    } finally {
      setBusy(false);
    }
  };

  const doUnlink = async (item: LinkedItem) => {
    if (await confirmAction({
      title: `Unlink ${item.institution_name ?? 'this bank'}?`,
      message: 'Future transactions will stop syncing. Everything already imported stays in your budget.',
      confirmLabel: 'Unlink',
      destructive: true,
    })) {
      setBusy(true);
      try {
        const result = await unlinkBank(item.item_id);
        if (!result.removed) {
          notify('Unlink failed', result.message ?? 'Try again.');
          return;
        }
        setItems((prev) => (prev ?? []).filter((i) => i.item_id !== item.item_id));
      } finally {
        setBusy(false);
      }
    }
  };

  if (!BANK_LINKING_ENABLED) {
    return (
      <Centered theme={theme}>
        <Text style={[type.body, { color: theme.secondaryLabel, textAlign: 'center' }]}>
          Bank linking isn’t enabled in this build.
        </Text>
      </Centered>
    );
  }

  if (!isConfigured || !user) {
    return (
      <Centered theme={theme}>
        <Text style={[type.body, { color: theme.secondaryLabel, textAlign: 'center', marginBottom: spacing.lg }]}>
          Sign in to link a bank. Transactions sync privately through your own account.
        </Text>
        <Link href="/account" asChild>
          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.accent }]}>
            <Text style={[type.headline, { color: theme.onAccent }]}>Go to Sign In</Text>
          </Pressable>
        </Link>
      </Centered>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: 'Linked Banks' }} />

      {items === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xxl }} />
      ) : (
        <>
          {loadError && (
            <Surface style={styles.section}>
              <Text style={[type.subhead, { color: theme.systemRed, padding: spacing.md }]}>{loadError}</Text>
            </Surface>
          )}
          {items.length > 0 && (
            <Surface style={styles.section}>
              {items.map((item, idx) => (
                <View
                  key={item.item_id}
                  style={[styles.itemRow, idx < items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}
                >
                  <Ionicons name="business-outline" size={22} color={theme.accent} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[type.body, { color: theme.label }]}>{item.institution_name ?? 'Bank'}</Text>
                    <Text style={[type.footnote, { color: theme.secondaryLabel }]}>
                      {(item.accounts ?? []).map((a) => `${a.name}${a.mask ? ` •••• ${a.mask}` : ''}`).join(' · ')}
                    </Text>
                  </View>
                  <Pressable onPress={() => doUnlink(item)} hitSlop={8} disabled={busy}>
                    <Text style={[type.subhead, { color: theme.systemRed }]}>Unlink</Text>
                  </Pressable>
                </View>
              ))}
            </Surface>
          )}

          <Surface style={styles.section}>
            <Pressable style={styles.actionRow} onPress={doLink} disabled={busy}>
              <Ionicons name="add-circle-outline" size={22} color={theme.accent} />
              <Text style={[type.body, { color: theme.accent, marginLeft: spacing.md, fontWeight: '600' }]}>Link a bank</Text>
            </Pressable>
            {items.length > 0 && (
              <Pressable style={styles.actionRow} onPress={doSync} disabled={busy}>
                <Ionicons name="sync-outline" size={22} color={theme.accent} />
                <Text style={[type.body, { color: theme.accent, marginLeft: spacing.md, fontWeight: '600' }]}>Sync now</Text>
              </Pressable>
            )}
            {busy && <ActivityIndicator style={{ padding: spacing.md }} />}
          </Surface>

          <Text style={[type.footnote, { color: theme.tertiaryLabel, paddingHorizontal: spacing.md }]}>
            Linking opens your bank’s own sign-in through Plaid — Penny Budget never sees your bank password. New
            transactions are pulled into this device’s budget when you open the app or tap Sync now. Each linked
            account gets its own card. Unlinking keeps everything already imported.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function Centered({ theme, children }: { theme: ReturnType<typeof useTheme>; children: React.ReactNode }) {
  return (
    <View style={[styles.centered, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen options={{ title: 'Linked Banks' }} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  section: { borderRadius: radius.lg, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  primaryBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.lg, alignItems: 'center' },
});
