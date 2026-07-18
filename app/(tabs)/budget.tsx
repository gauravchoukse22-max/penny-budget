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
import { tapLight, success } from '../../lib/haptics';
import { parseMoneyInput } from '../../lib/parse-number';

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

      <AddCategoryModal visible={showAddCategory} onClose={() => setShowAddCategory(false)} onSave={addCategory} usedCount={categorySummaries.length} />
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
  onSave: (input: { name: string; icon: string; color: string; monthlyLimit: number }) => Promise<void>;
  usedCount: number;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [icon, setIcon] = useState<string>(CATEGORY_ICON_CHOICES[0]);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required');
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
