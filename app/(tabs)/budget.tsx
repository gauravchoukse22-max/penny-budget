import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal, Platform, KeyboardAvoidingView, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { Surface } from '../../components/Surface';
import { PressableScale } from '../../components/PressableScale';
import { NumberEditorSheet } from '../../components/NumberEditorSheet';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { CategoryIcon, CATEGORY_ICON_CHOICES } from '../../components/CategoryIcon';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { formatMonthLabel, formatCurrency, maskedAmount } from '../../lib/format';
import { notify } from '../../lib/confirm';
import { tapLight, success } from '../../lib/haptics';
import { parseMoneyInput } from '../../lib/parse-number';
import { listFunds, listFundAccounts, listFundEntries, isSavingsGoalEntry } from '../../features/funds';
import type { Fund, FundAccount, FundEntry } from '../../features/models';
import type { CategorySpendSummary, SavingsGoal } from '../../lib/models';

// What the single money-editor sheet is currently editing.
type EditorState =
  | { kind: 'limit'; id: string; name: string; value: number }
  | { kind: 'salary'; value: number }
  | { kind: 'goal'; id: string; name: string; value: number }
  | null;

/** Sum in whole cents, like lib/queries' sumAmount: the header subtracts three
 * of these sums from each other, and float drift there renders "-$0.00" as the
 * headline number of the whole screen. */
const sumCents = (values: number[]): number => values.reduce((sum, v) => sum + Math.round(v * 100), 0) / 100;

