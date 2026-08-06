import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SheetModal } from '../../components/SheetModal';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { NetWorthTrendCard } from '../../components/NetWorthTrendCard';
import { Button } from '../../components/Button';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { AmountText } from '../../components/AmountText';
import { formatCurrency, currencySymbol, maskedAmount } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';
import { tapMedium, success } from '../../lib/haptics';
import {
  listAssets,
  listLiabilities,
  createAsset,
  updateAsset,
  deleteAsset,
  createLiability,
  updateLiability,
  deleteLiability,
  computeNetWorth,
  listNetWorthSnapshots,
  typeLabel,
  ASSET_TYPES,
  LIABILITY_TYPES,
  type Asset,
  type Liability,
  type NetWorthEntryInput,
  type NetWorthSnapshotRow,
} from '../../features/net-worth';

type Side = 'asset' | 'liability';

/** What the sheet is editing: a side plus, for edits, the existing row. */
type SheetState = { side: Side; existing: Asset | Liability | null } | null;

export default function NetWorthScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useBudget();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [snapshots, setSnapshots] = useState<NetWorthSnapshotRow[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);

  // Snapshots are re-read alongside the lists because every write path takes a
  // new one — reading them separately would leave the trend a save behind the
  // number above it.
  const load = useCallback(async () => {
    const [a, l, s] = await Promise.all([listAssets(), listLiabilities(), listNetWorthSnapshots()]);
    setAssets(a);
    setLiabilities(l);
    setSnapshots(s);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const summary = computeNetWorth(assets, liabilities);
  const empty = assets.length === 0 && liabilities.length === 0;

  const save = async (input: NetWorthEntryInput) => {
    if (!sheet) return;
    if (sheet.existing) {
      if (sheet.side === 'asset') await updateAsset(sheet.existing.id, input);
      else await updateLiability(sheet.existing.id, input);
    } else {
      if (sheet.side === 'asset') await createAsset(input);
      else await createLiability(input);
    }
    await load();
  };

  // Deleting only forgets the row — no transactions or history hang off it, so
  // the dialog can stay short. It still asks: the row was typed in by hand and
  // nothing else on screen would show it went missing.
  const removeConfirm = (item: Asset | Liability) => ({
    title: `Delete ${item.name}?`,
    message: 'It will no longer count toward your net worth.',
  });

  const removeAsset = async (item: Asset) => {
    await deleteAsset(item.id);
    await load();
  };

  const removeLiability = async (item: Liability) => {
    await deleteLiability(item.id);
    await load();
  };

  const renderRow = (item: Asset | Liability, side: Side) => (
    <SwipeToDelete
      key={item.id}
      onDelete={() => (side === 'asset' ? removeAsset(item as Asset) : removeLiability(item as Liability))}
      confirm={() => removeConfirm(item)}
      accessibilityLabel={`Delete ${side} ${item.name}`}
    >
      <Pressable
        style={styles.row}
        onPress={() => setSheet({ side, existing: item })}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.name}`}
      >
        <View style={styles.rowMiddle}>
          <Text style={[styles.rowTitle, { color: theme.label }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }} numberOfLines={1}>
            {typeLabel(side, item.type)}
            {item.note ? ` · ${item.note}` : ''}
          </Text>
        </View>
        <AmountText amount={item.balance} currency={settings.currency} size={15} weight="semibold" />
        <Ionicons name="chevron-forward" size={16} color={theme.tertiaryLabel} />
      </Pressable>
    </SwipeToDelete>
  );

  const section = (label: string, side: Side, items: (Asset | Liability)[], total: number) => (
    <Surface>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>{label}</Text>
        <AmountText amount={total} currency={settings.currency} size={15} weight="semibold" color={theme.secondaryLabel} />
      </View>
      {items.length === 0 ? (
        <Text style={{ color: theme.tertiaryLabel, paddingVertical: 4 }}>
          {side === 'asset'
            ? 'Nothing yet. Add what you own — accounts, investments, property.'
            : 'Nothing yet. Add what you owe — cards, loans, mortgage.'}
        </Text>
      ) : (
        items.map((item) => renderRow(item, side))
      )}
      <Pressable
        style={styles.addRow}
        onPress={() => setSheet({ side, existing: null })}
        accessibilityRole="button"
        accessibilityLabel={`Add ${side}`}
      >
        <Ionicons name="add-circle" size={20} color={theme.accent} />
        <Text style={{ color: theme.accent, fontWeight: '600' }}>
          {side === 'asset' ? 'Add asset' : 'Add liability'}
        </Text>
      </Pressable>
    </Surface>
  );

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headline}>
          <Text style={[styles.headlineLabel, { color: theme.secondaryLabel }]}>Net Worth</Text>
          <AmountText
            amount={summary.netWorth}
            currency={settings.currency}
            size={40}
            weight="bold"
            color={summary.netWorth < 0 ? theme.systemRed : theme.label}
          />
          {summary.asOf ? (
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
              as of {new Date(summary.asOf).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          ) : null}
        </View>

        {empty ? (
          <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
            Track everything you own and owe in one place. Balances are updated by
            hand — tap a row any time a statement arrives.
          </Text>
        ) : null}

        <NetWorthTrendCard snapshots={snapshots} currency={settings.currency} hasEntries={!empty} />

        {section('Assets', 'asset', assets, summary.assetTotal)}
        {section('Liabilities', 'liability', liabilities, summary.liabilityTotal)}

        {/* The payoff plan reads these exact rows, so the way to it belongs
            here rather than only in Settings — this is the moment the user is
            looking at what they owe. */}
        {liabilities.length > 0 ? (
          <Button
            label="Plan how to pay these off"
            icon="trending-down-outline"
            variant="tonal"
            full
            onPress={() => router.push('/planner?tab=debt')}
          />
        ) : null}

        <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
          Net worth is assets minus liabilities. Nothing here affects your budget
          or transactions.
        </Text>
      </ScrollView>

      <EntrySheet
        state={sheet}
        currency={settings.currency}
        hideAmounts={settings.hideAmounts}
        onClose={() => setSheet(null)}
        onSave={save}
      />
    </>
  );
}

/**
 * One sheet for both add and edit, both sides — patterned on NumberEditorSheet
 * (Cancel / title / Save header, big balance field) but with the name, type
 * and note fields this feature also needs.
 */
function EntrySheet({
  state,
  currency,
  hideAmounts,
  onClose,
  onSave,
}: {
  state: SheetState;
  currency: string;
  hideAmounts: boolean;
  onClose: () => void;
  onSave: (input: NetWorthEntryInput) => Promise<void>;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('other');
  const [balance, setBalance] = useState('');
  const [note, setNote] = useState('');

  const side = state?.side ?? 'asset';
  const types = side === 'asset' ? ASSET_TYPES : LIABILITY_TYPES;

  // Re-seed the fields each time the sheet opens.
  useEffect(() => {
    if (!state) return;
    setName(state.existing?.name ?? '');
    setKind(state.existing?.type ?? (state.side === 'asset' ? 'cash' : 'credit_card'));
    setBalance(state.existing ? String(state.existing.balance) : '');
    setNote(state.existing?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Strict parse, same gate as NumberEditorSheet: "1,500" is 1500, junk blocks
  // Save. Balances are magnitudes on both sides — the liability sign lives in
  // the net-worth math, so negatives are rejected here.
  const parsed = parseMoneyInput(balance);
  const invalid = balance.trim() !== '' && parsed === null;
  const canSave = name.trim().length > 0 && parsed !== null;

  const commit = async () => {
    if (!canSave || parsed === null) return;
    tapMedium();
    await onSave({ name: name.trim(), type: kind, balance: parsed, note: note.trim() || null });
    success();
    onClose();
  };

  return (
    <SheetModal visible={state !== null} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.groupedBackground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[type.headline, { color: theme.label }]}>
            {state?.existing ? 'Edit' : 'Add'} {side === 'asset' ? 'Asset' : 'Liability'}
          </Text>
          <Pressable onPress={commit} hitSlop={10} disabled={!canSave}>
            <Text style={{ color: !canSave ? theme.tertiaryLabel : theme.accent, fontSize: 16, fontWeight: '700' }}>
              Save
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder={side === 'asset' ? 'Name (e.g. Savings account)' : 'Name (e.g. Car loan)'}
            placeholderTextColor={theme.tertiaryLabel}
            value={name}
            onChangeText={setName}
            autoFocus={!state?.existing}
          />

          <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Type</Text>
          <View style={styles.chipRow}>
            {types.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => setKind(t.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === t.value }}
                style={[
                  styles.chip,
                  { backgroundColor: kind === t.value ? theme.accentTint : theme.fieldBackground },
                ]}
              >
                <Text style={{ color: kind === t.value ? theme.accent : theme.secondaryLabel, fontWeight: '600', fontSize: 13 }}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>
            {side === 'asset' ? 'Current value' : 'Amount owed'}
          </Text>
          <Text style={{ color: invalid ? theme.systemRed : theme.tertiaryLabel, fontSize: 13, marginBottom: 6 }}>
            {invalid
              ? 'Enter a valid amount'
              : hideAmounts
                ? maskedAmount(currency)
                : formatCurrency(parsed ?? 0, currency)}
          </Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.currency, { color: theme.secondaryLabel }]}>{currencySymbol(currency)}</Text>
            <TextInput
              style={[styles.balanceInput, { color: theme.label, backgroundColor: theme.fieldBackground }]}
              keyboardType="numeric"
              value={balance}
              onChangeText={setBalance}
              placeholder="0"
              placeholderTextColor={theme.tertiaryLabel}
              selectTextOnFocus
            />
          </View>

          <TextInput
            style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label, marginTop: spacing.lg }]}
            placeholder="Note (optional)"
            placeholderTextColor={theme.tertiaryLabel}
            value={note}
            onChangeText={setNote}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  headline: { alignItems: 'center', gap: 2, paddingVertical: spacing.lg },
  headlineLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowMiddle: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '500' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10 },
  footer: { textAlign: 'center', fontSize: 12 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  sheetBody: { padding: spacing.xl, paddingBottom: 60 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currency: { fontSize: 24, fontWeight: '400' },
  balanceInput: { flex: 1, padding: 12, borderRadius: radius.sm, fontSize: 24, fontWeight: '700' },
});
