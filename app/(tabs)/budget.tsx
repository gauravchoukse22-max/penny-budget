import React, { useEffect, useRef, useState } from 'react';
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
import { CategoryIcon, CATEGORY_ICON_CHOICES } from '../../components/CategoryIcon';
import { formatMonthLabel, formatCurrency } from '../../lib/format';
import { confirmAction, notify } from '../../lib/confirm';
import { tapLight, success } from '../../lib/haptics';
import { parseMoneyInput } from '../../lib/parse-number';
import { buildAllocation, projectAllocation, confirmOverAllocation } from '../../lib/allocation';

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
    removeSavingsGoal,
    setGoalTransferred,
    setSavingsGoalAmountForSelectedMonth,
    transferStatus,
    addCategory,
    setCategoryLimitForSelectedMonth,
  } = useBudget();

  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  const currentSalary = settings.salaryMode === 'fixed' ? settings.fixedSalary : surplus.salary;

  // What the month's plan currently commits: every category budget plus every
  // savings goal, against the salary that has to cover them.
  const planRows = {
    salary: currentSalary,
    categories: categorySummaries.map((s) => ({ id: s.category.id, limit: s.category.monthlyLimit })),
    savingsGoals: savingsGoals.map((g) => ({ id: g.id, amount: savingsGoalAmounts.get(g.id) ?? g.monthlyAmount })),
  };
  const allocation = buildAllocation({
    salary: planRows.salary,
    categoryLimits: planRows.categories.map((c) => c.limit),
    savingsAmounts: planRows.savingsGoals.map((g) => g.amount),
  });

  const saveEditor = async (value: number) => {
    if (!editor) return false;
    // Check the plan *with this edit applied* before committing it, so raising
    // a budget (or dropping the salary) past what the salary covers warns first.
    const change =
      editor.kind === 'limit'
        ? ({ kind: 'category', id: editor.id, value } as const)
        : editor.kind === 'goal'
        ? ({ kind: 'savings', id: editor.id, value } as const)
        : ({ kind: 'salary', value } as const);
    if (!(await confirmOverAllocation(projectAllocation({ ...planRows, change }), settings.currency))) return false;

    if (editor.kind === 'limit') {
      await setCategoryLimitForSelectedMonth(editor.id, value);
    } else if (editor.kind === 'salary') {
      if (settings.salaryMode === 'fixed') await updateSettings({ fixedSalary: value });
      else await setSalaryForSelectedMonth(value);
    } else if (editor.kind === 'goal') {
      await setSavingsGoalAmountForSelectedMonth(editor.id, value);
    }
    return true;
  };

  const addGoal = async () => {
    const amount = parseMoneyInput(goalAmount);
    if (!goalName.trim() || amount === null || !(amount > 0)) return;
    const projected = projectAllocation({ ...planRows, change: { kind: 'savings', id: null, value: amount } });
    if (!(await confirmOverAllocation(projected, settings.currency))) return;
    await addSavingsGoal({ name: goalName.trim(), monthlyAmount: amount });
    success();
    setGoalName('');
    setGoalAmount('');
  };

  // New categories go through the same check before they're created.
  const addCategoryChecked = async (input: { name: string; icon: string; color: string; monthlyLimit: number }) => {
    const projected = projectAllocation({ ...planRows, change: { kind: 'category', id: null, value: input.monthlyLimit } });
    if (!(await confirmOverAllocation(projected, settings.currency))) return false;
    await addCategory(input);
    return true;
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
              <View key={s.category.id} style={styles.categoryRow}>
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

          <View style={[styles.allocationRow, styles.allocationDivider, { borderTopColor: theme.separator }]}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>Budgets + savings goals</Text>
            <Text style={{ color: allocation.isOver ? theme.systemRed : theme.label, fontSize: 13, fontWeight: '700' }}>
              {formatCurrency(allocation.allocated, settings.currency)}
            </Text>
          </View>
          <View style={styles.allocationRow}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
              {allocation.isOver ? 'Over your salary by' : 'Left to allocate'}
            </Text>
            <Text style={{ color: allocation.isOver ? theme.systemRed : theme.systemGreen, fontSize: 13, fontWeight: '700' }}>
              {formatCurrency(allocation.isOver ? allocation.overBy : allocation.unallocated, settings.currency)}
            </Text>
          </View>
          {allocation.isOver && currentSalary > 0 && (
            <View style={[styles.overBanner, { backgroundColor: theme.systemRed + '1A' }]}>
              <Ionicons name="alert-circle" size={16} color={theme.systemRed} />
              <Text style={{ color: theme.systemRed, fontSize: 12, flex: 1, lineHeight: 17 }}>
                Your plan spends more than you earn. Lower a category budget or savings goal, or increase your salary.
              </Text>
            </View>
          )}
        </Surface>

        <Surface>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.label, marginBottom: 0 }]}>Savings Goals</Text>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>Transferred this month</Text>
          </View>
          {savingsGoals.map((g) => {
            const transferred = transferStatus.get(g.id) ?? false;
            const resolvedAmount = savingsGoalAmounts.get(g.id) ?? g.monthlyAmount;
            return (
              <View key={g.id} style={styles.goalRow}>
                <GoalCheck
                  transferred={transferred}
                  onToggle={() => {
                    const next = !transferred;
                    if (next) success();
                    else tapLight();
                    setGoalTransferred(g.id, next);
                  }}
                />
                <Text style={{ color: theme.label, flex: 1, textDecorationLine: transferred ? 'line-through' : 'none' }}>
                  {g.name}
                </Text>
                <PressableScale
                  haptic
                  onPress={() => setEditor({ kind: 'goal', id: g.id, name: g.name, value: resolvedAmount })}
                  style={[styles.goalAmountField, { backgroundColor: theme.fieldBackground }]}
                >
                  <AmountText amount={resolvedAmount} currency={settings.currency} size={14} weight="semibold" />
                </PressableScale>
                <Pressable onPress={() => removeSavingsGoal(g.id)} style={{ marginLeft: 12 }} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color={theme.tertiaryLabel} />
                </Pressable>
              </View>
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

      <AddCategoryModal visible={showAddCategory} onClose={() => setShowAddCategory(false)} onSave={addCategoryChecked} usedCount={categorySummaries.length} />
    </SafeAreaView>
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
  /** Resolves false when the save was declined (e.g. it would blow the salary). */
  onSave: (input: { name: string; icon: string; color: string; monthlyLimit: number }) => Promise<boolean>;
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
    const saved = await onSave({
      name: name.trim(),
      icon,
      color: CATEGORY_PALETTE[usedCount % CATEGORY_PALETTE.length],
      monthlyLimit: parseMoneyInput(limit) ?? 0,
    });
    // Declined at the over-salary warning — keep the sheet open so the amount
    // can be edited instead of losing what was typed.
    if (!saved) return;
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
            style={[styles.goalInput, { backgroundColor: theme.fieldBackground, color: theme.label, marginBottom: 12 }]}
            placeholder="Name"
            placeholderTextColor={theme.tertiaryLabel}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[styles.goalInput, { backgroundColor: theme.fieldBackground, color: theme.label, marginBottom: 12 }]}
            placeholder="Monthly ideal limit"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={limit}
            onChangeText={setLimit}
          />
          <View style={styles.iconGrid}>
            {CATEGORY_ICON_CHOICES.map((ic) => (
              <Pressable key={ic} onPress={() => setIcon(ic)} style={[styles.iconChoice, icon === ic && { borderColor: theme.accent, borderWidth: 2 }]}>
                <CategoryIcon icon={ic} color={theme.secondaryLabel} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <Pressable style={[styles.button, { borderColor: theme.separator, borderWidth: 1 }]} onPress={onClose}>
              <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <PressableScale style={[styles.button, { backgroundColor: theme.accent }]} onPress={save}>
              <Text style={{ color: '#FFF', fontWeight: '600' }}>Add</Text>
            </PressableScale>
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
  allocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 2,
  },
  allocationDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12 },
  overBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: 10,
  },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  goalAmountField: { minWidth: 74, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, alignItems: 'flex-end' },
  hint: { fontSize: 12, marginTop: 6 },
  goalAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  goalInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  goalAmountInput: { width: 80, padding: 10, borderRadius: radius.sm },
  modalContent: { flexGrow: 1, padding: 20, paddingTop: 40, paddingBottom: 40 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { borderRadius: 22, padding: 2 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});