export default function BudgetScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    categorySummaries,
    settings,
    savingsGoals,
    savingsGoalAmounts,
    selectedMonth,
    surplus,
    updateSettings,
    setSalaryForSelectedMonth,
    addSavingsGoal,
    editSavingsGoal,
    removeSavingsGoal,
    setGoalTransferred,
    setSavingsGoalAmountForSelectedMonth,
    transferStatus,
    addCategory,
    removeCategory,
    setCategoryLimitForSelectedMonth,
  } = useBudget();

  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  // The Funds grid, loaded here rather than through BudgetContext: only this
  // one section needs it, and a goal's link is read-mostly.
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundAccounts, setFundAccounts] = useState<FundAccount[]>([]);
  const [fundEntries, setFundEntries] = useState<FundEntry[]>([]);
  const [linkingGoal, setLinkingGoal] = useState<SavingsGoal | null>(null);

  const loadFundData = useCallback(async () => {
    const [f, a, e] = await Promise.all([listFunds(), listFundAccounts(), listFundEntries()]);
    setFunds(f);
    setFundAccounts(a);
    setFundEntries(e);
  }, []);

  useEffect(() => {
    loadFundData();
  }, [loadFundData]);

  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  const accountName = new Map(fundAccounts.map((a) => [a.id, a.name]));

  /**
   * Contributions the user typed themselves into a goal's cell for this month.
   *
   * Ticking the box files its own entry on top rather than replacing these —
   * an entry the user typed is a real deposit and deleting it would throw away
   * history, which is the one thing the ledger exists to keep. So the row says
   * so instead of quietly making the fund look twice as full.
   */
  const manualEntriesThisMonth = (goal: SavingsGoal): number => {
    if (!goal.targetFundId || !goal.targetAccountId) return 0;
    return fundEntries.filter(
      (e) =>
        e.fundId === goal.targetFundId &&
        e.accountId === goal.targetAccountId &&
        e.date.slice(0, 7) === selectedMonth &&
        !isSavingsGoalEntry(e)
    ).length;
  };

  // ── The ledger math ────────────────────────────────────────────────────────
  // Every number here is already resolved for the SELECTED month by the
  // context: `s.category.monthlyLimit` came through resolveCategoryLimits and
  // `savingsGoalAmounts` through its twin, so past months show the plan they
  // actually had — the ledger never rewrites history when this month's numbers
  // change.
  //
  //   not yet assigned = salary − Σ category limits − Σ savings goal amounts
  //
  // `surplus.salary` is resolveSalaryForMonth's output, which already handles
  // fixed vs. variable AND the household's shared monthly salary.
  const salary = surplus.salary;
  const assignedTotal = sumCents(categorySummaries.map((s) => s.category.monthlyLimit));
  const savingsTotal = sumCents(savingsGoals.map((g) => savingsGoalAmounts.get(g.id) ?? g.monthlyAmount));
  const unassigned = sumCents([salary, -assignedTotal, -savingsTotal]);

  // The editor edits what saving will actually write: fixed mode writes the
  // every-month salary, variable mode writes this month's row.
  const currentSalary = settings.salaryMode === 'fixed' ? settings.fixedSalary : surplus.salary;

  const money = (n: number) => (settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(n, settings.currency));

  const saveEditor = async (value: number) => {
    if (!editor) return;
    if (editor.kind === 'limit') {
      await setCategoryLimitForSelectedMonth(editor.id, value);
    } else if (editor.kind === 'salary') {
      if (settings.salaryMode === 'fixed') await updateSettings({ fixedSalary: value });
      else await setSalaryForSelectedMonth(value);
    } else if (editor.kind === 'goal') {
      await setSavingsGoalAmountForSelectedMonth(editor.id, value);
    }
  };

  const addGoal = async () => {
    const amount = parseMoneyInput(goalAmount);
    if (!goalName.trim() || amount === null || !(amount > 0)) return;
    await addSavingsGoal({ name: goalName.trim(), monthlyAmount: amount });
    success();
    setGoalName('');
    setGoalAmount('');
  };

  const openSalaryEditor = () => setEditor({ kind: 'salary', value: currentSalary });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[type.title1, { color: theme.label }]}>Budget</Text>
        <MonthSwitcher />

        {/* ── Ledger header — income at the top, "not yet assigned" as the
            headline. Every row below is a claim on this number, so it lives
            above them all. */}
        <Surface>
          <View style={styles.incomeRow}>
            <Text style={[styles.sectionTitle, { color: theme.label, marginBottom: 0 }]}>Income</Text>
            <PressableScale haptic onPress={openSalaryEditor} contentStyle={styles.incomeAmountRow}>
              <AmountText amount={salary} currency={settings.currency} size={17} weight="bold" />
              <Ionicons name="pencil" size={13} color={theme.tertiaryLabel} />
            </PressableScale>
          </View>

          {salary <= 0 ? (
            // No income means no ledger — nothing to assign FROM. One tap lands
            // in the same salary editor the pencil opens.
            <Pressable onPress={openSalaryEditor} style={[styles.setSalaryPrompt, { backgroundColor: theme.accentTint }]}>
              <Ionicons name="wallet-outline" size={18} color={theme.accent} />
              <Text style={{ color: theme.accent, fontWeight: '600', flex: 1 }}>
                Set your income for {formatMonthLabel(selectedMonth)} to start assigning it.
              </Text>
            </Pressable>
          ) : (
            <>
              {unassigned >= 0 ? (
                <View style={styles.headlineBlock}>
                  <AmountText
                    amount={unassigned}
                    currency={settings.currency}
                    size={30}
                    weight="bold"
                    color={unassigned > 0 ? theme.label : theme.systemGreen}
                  />
                  <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
                    {unassigned > 0 ? 'not yet assigned' : 'every dollar assigned'}
                  </Text>
                </View>
              ) : (
                // Over-allocated. The plan promises money the month doesn't
                // have, so say it in one sentence rather than a bare negative.
                <View style={styles.headlineBlock}>
                  <Text style={{ color: theme.systemRed, fontSize: 20, fontWeight: '700' }}>
                    assigned {money(-unassigned)} more than income
                  </Text>
                </View>
              )}

              <AllocationBar salary={salary} assigned={assignedTotal} savings={savingsTotal} />
              {/* Legend under the bar — the two colored segments, named. */}
              <View style={styles.legendRow}>
                <LegendDot color={theme.accent} label={`Assigned ${money(assignedTotal)}`} />
                <LegendDot color={theme.systemGreen} label={`Savings ${money(savingsTotal)}`} />
              </View>
            </>
          )}

          {/* Fixed/variable lives with income, not in its own card — it is a
              property of the number above it. */}
          <View style={styles.salaryModeRow}>
            <Pressable
              style={[styles.modeChip, { backgroundColor: settings.salaryMode === 'fixed' ? theme.accent : theme.fieldBackground }]}
              onPress={() => {
                tapLight();
                updateSettings({ salaryMode: 'fixed' });
              }}
            >
              <Text style={{ color: settings.salaryMode === 'fixed' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Fixed</Text>
            </Pressable>
            <Pressable
              style={[styles.modeChip, { backgroundColor: settings.salaryMode === 'variable' ? theme.accent : theme.fieldBackground }]}
              onPress={() => {
                tapLight();
                updateSettings({ salaryMode: 'variable' });
              }}
            >
              <Text style={{ color: settings.salaryMode === 'variable' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Varies monthly</Text>
            </Pressable>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12, flexShrink: 1 }}>
              {settings.salaryMode === 'fixed' ? 'Every month' : `For ${formatMonthLabel(selectedMonth)}`}
            </Text>
          </View>

          {/* The call to action only appears while there is money to place —
              once everything is assigned (or over), the row would be noise. */}
          {salary > 0 && unassigned > 0 && categorySummaries.length > 0 ? (
            <Pressable
              onPress={() => {
                tapLight();
                setShowAssign(true);
              }}
              style={[styles.assignCta, { backgroundColor: theme.accentTint }]}
              accessibilityRole="button"
              accessibilityLabel={`Assign the remaining ${money(unassigned)}`}
            >
              <Text style={{ color: theme.accent, fontWeight: '700', flex: 1 }}>Assign the remaining {money(unassigned)}</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.accent} />
            </Pressable>
          ) : null}
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Categories</Text>
          {categorySummaries.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="pricetags-outline" size={28} color={theme.tertiaryLabel} />
              <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>Add a category to start setting budgets.</Text>
            </View>
          ) : (
            categorySummaries.map((s) => (
              // Light confirmation, not a heavy one: deleteCategory only nulls
              // its transactions' categoryId, so the spending survives as
              // uncategorized and nothing is actually lost.
              <SwipeToDelete
                key={s.category.id}
                onDelete={() => removeCategory(s.category.id)}
                accessibilityLabel={`Delete category ${s.category.name}`}
                confirm={{
                  title: `Delete ${s.category.name}?`,
                  message: 'Its transactions stay, and become uncategorized.',
                }}
              >
                <View style={styles.categoryRow}>
                  <Pressable onPress={() => router.push(`/category/${s.category.id}`)} style={styles.categoryTapArea}>
                    <CategoryIcon icon={s.category.icon} color={s.category.color} size={17} />
                    <View style={styles.categoryNameCol}>
                      <Text style={[styles.categoryName, { color: theme.label }]} numberOfLines={1}>
                        {s.category.name}
                      </Text>
                      {/* The hint earns its place only once the category has
                          real activity — a fresh, unbudgeted row saying
                          "$0 left" would just be clutter. */}
                      {s.spend > 0 || s.category.monthlyLimit > 0 ? <SpendHint summary={s} /> : null}
                    </View>
                  </Pressable>
                  {/* The RIGHT number is the assignment, not the spend — this
                      is the ledger's whole point. Tapping it edits the limit
                      for the selected month (snapshot semantics, so past
                      months keep theirs). */}
                  <PressableScale
                    haptic
                    onPress={() => setEditor({ kind: 'limit', id: s.category.id, name: s.category.name, value: s.category.monthlyLimit })}
                    style={styles.categoryRight}
                    contentStyle={styles.categoryRightContent}
                  >
                    {s.category.monthlyLimit > 0 ? (
                      <AmountText amount={s.category.monthlyLimit} currency={settings.currency} size={15} weight="semibold" />
                    ) : (
                      <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>Assign</Text>
                    )}
                  </PressableScale>
                </View>
              </SwipeToDelete>
            ))
          )}
          <Pressable style={styles.addRow} onPress={() => setShowAddCategory(true)}>
            <Ionicons name="add-circle" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 6, fontWeight: '600' }}>Add Category</Text>
          </Pressable>
        </Surface>

        <Surface>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.label, marginBottom: 0 }]}>Savings Goals</Text>
            {/* The tick marks a transfer for the SELECTED month, not today's. */}
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>Transferred in {formatMonthLabel(selectedMonth)}</Text>
          </View>
          {savingsGoals.map((g) => {
            const transferred = transferStatus.get(g.id) ?? false;
            const resolvedAmount = savingsGoalAmounts.get(g.id) ?? g.monthlyAmount;
            const linked = !!g.targetFundId && !!g.targetAccountId;
            const linkLabel = linked
              ? `${fundName.get(g.targetFundId!) ?? 'Deleted fund'} · ${accountName.get(g.targetAccountId!) ?? 'Deleted account'}`
              : 'Link to a fund';
            const alsoTypedIn = transferred && linked ? manualEntriesThisMonth(g) : 0;
            return (
              // Confirmation only when it would take money out of the Funds
              // grid with it: an unlinked goal is just a row, but a linked one
              // owns every contribution its ticked months filed.
              <SwipeToDelete
                key={g.id}
                onDelete={async () => {
                  await removeSavingsGoal(g.id);
                  await loadFundData();
                }}
                accessibilityLabel={`Delete savings goal ${g.name}`}
                confirm={
                  linked
                    ? {
                        title: `Delete ${g.name}?`,
                        message: `Its contributions to ${fundName.get(g.targetFundId!) ?? 'the linked fund'} are removed too.`,
                      }
                    : undefined
                }
              >
                <View style={styles.goalRow}>
                  <GoalCheck
                    transferred={transferred}
                    onToggle={async () => {
                      const next = !transferred;
                      if (next) success();
                      else tapLight();
                      await setGoalTransferred(g.id, next);
                      // The tick may have filed (or pulled) a contribution —
                      // reload so the link line reflects the grid, not a stale copy.
                      await loadFundData();
                    }}
                  />
                  <View style={styles.goalMiddle}>
                    <Text
                      style={{ color: theme.label, textDecorationLine: transferred ? 'line-through' : 'none' }}
                      numberOfLines={1}
                    >
                      {g.name}
                    </Text>
                    <Pressable
                      onPress={() => {
                        tapLight();
                        setLinkingGoal(g);
                      }}
                      hitSlop={6}
                      style={styles.goalLinkRow}
                      accessibilityRole="button"
                      accessibilityLabel={
                        linked ? `Change fund linked to ${g.name}, currently ${linkLabel}` : `Link ${g.name} to a fund`
                      }
                    >
                      <Ionicons
                        name={linked ? 'link' : 'link-outline'}
                        size={11}
                        color={linked ? theme.secondaryLabel : theme.accent}
                      />
                      <Text
                        style={{ color: linked ? theme.secondaryLabel : theme.accent, fontSize: 11, flexShrink: 1 }}
                        numberOfLines={1}
                      >
                        {linkLabel}
                      </Text>
                    </Pressable>
                    {alsoTypedIn > 0 ? (
                      <Text style={{ color: theme.systemRed, fontSize: 11 }} numberOfLines={2}>
                        Funds already has {alsoTypedIn === 1 ? 'a contribution' : `${alsoTypedIn} contributions`} you added
                        for this month — this goal's is on top.
                      </Text>
                    ) : null}
                  </View>
                  <PressableScale
                    haptic
                    onPress={() => setEditor({ kind: 'goal', id: g.id, name: g.name, value: resolvedAmount })}
                    style={[styles.goalAmountField, { backgroundColor: theme.fieldBackground }]}
                  >
                    <AmountText amount={resolvedAmount} currency={settings.currency} size={14} weight="semibold" />
                  </PressableScale>
                  <Pressable
                    onPress={async () => {
                      await removeSavingsGoal(g.id);
                      await loadFundData();
                    }}
                    style={{ marginLeft: 12 }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete savings goal ${g.name}`}
                  >
                    <Ionicons name="close-circle" size={20} color={theme.tertiaryLabel} />
                  </Pressable>
                </View>
              </SwipeToDelete>
            );
          })}
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            Amount edits apply from {formatMonthLabel(selectedMonth)} forward — past months keep their own amount.
          </Text>
          <View style={styles.goalAddRow}>
            <TextInput
              style={[styles.goalInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="Goal name"
              placeholderTextColor={theme.tertiaryLabel}
              value={goalName}
              onChangeText={setGoalName}
            />
            <TextInput
              style={[styles.goalAmountInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="$"
              placeholderTextColor={theme.tertiaryLabel}
              keyboardType="numeric"
              value={goalAmount}
              onChangeText={setGoalAmount}
            />
            <Pressable onPress={addGoal} hitSlop={8}>
              <Ionicons name="add-circle" size={28} color={theme.accent} />
            </Pressable>
          </View>
        </Surface>

        {/* Funds — savings buckets by account. Sits under Budget, next to the
            savings goals it receives contributions from, rather than in
            Insights: putting money aside is budgeting, not review. */}
        <Pressable onPress={() => router.push('/funds')} accessibilityRole="button" accessibilityLabel="Funds">
          <Surface>
            <View style={styles.fundsRow}>
              <View style={[styles.fundsIcon, { backgroundColor: theme.accentTint }]}>
                <Ionicons name="grid-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: theme.label, marginBottom: 0 }]}>Funds</Text>
                <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                  {funds.length === 0 ? 'Track savings by fund and account' : 'Saved across all funds'}
                </Text>
              </View>
              {funds.length > 0 && (
                <AmountText
                  amount={fundEntries.reduce((sum, e) => sum + e.amount, 0)}
                  currency={settings.currency}
                  size={17}
                  weight="semibold"
                />
              )}
              <Ionicons name="chevron-forward" size={16} color={theme.tertiaryLabel} />
            </View>
          </Surface>
        </Pressable>
      </ScrollView>

      <NumberEditorSheet
        visible={!!editor}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
        title={editor?.kind === 'salary' ? 'Income' : editor?.kind === 'goal' ? editor.name : editor?.kind === 'limit' ? editor.name : ''}
        subtitle={
          editor?.kind === 'limit'
            ? `Assigned for ${formatMonthLabel(selectedMonth)}`
            : editor?.kind === 'goal'
            ? `Applies from ${formatMonthLabel(selectedMonth)} forward`
            : editor?.kind === 'salary'
            ? settings.salaryMode === 'fixed'
              ? 'Applies every month'
              : `For ${formatMonthLabel(selectedMonth)}`
            : undefined
        }
        initialValue={editor?.value ?? 0}
        currency={settings.currency}
        quickAdds={editor?.kind === 'salary' ? [100, 500, 1000] : [10, 50, 100]}
        step={editor?.kind === 'salary' ? 100 : 10}
      />

      <AssignSheet
        visible={showAssign}
        onClose={() => setShowAssign(false)}
        summaries={categorySummaries}
        unassigned={unassigned}
        currency={settings.currency}
        hideAmounts={settings.hideAmounts}
        onBump={async (categoryId, nextLimit) => {
          // Same write path as the editor sheet — the snapshot upsert journals
          // for household sync, so a chip tap is never a "local-only" edit.
          await setCategoryLimitForSelectedMonth(categoryId, nextLimit);
        }}
      />

      <AddCategoryModal visible={showAddCategory} onClose={() => setShowAddCategory(false)} onSave={addCategory} usedCount={categorySummaries.length} />

      <GoalFundLinkModal
        goal={linkingGoal}
        funds={funds}
        accounts={fundAccounts}
        onClose={() => setLinkingGoal(null)}
        onSave={async (goalId, targetFundId, targetAccountId) => {
          await editSavingsGoal(goalId, { targetFundId, targetAccountId });
          await loadFundData();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * Thin stacked bar: how much of the month's income is assigned to categories
 * (accent), promised to savings (green), and still unplaced (neutral track).
 *
 * When the plan exceeds income the bar denominates by the PLAN instead, so the
 * segments still sum to a full bar — a bar that overflowed its own frame would
 * just clip invisibly.
 */
function AllocationBar({ salary, assigned, savings }: { salary: number; assigned: number; savings: number }) {
  const theme = useTheme();
  const total = Math.max(salary, assigned + savings);
  if (total <= 0) return null;
  // flex is unitless, so the raw amounts work directly as proportions.
  const free = Math.max(0, salary - assigned - savings);
  return (
    <View style={[styles.allocBar, { backgroundColor: theme.neutralTrack }]}>
      {assigned > 0 ? <View style={{ flex: assigned, backgroundColor: theme.accent }} /> : null}
      {savings > 0 ? <View style={{ flex: savings, backgroundColor: theme.systemGreen }} /> : null}
      {free > 0 ? <View style={{ flex: free }} /> : null}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={{ color: theme.secondaryLabel, fontSize: 12 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Inline "left/over" hint beside a category's name, colored by its status —
 * green/amber/red matching the summary's thresholds, so the ledger still
 * whispers how the month is going without a progress bar per row. */
function SpendHint({ summary }: { summary: CategorySpendSummary }) {
  const theme = useTheme();
  const { settings } = useBudget();
  const statusColor = summary.status === 'red' ? theme.systemRed : summary.status === 'amber' ? theme.systemAmber : theme.systemGreen;
  const value = settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(Math.abs(summary.remaining), settings.currency);
  // No limit yet: there is nothing to be "left" of, so show the spend plainly.
  if (summary.category.monthlyLimit <= 0) {
    return (
      <Text style={{ color: theme.tertiaryLabel, fontSize: 11 }} numberOfLines={1}>
        {settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(summary.spend, settings.currency)} spent
      </Text>
    );
  }
  return (
    <Text style={{ color: statusColor, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
      {summary.remaining < 0 ? `${value} over` : `${value} left`}
    </Text>
  );
}

/**
 * The "Assign the rest" sheet: every category with its current assignment and
 * three quick bumps. Deliberately simple — no drag, no keyboard — because its
 * one job is to place the leftover money in a few taps.
 *
 * The live numbers come straight from props: each bump writes through the
 * context, the context refreshes, and the re-render flows back in here. No
 * local shadow state, so this sheet can never disagree with the ledger.
 */
function AssignSheet({
  visible,
  onClose,
  summaries,
  unassigned,
  currency,
  hideAmounts,
  onBump,
}: {
  visible: boolean;
  onClose: () => void;
  summaries: CategorySpendSummary[];
  unassigned: number;
  currency: string;
  hideAmounts: boolean;
  onBump: (categoryId: string, nextLimit: number) => Promise<void>;
}) {
  const theme = useTheme();
  const money = (n: number) => (hideAmounts ? maskedAmount(currency) : formatCurrency(n, currency));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <View style={styles.assignHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: theme.label }]}>Assign the rest</Text>
            <Text style={{ color: unassigned < 0 ? theme.systemRed : theme.secondaryLabel, fontSize: 13, marginTop: 2 }}>
              {unassigned > 0
                ? `${money(unassigned)} left to assign`
                : unassigned === 0
                ? 'Every dollar assigned'
                : `${money(-unassigned)} over income`}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done assigning">
            <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.assignContent}>
          {summaries.map((s) => (
            <View key={s.category.id} style={[styles.assignRow, { borderBottomColor: theme.separator }]}>
              <View style={styles.assignRowTop}>
                <CategoryIcon icon={s.category.icon} color={s.category.color} size={15} />
                <Text style={{ color: theme.label, fontWeight: '500', flex: 1 }} numberOfLines={1}>
                  {s.category.name}
                </Text>
                <AmountText amount={s.category.monthlyLimit} currency={currency} size={14} weight="semibold" />
              </View>
              <View style={styles.assignChipRow}>
                {[25, 50, 100].map((step) => (
                  <Pressable
                    key={step}
                    onPress={() => {
                      tapLight();
                      onBump(s.category.id, s.category.monthlyLimit + step);
                    }}
                    style={[styles.assignChip, { backgroundColor: theme.accentTint }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${step} to ${s.category.name}`}
                  >
                    <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>+{money(step)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One selectable fund or account in the link sheet. Tapping the selected one
 * again clears it, so a mis-tap doesn't need a separate "none" row. */
function LinkOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        tapLight();
        onPress();
      }}
      style={[styles.linkOption, { backgroundColor: selected ? theme.accentTint : theme.fieldBackground }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={{ color: selected ? theme.accent : theme.label, fontWeight: selected ? '700' : '400', flex: 1 }}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={16} color={theme.accent} /> : null}
    </Pressable>
  );
}

/**
 * Picks the Funds-grid cell a savings goal pays into.
 *
 * Both halves are required because a contribution has to land somewhere
 * specific: the fund is which pot, the account is which institution actually
 * holds it. Nothing is guessed from the goal's name — a wrong guess would file
 * real money into the wrong pot, and the user would have no reason to look.
 */
function GoalFundLinkModal({
  goal,
  funds,
  accounts,
  onClose,
  onSave,
}: {
  goal: SavingsGoal | null;
  funds: Fund[];
  accounts: FundAccount[];
  onClose: () => void;
  onSave: (goalId: string, fundId: string | null, accountId: string | null) => Promise<void>;
}) {
  const theme = useTheme();
  const [fundId, setFundId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  // Re-seed each time the sheet opens, so it always shows the goal's real link
  // rather than whatever the last goal was set to.
  useEffect(() => {
    setFundId(goal?.targetFundId ?? null);
    setAccountId(goal?.targetAccountId ?? null);
  }, [goal]);

  const gridIsEmpty = funds.length === 0 || accounts.length === 0;
  // Half a link files nothing, so it isn't a state worth saving.
  const canSave = (!!fundId && !!accountId) || (!fundId && !accountId);

  const commit = async () => {
    if (!goal || !canSave) return;
    const linked = !!fundId && !!accountId;
    await onSave(goal.id, linked ? fundId : null, linked ? accountId : null);
    success();
    onClose();
  };

  return (
    <Modal visible={!!goal} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <View style={styles.linkHeader}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[type.headline, { color: theme.label }]} numberOfLines={1}>
            {goal?.name ?? ''}
          </Text>
          <Pressable onPress={commit} hitSlop={10} disabled={!canSave}>
            <Text style={{ color: canSave ? theme.accent : theme.tertiaryLabel, fontSize: 16, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.linkContent}>
          <Text style={[styles.linkIntro, { color: theme.secondaryLabel }]}>
            Ticking this goal's monthly transfer files the amount into the Funds grid for you, noting which month it was
            budgeted for. Every month already ticked is filed too, and unticking takes it back out.
          </Text>

          {gridIsEmpty ? (
            <View style={styles.emptyState}>
              <Ionicons name="grid-outline" size={28} color={theme.tertiaryLabel} />
              <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>
                Open the Funds tab first — a goal can only be linked once you have at least one fund and one account.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.linkSectionTitle, { color: theme.label }]}>Fund</Text>
              {funds.map((f) => (
                <LinkOption
                  key={f.id}
                  label={f.name}
                  selected={fundId === f.id}
                  onPress={() => setFundId(fundId === f.id ? null : f.id)}
                />
              ))}

              <Text style={[styles.linkSectionTitle, { color: theme.label }]}>Held at</Text>
              {accounts.map((a) => (
                <LinkOption
                  key={a.id}
                  label={a.name}
                  selected={accountId === a.id}
                  onPress={() => setAccountId(accountId === a.id ? null : a.id)}
                />
              ))}

              {goal?.targetFundId ? (
                <Pressable
                  onPress={() => {
                    tapLight();
                    setFundId(null);
                    setAccountId(null);
                  }}
                  style={styles.linkRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this goal's fund link"
                >
                  <Ionicons name="unlink-outline" size={16} color={theme.systemRed} />
                  <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Remove link</Text>
                </Pressable>
              ) : null}

              {!canSave ? (
                <Text style={[styles.hint, { color: theme.systemRed }]}>Pick both a fund and an account.</Text>
              ) : null}
              <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
                Unlinking removes the contributions this goal filed. Anything you typed into the grid yourself stays.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Toggle circle that pops when a goal's transfer is marked done. */
function GoalCheck({ transferred, onToggle }: { transferred: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(transferred);

  useEffect(() => {
    if (transferred && !prev.current) {
      scale.setValue(0.6);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 140 }).start();
    }
    prev.current = transferred;
  }, [transferred, scale]);

  return (
    <Pressable onPress={onToggle} hitSlop={8} style={{ marginRight: 10 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={transferred ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={transferred ? theme.systemGreen : theme.tertiaryLabel}
        />
      </Animated.View>
    </Pressable>
  );
}

function AddCategoryModal({
  visible,
  onClose,
  onSave,
  usedCount,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { name: string; icon: string; color: string; monthlyLimit: number }) => Promise<void>;
  usedCount: number;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [icon, setIcon] = useState<string>(CATEGORY_ICON_CHOICES[0]);

  const save = async () => {
    if (!name.trim()) {
      notify('Name required');
      return;
    }
    await onSave({
      name: name.trim(),
      icon,
      color: CATEGORY_PALETTE[usedCount % CATEGORY_PALETTE.length],
      monthlyLimit: parseMoneyInput(limit) ?? 0,
    });
    success();
    setName('');
    setLimit('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.groupedBackground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: theme.groupedBackground }}
        >
          <Text style={[styles.sectionTitle, { color: theme.label }]}>New Category</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Name"
            placeholderTextColor={theme.tertiaryLabel}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[styles.modalInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Monthly ideal limit"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={limit}
            onChangeText={setLimit}
          />
          <View style={styles.iconGrid}>
            {CATEGORY_ICON_CHOICES.map((ic) => (
              <Pressable key={ic} onPress={() => setIcon(ic)} style={[styles.iconChoice, { borderColor: icon === ic ? theme.accent : 'transparent' }]}>
                <CategoryIcon icon={ic} color={theme.secondaryLabel} />
              </Pressable>
            ))}
          </View>
          <View style={styles.modalButtonRow}>
            <Pressable style={[styles.modalButton, { borderColor: theme.separator }]} onPress={onClose}>
              <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalButton, { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={save}>
              <Text style={{ color: theme.onAccent, fontWeight: '600' }}>Add</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fundsIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  // ── Ledger header ─────────────────────────────────────────────────────────
  incomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  incomeAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headlineBlock: { marginTop: spacing.md, gap: 2 },
  setSalaryPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  allocBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  legendRow: { flexDirection: 'row', gap: spacing.lg, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  legendSwatch: { width: 8, height: 8, borderRadius: 4 },
  assignCta: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  // ── Assign sheet ──────────────────────────────────────────────────────────
  assignHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  assignContent: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxxl },
  assignRow: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  assignRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assignChipRow: { flexDirection: 'row', gap: 8 },
  // Comfortable one-hand tap targets — these chips are the sheet's whole UI.
  assignChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  // ── Category rows ─────────────────────────────────────────────────────────
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  categoryTapArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryNameCol: { flex: 1, gap: 2 },
  categoryRight: { alignItems: 'flex-end', paddingLeft: 8, minWidth: 64 },
  categoryRightContent: { flexDirection: 'column', alignItems: 'flex-end' },
  categoryName: { fontSize: 14, fontWeight: '500' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: spacing.lg },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.lg },
  salaryModeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  // The name and its fund link stack, so a long "Fund · Account" pair wraps
  // under the goal instead of squeezing the amount field off the row.
  goalMiddle: { flex: 1, gap: 2, paddingRight: 8 },
  goalLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
  },
  linkContent: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxxl, gap: 8 },
  linkIntro: { fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  linkSectionTitle: { fontSize: 13, fontWeight: '700', marginTop: spacing.md, marginBottom: 4 },
  linkOption: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.sm },
  linkRemove: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.md, marginTop: spacing.sm },
  goalAmountField: { minWidth: 74, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, alignItems: 'flex-end' },
  hint: { fontSize: 12, marginTop: 6 },
  goalAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  goalInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  goalAmountInput: { width: 80, padding: 10, borderRadius: radius.sm },
  modalContent: { flexGrow: 1, padding: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl },
  // Deliberately no `flex` here: goalInput's flex:1 belongs to a row, but this
  // sheet lays out in a column, where it made each field swallow the leftover
  // height until the keyboard appeared and squeezed it back.
  modalInput: { padding: spacing.md, borderRadius: radius.sm, fontSize: 16, marginBottom: spacing.md },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Border is always present (transparent when unselected) so picking an icon
  // doesn't resize the chip and reflow the grid.
  iconChoice: { borderRadius: 22, padding: 2, borderWidth: 2 },
  modalButtonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border width — the primary's just matches its
  // fill — so the filled and outlined halves are the exact same box.
  modalButton: {
    flex: 1,
    minHeight: 50,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
