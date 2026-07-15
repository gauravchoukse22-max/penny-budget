import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useBudget } from '../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];
const STEPS = ['Currency', 'Categories', 'Salary', 'Savings', 'Cards'] as const;

export default function SetupWizard() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, updateSettings, editCategory, addCategory, removeCategory, addSavingsGoal, addCard, settings } = useBudget();

  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState(settings.currency);
  const [salaryMode, setSalaryMode] = useState<'fixed' | 'variable'>('fixed');
  const [salary, setSalary] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardLastFour, setCardLastFour] = useState('');
  const [addedCardCount, setAddedCardCount] = useState(0);
  const [addedGoalCount, setAddedGoalCount] = useState(0);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    await updateSettings({
      currency,
      salaryMode,
      fixedSalary: salaryMode === 'fixed' ? parseFloat(salary) || 0 : 0,
      onboarded: true,
    });
    router.replace('/(tabs)');
  };

  const addGoal = async () => {
    const amount = parseFloat(goalAmount);
    if (!goalName.trim() || !(amount > 0)) return;
    await addSavingsGoal({ name: goalName.trim(), monthlyAmount: amount });
    setGoalName('');
    setGoalAmount('');
    setAddedGoalCount((n) => n + 1);
  };

  const addNewCard = async () => {
    if (!cardName.trim() || cardLastFour.trim().length !== 4) return;
    await addCard({ name: cardName.trim(), lastFour: cardLastFour.trim(), color: CATEGORY_PALETTE[addedCardCount % CATEGORY_PALETTE.length] });
    setCardName('');
    setCardLastFour('');
    setAddedCardCount((n) => n + 1);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.stepIndicator, { color: theme.tertiaryLabel }]}>
          Step {step + 1} of {STEPS.length}
        </Text>
        <Text style={[styles.title, { color: theme.label }]}>{STEPS[step]}</Text>

        {step === 0 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Pick your currency. You can change this later in Settings.</Text>
            <View style={styles.row}>
              {CURRENCIES.map((cur) => (
                <Pressable
                  key={cur}
                  onPress={() => setCurrency(cur)}
                  style={[styles.chip, { backgroundColor: currency === cur ? theme.accent : theme.fieldBackground }]}
                >
                  <Text style={{ color: currency === cur ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>{cur}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 1 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>
              A starter set is ready to go. Rename, remove, or add more — always editable later in Settings.
            </Text>
            {categories.map((c) => (
              <View key={c.id} style={styles.categoryRow}>
                <CategoryIcon icon={c.icon} color={c.color} size={18} />
                <TextInput
                  style={[styles.categoryNameInput, { color: theme.label }]}
                  value={c.name}
                  onChangeText={(text) => editCategory(c.id, { name: text })}
                />
                <TextInput
                  style={[styles.limitInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                  keyboardType="numeric"
                  value={String(c.monthlyLimit)}
                  onChangeText={(text) => editCategory(c.id, { monthlyLimit: parseFloat(text) || 0 })}
                />
                <Pressable onPress={() => removeCategory(c.id)}>
                  <Text style={{ color: theme.systemRed }}>Remove</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => addCategory({ name: 'New Category', icon: 'ellipsis-horizontal-circle', color: CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length], monthlyLimit: 100 })}
            >
              <Text style={{ color: theme.accent, marginTop: 8 }}>+ Add Category</Text>
            </Pressable>
          </View>
        )}

        {step === 2 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Is your salary the same every month, or does it vary?</Text>
            <View style={styles.row}>
              <Pressable style={[styles.chip, { backgroundColor: salaryMode === 'fixed' ? theme.accent : theme.fieldBackground }]} onPress={() => setSalaryMode('fixed')}>
                <Text style={{ color: salaryMode === 'fixed' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Fixed amount</Text>
              </Pressable>
              <Pressable style={[styles.chip, { backgroundColor: salaryMode === 'variable' ? theme.accent : theme.fieldBackground }]} onPress={() => setSalaryMode('variable')}>
                <Text style={{ color: salaryMode === 'variable' ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>Enter each month</Text>
              </Pressable>
            </View>
            {salaryMode === 'fixed' && (
              <TextInput
                style={[styles.wideInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                placeholder="Monthly salary"
                placeholderTextColor={theme.tertiaryLabel}
                keyboardType="numeric"
                value={salary}
                onChangeText={setSalary}
              />
            )}
          </View>
        )}

        {step === 3 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Add savings goals — skippable, editable later.</Text>
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
              <Pressable onPress={addGoal}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>Add</Text>
              </Pressable>
            </View>
            {addedGoalCount > 0 && <Text style={{ color: theme.secondaryLabel, marginTop: 8 }}>{addedGoalCount} goal(s) added</Text>}
          </View>
        )}

        {step === 4 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Add your cards — you can add more anytime in the Cards tab.</Text>
            <TextInput
              style={[styles.wideInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="Card name (e.g. Chase Sapphire)"
              placeholderTextColor={theme.tertiaryLabel}
              value={cardName}
              onChangeText={setCardName}
            />
            <TextInput
              style={[styles.wideInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="Last 4 digits"
              placeholderTextColor={theme.tertiaryLabel}
              keyboardType="number-pad"
              maxLength={4}
              value={cardLastFour}
              onChangeText={setCardLastFour}
            />
            <Pressable onPress={addNewCard}>
              <Text style={{ color: theme.accent, fontWeight: '600', marginTop: 4 }}>+ Add Card</Text>
            </Pressable>
            {addedCardCount > 0 && <Text style={{ color: theme.secondaryLabel, marginTop: 8 }}>{addedCardCount} card(s) added</Text>}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 && (
          <Pressable style={[styles.button, styles.secondaryButton, { borderColor: theme.accent }]} onPress={back}>
            <Text style={{ color: theme.accent, fontWeight: '600' }}>Back</Text>
          </Pressable>
        )}
        <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={step === STEPS.length - 1 ? finish : next}>
          <Text style={{ color: '#FFF', fontWeight: '600' }}>{step === STEPS.length - 1 ? 'Finish' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 60, gap: 12 },
  stepIndicator: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  section: { gap: 12 },
  helper: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  categoryNameInput: { flex: 1, fontSize: 14 },
  limitInput: { width: 70, padding: 6, borderRadius: radius.sm, textAlign: 'right' },
  wideInput: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginTop: 4 },
  goalAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  goalAmountInput: { width: 80, padding: 10, borderRadius: radius.sm },
  footer: { flexDirection: 'row', gap: 12, padding: spacing.xl },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  secondaryButton: { borderWidth: 1.5 },
});
