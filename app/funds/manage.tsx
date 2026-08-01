import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { confirmAction } from '../../lib/confirm';
import {
  createFund,
  createFundAccount,
  deleteFund,
  deleteFundAccount,
  listFundAccounts,
  listFunds,
  moveFund,
  moveFundAccount,
  renameFund,
  renameFundAccount,
} from '../../features/funds';
import type { Fund, FundAccount } from '../../features/models';

type Row = Fund | FundAccount;

export default function ManageFundsScreen() {
  const theme = useTheme();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  // Name edits are held locally and committed on blur, so each keystroke isn't
  // a database write (and a sync journal entry) of its own.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newFund, setNewFund] = useState('');
  const [newAccount, setNewAccount] = useState('');

  const load = useCallback(async () => {
    const [f, a] = await Promise.all([listFunds(), listFundAccounts()]);
    setFunds(f);
    setAccounts(a);
    setDrafts({});
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const commitName = async (row: Row, isFund: boolean) => {
    const next = (drafts[row.id] ?? row.name).trim();
    if (!next || next === row.name) {
      setDrafts((d) => ({ ...d, [row.id]: row.name }));
      return;
    }
    if (isFund) await renameFund(row.id, next);
    else await renameFundAccount(row.id, next);
    await load();
  };

  const remove = async (row: Row, isFund: boolean) => {
    const ok = await confirmAction({
      title: isFund ? `Delete "${row.name}"?` : `Delete "${row.name}"?`,
      message: isFund
        ? 'Every contribution recorded against this fund, at every account, is removed with it. This cannot be undone.'
        : 'Every contribution recorded at this account, for every fund, is removed with it. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    if (isFund) await deleteFund(row.id);
    else await deleteFundAccount(row.id);
    await load();
  };

  const move = async (row: Row, delta: number, isFund: boolean) => {
    if (isFund) await moveFund(row.id, delta);
    else await moveFundAccount(row.id, delta);
    await load();
  };

  const renderSection = (
    title: string,
    caption: string,
    rows: Row[],
    isFund: boolean,
    draft: string,
    setDraft: (v: string) => void,
    add: () => Promise<void>
  ) => (
    <Surface>
      <Text style={[styles.sectionTitle, { color: theme.label }]}>{title}</Text>
      <Text style={[styles.sectionCaption, { color: theme.tertiaryLabel }]}>{caption}</Text>

      {rows.length === 0 ? (
        <Text style={{ color: theme.tertiaryLabel, paddingVertical: spacing.sm }}>Nothing here yet.</Text>
      ) : (
        rows.map((row, index) => (
          <View key={row.id} style={[styles.row, { borderBottomColor: theme.separator }]}>
            <TextInput
              style={[styles.nameInput, { color: theme.label, backgroundColor: theme.fieldBackground }]}
              value={drafts[row.id] ?? row.name}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [row.id]: v }))}
              onBlur={() => commitName(row, isFund)}
              onSubmitEditing={() => commitName(row, isFund)}
              returnKeyType="done"
            />
            <Pressable onPress={() => move(row, -1, isFund)} disabled={index === 0} hitSlop={6} style={styles.iconButton}>
              <Ionicons name="chevron-up" size={18} color={index === 0 ? theme.tertiaryLabel : theme.secondaryLabel} />
            </Pressable>
            <Pressable
              onPress={() => move(row, 1, isFund)}
              disabled={index === rows.length - 1}
              hitSlop={6}
              style={styles.iconButton}
            >
              <Ionicons
                name="chevron-down"
                size={18}
                color={index === rows.length - 1 ? theme.tertiaryLabel : theme.secondaryLabel}
              />
            </Pressable>
            <Pressable onPress={() => remove(row, isFund)} hitSlop={6} style={styles.iconButton}>
              <Ionicons name="close-circle" size={20} color={theme.tertiaryLabel} />
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.addRow}>
        <TextInput
          style={[styles.nameInput, styles.flex1, { color: theme.label, backgroundColor: theme.fieldBackground }]}
          placeholder={isFund ? 'Add a fund' : 'Add an account'}
          placeholderTextColor={theme.tertiaryLabel}
          value={draft}
          onChangeText={setDraft}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Pressable onPress={add} disabled={!draft.trim()} hitSlop={6} style={styles.iconButton}>
          <Ionicons name="add-circle" size={26} color={draft.trim() ? theme.accent : theme.tertiaryLabel} />
        </Pressable>
      </View>
    </Surface>
  );

  return (
    <KeyboardAwareScreen backgroundColor={theme.groupedBackground} contentContainerStyle={styles.content}>
      {renderSection(
        'Funds',
        'The rows of the grid — one per savings bucket.',
        funds,
        true,
        newFund,
        setNewFund,
        async () => {
          const name = newFund.trim();
          if (!name) return;
          await createFund(name);
          setNewFund('');
          await load();
        }
      )}

      {renderSection(
        'Accounts',
        'The columns — one per place you hold money.',
        accounts,
        false,
        newAccount,
        setNewAccount,
        async () => {
          const name = newAccount.trim();
          if (!name) return;
          await createFundAccount(name);
          setNewAccount('');
          await load();
        }
      )}

      <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
        Totals are added up from each fund's contributions, so renaming or reordering never changes a number.
      </Text>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  sectionCaption: { fontSize: 12, marginTop: 2, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  nameInput: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.sm, fontSize: 15 },
  flex1: { flex: 1 },
  iconButton: { padding: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  footer: { textAlign: 'center', fontSize: 12, lineHeight: 17 },
});
