import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal, Alert, Platform, KeyboardAvoidingView, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { ProgressBar } from '../../components/ProgressBar';
import { RemainingLabel } from '../../components/RemainingLabel';
import { Surface } from '../../components/Surface';
import { PressableScale } from '../../components/PressableScale';
import { NumberEditorSheet } from '../../components/NumberEditorSheet';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { CategoryIcon, CATEGORY_ICON_CHOICES } from '../../components/CategoryIcon';
import { formatMonthLabel, formatCurrency } from '../../lib/format';
import { confirmAction, notify } from '../../lib/confirm';
import { tapLight, success } from '../../lib/haptics';
import { parseMoneyInput } from '../../lib/parse-number';
import { listFunds, listFundAccounts, listFundEntries, isSavingsGoalEntry } from '../../features/funds';
import type { Fund, FundAccount, FundEntry } from '../../features/models';
import type { SavingsGoal } from '../../lib/models';

// What the single money-editor sheet is currently editing.
type EditorState =
  | { kind: 'limit'; id: string; name: string; value: number }
  | { kind: 'salary'; value: number }
  | { kind: 'goal'; id: string; name: string; value: number }
  | null;

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

  const currentSalary = settings.salaryMode === 'fixed' ? settings.fixedSalary : surplus.salary;

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[type.title1, { color: theme.label }]}>Budget</Text>

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
                    <View style={styles.categoryMiddle}>
                      <Text style={[styles.categoryName, { color: theme.label }]}>{s.category.name}</Text>
                      <ProgressBar percent={s.percent} status={s.status} />
                    </View>
                  </Pressable>
                  <PressableScale
                    haptic
                    onPress={() => setEditor({ kind: 'limit', id: s.category.id, name: s.category.name, value: s.category.monthlyLimit })}
                    style={styles.categoryRight}
                  >
                    <AmountText amount={s.spend} currency={settings.currency} size={14} weight="semibold" />
                    {s.category.monthlyLimit > 0 ? (
                      <RemainingLabel remaining={s.remaining} currency={settings.currency} size={11} />
                    ) : (
                      <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '600' }}>Set budget</Text>
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
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Salary</Text>
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
          </View>
          <PressableScale
            haptic
            onPress={() => setEditor({ kind: 'salary', value: currentSalary })}
            style={[styles.salaryField, { backgroundColor: theme.fieldBackground }]}
          >
            <AmountText amount={currentSalary} currency={settings.currency} size={22} weight="bold" />
            <View style={styles.salaryFieldRight}>
              <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                {settings.salaryMode === 'fixed' ? 'Every month' : `For ${selectedMonth}`}
              </Text>
              <Ionicons name="pencil" size={14} color={theme.tertiaryLabel} />
            </View>
          </PressableScale>
        </Surface>

        <Surface>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.label, marginBottom: 0 }]}>Savings Goals</Text>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>Transferred this month</Text>
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
      </ScrollView>

      <NumberEditorSheet
        visible={!!editor}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
        title={editor?.kind === 'salary' ? 'Salary' : editor?.kind === 'goal' ? editor.name : editor?.kind === 'limit' ? editor.name : ''}
        subtitle={
          editor?.kind === 'limit'
            ? 'Monthly budget for this category'
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
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  categoryTapArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryMiddle: { flex: 1, gap: 6 },
  categoryRight: { alignItems: 'flex-end', gap: 2, paddingLeft: 8 },
  categoryName: { fontSize: 14, fontWeight: '500' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: spacing.lg },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.lg },
  salaryModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  salaryField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  salaryFieldRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
