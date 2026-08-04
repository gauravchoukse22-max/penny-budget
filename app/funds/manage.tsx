import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { IconButton } from '../../components/Button';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { confirmAction } from '../../lib/confirm';
import {
  createFund,
  createFundAccount,
  deleteFund,
  deleteFundAccount,
  listFundAccounts,
  listFundEntries,
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
  // How many ledger entries each row would take with it. Counted once per load
  // rather than per confirmation, so the warning can name a real number without
  // a database round-trip sitting between the tap and the dialog.
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  // Name edits are held locally and committed on blur, so each keystroke isn't
  // a database write (and a sync journal entry) of its own.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newFund, setNewFund] = useState('');
  const [newAccount, setNewAccount] = useState('');

  const load = useCallback(async () => {
    const [f, a, entries] = await Promise.all([listFunds(), listFundAccounts(), listFundEntries()]);
    setFunds(f);
    setAccounts(a);
    // One pass covers both axes: an entry belongs to exactly one fund AND one
    // account, and deleting either end removes it.
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.fundId] = (counts[e.fundId] ?? 0) + 1;
      counts[e.accountId] = (counts[e.accountId] ?? 0) + 1;
    }
    setEntryCounts(counts);
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

  // deleteFundGridOwner cascades: the fund (or account) row goes, and so does
  // every fund_entries and fund_balances row hanging off it. Saying how many
  // entries that is turns an abstract warning into a number the user can weigh.
  const removeConfirm = (row: Row, isFund: boolean) => {
    const n = entryCounts[row.id] ?? 0;
    const where = isFund ? 'against this fund, at every account' : 'at this account, for every fund';
    return {
      title: `Delete "${row.name}"?`,
      message:
        n === 0
          ? 'Nothing has been recorded here yet. This cannot be undone.'
          : `${n} contribution${n === 1 ? '' : 's'} recorded ${where} ${n === 1 ? 'is' : 'are'} removed with it. This cannot be undone.`,
    };
  };

  const remove = async (row: Row, isFund: boolean) => {
    if (isFund) await deleteFund(row.id);
    else await deleteFundAccount(row.id);
    await load();
  };

  const confirmAndRemove = async (row: Row, isFund: boolean) => {
    const ok = await confirmAction({ ...removeConfirm(row, isFund), confirmLabel: 'Delete', destructive: true });
    if (ok) await remove(row, isFund);
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
          <SwipeToDelete
            key={row.id}
            onDelete={() => remove(row, isFund)}
            confirm={() => removeConfirm(row, isFund)}
            accessibilityLabel={`Delete ${isFund ? 'fund' : 'account'} ${row.name}`}
          >
            <View style={[styles.row, { borderBottomColor: theme.separator }]}>
              <TextInput
                style={[styles.nameInput, { color: theme.label, backgroundColor: theme.fieldBackground }]}
                value={drafts[row.id] ?? row.name}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [row.id]: v }))}
                onBlur={() => commitName(row, isFund)}
                onSubmitEditing={() => commitName(row, isFund)}
                returnKeyType="done"
              />
              <IconButton
                icon="chevron-up"
                onPress={() => move(row, -1, isFund)}
                disabled={index === 0}
                accessibilityLabel={`Move ${row.name} up`}
              />
              <IconButton
                icon="chevron-down"
                onPress={() => move(row, 1, isFund)}
                disabled={index === rows.length - 1}
                accessibilityLabel={`Move ${row.name} down`}
              />
              <IconButton
                icon="close"
                onPress={() => confirmAndRemove(row, isFund)}
                variant="destructive"
                accessibilityLabel={`Delete ${isFund ? 'fund' : 'account'} ${row.name}`}
              />
            </View>
          </SwipeToDelete>
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
        <IconButton
          icon="add"
          onPress={add}
          disabled={!draft.trim()}
          variant="tonal"
          accessibilityLabel={isFund ? 'Add fund' : 'Add account'}
        />
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
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  footer: { textAlign: 'center', fontSize: 12, lineHeight: 17 },
});
