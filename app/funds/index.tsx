import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { notify } from '../../lib/confirm';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type as typeScale } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { PressableScale } from '../../components/PressableScale';
import { FundCellSheet, type FundCellSubmission } from '../../components/FundCellSheet';
import {
  adjustFundCell,
  buildFundGrid,
  cellKey,
  createFund,
  createFundAccount,
  deleteFundEntry,
  loadFundGrid,
  seedDefaultFundsIfEmpty,
} from '../../features/funds';
import type { Fund, FundAccount, FundEntry } from '../../features/models';

// Fixed cell geometry: the pinned pane and the scrolling pane are two separate
// stacks of views, so their rows only line up if every row is exactly the same
// height on both sides.
const NAME_W = 120;
const TOTAL_W = 88;
const CELL_W = 104;
const ROW_H = 60;
const HEAD_H = 48;

type Prompt = { kind: 'fund' | 'account' } | null;

export default function FundsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useBudget();

  const [funds, setFunds] = useState<Fund[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [entries, setEntries] = useState<FundEntry[]>([]);
  const [editing, setEditing] = useState<{ fund: Fund; account: FundAccount } | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [promptDraft, setPromptDraft] = useState('');

  const load = useCallback(async () => {
    await seedDefaultFundsIfEmpty();
    // loadFundGrid runs the legacy balance → ledger backfill first, so a phone
    // upgrading with money already in the grid never sees it as zero.
    const data = await loadFundGrid();
    setFunds(data.funds);
    setAccounts(data.accounts);
    setEntries(data.entries);
  }, []);

  // Reload on focus so edits made in Manage — and anything a co-member synced
  // in while this screen was backgrounded — are reflected when we come back.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const grid = useMemo(() => buildFundGrid(funds, accounts, entries), [funds, accounts, entries]);

  // Only the open cell's own entries, newest first — the sheet lists them as
  // that cell's history.
  const editingEntries = useMemo(() => {
    if (!editing) return [];
    return entries.filter((e) => e.fundId === editing.fund.id && e.accountId === editing.account.id);
  }, [entries, editing]);

  const saveCell = async (submission: FundCellSubmission) => {
    if (!editing) return;
    // Files a signed entry rather than overwriting a total — including for
    // "Set to", which lands as the difference so the earlier deposits survive.
    await adjustFundCell({
      fundId: editing.fund.id,
      accountId: editing.account.id,
      mode: submission.mode,
      amount: submission.amount,
      date: submission.date,
      note: submission.note,
    });
    await load();
  };

  const removeEntry = async (entry: FundEntry) => {
    await deleteFundEntry(entry.id);
    await load();
  };

  const submitPrompt = async () => {
    const name = promptDraft.trim();
    if (!name || !prompt) return;
    // Say so when the write fails. Letting it throw leaves the sheet open with
    // the typed name still in it, which is indistinguishable from a dead
    // button — the user taps Add repeatedly and nothing ever explains why.
    try {
      if (prompt.kind === 'fund') await createFund(name);
      else await createFundAccount(name);
    } catch (error) {
      notify(
        prompt.kind === 'fund' ? "Couldn't add the fund" : "Couldn't add the account",
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
    setPrompt(null);
    setPromptDraft('');
    await load();
  };

  const openPrompt = (kind: 'fund' | 'account') => {
    setPromptDraft('');
    setPrompt({ kind });
  };

  const isEmpty = funds.length === 0 && accounts.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
      {/* Grand total stays out of the scroller: it's the one number he wants
          without hunting, and the totals row is a long way down the grid. */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.separator }]}>
        <View style={styles.headerTotal}>
          <Text style={[typeScale.caption, { color: theme.tertiaryLabel, letterSpacing: 0.6 }]}>ACROSS ALL FUNDS</Text>
          <AmountText amount={grid.grandTotal} currency={settings.currency} size={30} weight="bold" />
        </View>
        <View style={styles.headerActions}>
          <HeaderButton label="Fund" onPress={() => openPrompt('fund')} />
          <HeaderButton label="Account" onPress={() => openPrompt('account')} />
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <Ionicons name="grid-outline" size={40} color={theme.tertiaryLabel} />
          <Text style={[styles.emptyTitle, { color: theme.label }]}>No funds yet</Text>
          <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
            Add a fund for each savings bucket, and an account for each place you hold money.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
          <View style={styles.table}>
            {/* Pinned pane — fund name + row total. Never scrolls sideways, so
                a row can always be identified and its total read. */}
            <View style={[styles.pinned, { borderRightColor: theme.separator, backgroundColor: theme.card }]}>
              <View style={[styles.gridRow, { height: HEAD_H, borderBottomColor: theme.separator }]}>
                <View style={[styles.headCell, { width: NAME_W }]}>
                  <Text style={[styles.headText, { color: theme.secondaryLabel }]}>Fund</Text>
                </View>
                <View style={[styles.headCell, styles.alignEnd, { width: TOTAL_W }]}>
                  <Text style={[styles.headText, { color: theme.secondaryLabel }]}>Total</Text>
                </View>
              </View>

              {funds.map((f) => (
                // The name is the way into the fund's month-by-month history —
                // that's the question the ledger exists to answer, so it gets
                // the biggest, most obvious target in the row.
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.name} history`}
                  onPress={() => router.push(`/funds/${f.id}`)}
                  style={[styles.gridRow, { height: ROW_H, borderBottomColor: theme.separator }]}
                >
                  <View style={[styles.bodyCell, { width: NAME_W }]}>
                    <Text style={[styles.nameText, { color: theme.label }]} numberOfLines={3}>
                      {f.name}
                    </Text>
                  </View>
                  <View style={[styles.bodyCell, styles.alignEnd, { width: TOTAL_W }]}>
                    <AmountText
                      amount={grid.rowTotals.get(f.id) ?? 0}
                      currency={settings.currency}
                      size={13}
                      weight="semibold"
                    />
                  </View>
                </Pressable>
              ))}

              <View
                style={[styles.gridRow, { height: ROW_H, backgroundColor: theme.accentTint, borderBottomColor: theme.separator }]}
              >
                <View style={[styles.bodyCell, { width: NAME_W }]}>
                  <Text style={[styles.totalLabel, { color: theme.label }]}>Total</Text>
                </View>
                <View style={[styles.bodyCell, styles.alignEnd, { width: TOTAL_W }]}>
                  <AmountText amount={grid.grandTotal} currency={settings.currency} size={13} weight="bold" />
                </View>
              </View>
            </View>

            {/* Scrolling pane — one column per account. */}
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scrollPane}>
              <View>
                <View style={[styles.gridRow, { height: HEAD_H, borderBottomColor: theme.separator }]}>
                  {accounts.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => router.push('/funds/manage')}
                      style={[styles.headCell, styles.alignEnd, { width: CELL_W }]}
                    >
                      <Text style={[styles.headText, { color: theme.secondaryLabel }]} numberOfLines={2}>
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                  {accounts.length === 0 && (
                    <View style={[styles.headCell, { width: CELL_W * 2 }]}>
                      <Text style={[styles.headText, { color: theme.tertiaryLabel }]}>Add an account →</Text>
                    </View>
                  )}
                </View>

                {funds.map((f) => (
                  <View key={f.id} style={[styles.gridRow, { height: ROW_H, borderBottomColor: theme.separator }]}>
                    {accounts.map((a) => {
                      const value = grid.cells.get(cellKey(f.id, a.id));
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => setEditing({ fund: f, account: a })}
                          style={({ pressed }) => [
                            styles.bodyCell,
                            styles.alignEnd,
                            { width: CELL_W, backgroundColor: pressed ? theme.accentTint : 'transparent' },
                          ]}
                        >
                          {value === undefined ? (
                            <Text style={{ color: theme.tertiaryLabel, fontSize: 15 }}>—</Text>
                          ) : (
                            <AmountText amount={value} currency={settings.currency} size={13} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}

                <View
                style={[styles.gridRow, { height: ROW_H, backgroundColor: theme.accentTint, borderBottomColor: theme.separator }]}
              >
                  {accounts.map((a) => (
                    <View key={a.id} style={[styles.bodyCell, styles.alignEnd, { width: CELL_W }]}>
                      <AmountText
                        amount={grid.columnTotals.get(a.id) ?? 0}
                        currency={settings.currency}
                        size={13}
                        weight="bold"
                      />
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>

          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            Tap a cell to add to it, subtract from it, or set it — and leave a note saying why. Tap a fund's name to see
            what went in month by month. Swipe the columns sideways to reach the rest of your accounts.
          </Text>

          <PressableScale
            haptic
            onPress={() => router.push('/funds/manage')}
            style={[styles.manageButton, { backgroundColor: theme.card }]}
          >
            <Ionicons name="options-outline" size={18} color={theme.accent} />
            <Text style={{ color: theme.accent, fontWeight: '700' }}>Rename, reorder or remove</Text>
          </PressableScale>
        </ScrollView>
      )}

      {editing && (
        <FundCellSheet
          visible
          onClose={() => setEditing(null)}
          onSave={saveCell}
          onDeleteEntry={removeEntry}
          fundName={editing.fund.name}
          accountName={editing.account.name}
          currentAmount={grid.cells.get(cellKey(editing.fund.id, editing.account.id)) ?? 0}
          entries={editingEntries}
          currency={settings.currency}
        />
      )}

      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <KeyboardAvoidingView style={styles.promptBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.promptCard, { backgroundColor: theme.card }]}>
            <Text style={[typeScale.headline, { color: theme.label }]}>
              {prompt?.kind === 'fund' ? 'New fund' : 'New account'}
            </Text>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 13 }}>
              {prompt?.kind === 'fund' ? 'A savings bucket — a new row.' : 'Where money is held — a new column.'}
            </Text>
            <TextInput
              style={[styles.promptInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder={prompt?.kind === 'fund' ? 'e.g. Emergency' : 'e.g. Wealthfront'}
              placeholderTextColor={theme.tertiaryLabel}
              value={promptDraft}
              onChangeText={setPromptDraft}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitPrompt}
            />
            <View style={styles.promptActions}>
              <Pressable onPress={() => setPrompt(null)} hitSlop={8} style={styles.promptAction}>
                <Text style={{ color: theme.secondaryLabel, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={submitPrompt} hitSlop={8} disabled={!promptDraft.trim()} style={styles.promptAction}>
                <Text style={{ color: promptDraft.trim() ? theme.accent : theme.tertiaryLabel, fontWeight: '700' }}>Add</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale haptic onPress={onPress} style={[styles.headerButton, { backgroundColor: theme.accentTint }]}>
      <Ionicons name="add" size={15} color={theme.accent} />
      <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTotal: { flexShrink: 1, gap: 2 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  scrollBody: { paddingBottom: 48 },
  table: { flexDirection: 'row' },
  pinned: { borderRightWidth: StyleSheet.hairlineWidth },
  scrollPane: { flexGrow: 1 },
  gridRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth },
  headCell: { justifyContent: 'flex-end', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  bodyCell: { justifyContent: 'center', paddingHorizontal: spacing.sm },
  alignEnd: { alignItems: 'flex-end' },
  headText: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  nameText: { fontSize: 12, fontWeight: '500', lineHeight: 15 },
  totalLabel: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  promptBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  promptCard: { width: '100%', maxWidth: 380, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  promptInput: { padding: spacing.md, borderRadius: radius.sm, fontSize: 15, marginTop: spacing.sm },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xl, marginTop: spacing.sm },
  promptAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
});
