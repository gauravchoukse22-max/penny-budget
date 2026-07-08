import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { ProgressBar } from '../../components/ProgressBar';
import { Surface } from '../../components/Surface';
import { CategoryIcon, CATEGORY_ICON_CHOICES } from '../../components/CategoryIcon';
import { formatMonthLabel } from '../../lib/format';

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
  } = useBudget();

  const [salaryDraft, setSalaryDraft] = useState(String(settings.salaryMode === 'fixed' ? settings.fixedSalary : surplus.salary));
  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);

  const saveSalary = async () => {
    const value = parseFloat(salaryDraft) || 0;
    if (settings.salaryMode === 'fixed') {
      await updateSettings({ fixedSalary: value });
    } else {
      await setSalaryForSelectedMonth(value);
    }
  };

  const addGoal = async () => {
    const amount = parseFloat(goalAmount);
    if (!goalName.trim() || !(amount > 0)) return;
    await addSavingsGoal({ name: goalName.trim(), monthlyAmount: amount });
    setGoalName('');
    setGoalAmount('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[type.title1, { color: theme.label }]}>Budget</Text>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Categories</Text>
          {categorySummaries.map((s) => (
            <Pressable key={s.category.id} onPress={() => router.push(`/category/${s.category.id}`)} style={styles.categoryRow}>
              <CategoryIcon icon={s.category.icon} color={s.category.color} size={17} />
              <View style={styles.categoryMiddle}>
                <Text style={[styles.categoryName, { color: theme.label }]}>{s.category.name}</Text>
                <ProgressBar percent={s.percent} status={s.status} />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AmountText amount={s.spend} currency={settings.currency} size={14} weight="semibold" />
                <Text style={{ color: theme.tertiaryLabel, fontSize: 11 }}>of {s.category.monthlyLimit}</Text>
              </View>
            </Pressable>
          ))}
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
              onPress={() => updateSettings({ salaryMode: 'fixed' })}
            >
              <Text style={{ color: settings.salaryMode === 'fixed' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Fixed</Text>
            </Pressable>
            <Pressable
              style={[styles.modeChip, { backgroundColor: settings.salaryMode === 'variable' ? theme.accent : theme.fieldBackground }]}
              onPress={() => updateSettings({ salaryMode: 'variable' })}
            >
              <Text style={{ color: settings.salaryMode === 'variable' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Varies monthly</Text>
            </Pressable>
          </View>
          <View style={styles.inlineInputRow}>
            <TextInput
              style={[styles.inlineInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              keyboardType="decimal-pad"
              value={salaryDraft}
              onChangeText={setSalaryDraft}
              onBlur={saveSalary}
            />
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
              {settings.salaryMode === 'fixed' ? 'Applies every month' : `For ${selectedMonth}`}
            </Text>
          </View>
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
                <Pressable onPress={() => setGoalTransferred(g.id, !transferred)} hitSlop={8} style={{ marginRight: 10 }}>
                  <Ionicons
                    name={transferred ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={transferred ? theme.systemGreen : theme.tertiaryLabel}
                  />
                </Pressable>
                <Text style={{ color: theme.label, flex: 1, textDecorationLine: transferred ? 'line-through' : 'none' }}>
                  {g.name}
                </Text>
                <GoalAmountInput
                  value={resolvedAmount}
                  onSave={(amount) => setSavingsGoalAmountForSelectedMonth(g.id, amount)}
                />
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
              keyboardType="decimal-pad"
              value={goalAmount}
              onChangeText={setGoalAmount}
            />
            <Pressable onPress={addGoal} hitSlop={8}>
              <Ionicons name="add-circle" size={28} color={theme.accent} />
            </Pressable>
          </View>
        </Surface>
      </ScrollView>

      <AddCategoryModal visible={showAddCategory} onClose={() => setShowAddCategory(false)} onSave={addCategory} usedCount={categorySummaries.length} />
    </SafeAreaView>
  );
}

function GoalAmountInput({ value, onSave }: { value: number; onSave: (amount: number) => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <TextInput
      style={[styles.goalAmountEditInput, { color: theme.label, backgroundColor: theme.fieldBackground }]}
      keyboardType="decimal-pad"
      value={draft}
      onChangeText={setDraft}
      onBlur={() => onSave(parseFloat(draft) || 0)}
    />
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
      monthlyLimit: parseFloat(limit) || 0,
    });
    setName('');
    setLimit('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
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
          keyboardType="decimal-pad"
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
          <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={save}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  categoryMiddle: { flex: 1, gap: 6 },
  categoryName: { fontSize: 14, fontWeight: '500' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  salaryModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  inlineInputRow: { gap: 4 },
  inlineInput: { padding: 12, borderRadius: radius.sm, fontSize: 18, fontWeight: '600' },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  goalAmountEditInput: { width: 70, padding: 6, borderRadius: radius.sm, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  hint: { fontSize: 12, marginTop: 6 },
  goalAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  goalInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  goalAmountInput: { width: 80, padding: 10, borderRadius: radius.sm },
  modalContent: { flex: 1, padding: 20, paddingTop: 40 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { borderRadius: 22, padding: 2 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});
