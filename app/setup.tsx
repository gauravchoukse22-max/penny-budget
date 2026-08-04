import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useBudget } from '../context/BudgetContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, CATEGORY_PALETTE, spacing, radius } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';
import { Button, Chip } from '../components/Button';
import { parseMoneyInput } from '../lib/parse-number';
import { formatCurrency } from '../lib/format';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];
const STEPS = ['Currency', 'Categories', 'Salary', 'Savings', 'Cards'] as const;

/**
 * Draft-while-typing, strict-parse-on-blur money field for the category rows.
 * Committing per keystroke with a strict parser would wipe partial input
 * ("1," → 0 mid-typing); committing on blur keeps typing natural while still
 * rejecting junk — an unparseable draft reverts to the last good value.
 */
function LimitField({
  initial,
  fieldBackground,
  color,
  onCommit,
}: {
  initial: number;
  fieldBackground: string;
  color: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(initial));
  const commit = () => {
    const parsed = parseMoneyInput(draft);
    if (parsed === null) {
      setDraft(String(initial));
      return;
    }
    setDraft(String(parsed));
    onCommit(parsed);
  };
  return (
    <TextInput
      style={[styles.limitInput, { backgroundColor: fieldBackground, color }]}
      keyboardType="numeric"
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onEndEditing={commit}
    />
  );
}

export default function SetupWizard() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { categories, updateSettings, editCategory, addCategory, removeCategory, addSavingsGoal, addCard, settings, savingsGoals } = useBudget();

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
  const [goalError, setGoalError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const next = () => {
    // Leaving the Categories step: a category was left with an empty name —
    // it would render as an invisible row everywhere. Give it a name.
    if (step === 1) {
      for (const c of categories) {
        if (!c.name.trim()) editCategory(c.id, { name: 'Category' });
      }
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    await updateSettings({
      currency,
      salaryMode,
      // Strict parse: junk or negative simply means "no salary yet".
      fixedSalary: salaryMode === 'fixed' ? (parseMoneyInput(salary) ?? 0) : 0,
      onboarded: true,
    });
    router.replace('/(tabs)');
  };

  const addGoal = async () => {
    const amount = parseMoneyInput(goalAmount);
    if (!goalName.trim()) {
      setGoalError('Give the goal a name.');
      return;
    }
    if (amount === null || !(amount > 0)) {
      setGoalError('Enter a monthly amount above zero (numbers only).');
      return;
    }
    setGoalError(null);
    await addSavingsGoal({ name: goalName.trim(), monthlyAmount: amount });
    setGoalName('');
    setGoalAmount('');
    setAddedGoalCount((n) => n + 1);
  };

  const addNewCard = async () => {
    if (!cardName.trim()) {
      setCardError('Give the card a name.');
      return;
    }
    if (!/^\d{4}$/.test(cardLastFour.trim())) {
      setCardError('Last 4 digits must be exactly 4 numbers.');
      return;
    }
    setCardError(null);
    await addCard({ name: cardName.trim(), lastFour: cardLastFour.trim(), color: CATEGORY_PALETTE[addedCardCount % CATEGORY_PALETTE.length] });
    setCardName('');
    setCardLastFour('');
    setAddedCardCount((n) => n + 1);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <KeyboardAwareScreen contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={[styles.stepIndicator, { color: theme.tertiaryLabel }]}>
          Step {step + 1} of {STEPS.length}
        </Text>
        <Text style={[styles.title, { color: theme.label }]}>{STEPS[step]}</Text>

        {step === 0 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Pick your currency. You can change this later in Settings.</Text>
            <View style={styles.row}>
              {CURRENCIES.map((cur) => (
                <Chip key={cur} label={cur} selected={currency === cur} onPress={() => setCurrency(cur)} />
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
                  maxLength={40}
                  onChangeText={(text) => editCategory(c.id, { name: text })}
                />
                <LimitField
                  initial={c.monthlyLimit}
                  fieldBackground={theme.fieldBackground}
                  color={theme.label}
                  onCommit={(value) => editCategory(c.id, { monthlyLimit: value })}
                />
                <Button
                  label="Remove"
                  onPress={() => removeCategory(c.id)}
                  variant="destructive"
                  size="sm"
                  accessibilityLabel={`Remove category ${c.name}`}
                />
              </View>
            ))}
            <Button
              label="Add Category"
              icon="add"
              variant="ghost"
              size="sm"
              style={styles.inlineAction}
              onPress={() => addCategory({ name: 'New Category', icon: 'ellipsis-horizontal-circle', color: CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length], monthlyLimit: 100 })}
            />
          </View>
        )}

        {step === 2 && (
          <View style={styles.section}>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>Is your salary the same every month, or does it vary?</Text>
            <View style={styles.row}>
              <Chip label="Fixed amount" selected={salaryMode === 'fixed'} onPress={() => setSalaryMode('fixed')} />
              <Chip label="Enter each month" selected={salaryMode === 'variable'} onPress={() => setSalaryMode('variable')} />
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
            {savingsGoals.length > 0 && (
              <View style={{ marginBottom: spacing.md }}>
                {savingsGoals.map((g) => (
                  <Text key={g.id} style={{ color: theme.secondaryLabel, marginBottom: 2 }}>
                    {g.name} — {formatCurrency(g.monthlyAmount, currency)}/month
                  </Text>
                ))}
              </View>
            )}
            <View style={styles.goalAddRow}>
              <TextInput
                style={[styles.goalInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                placeholder="Goal name"
                placeholderTextColor={theme.tertiaryLabel}
                value={goalName}
                onChangeText={setGoalName}
                maxLength={40}
              />
              <TextInput
                style={[styles.goalAmountInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                placeholder="$"
                placeholderTextColor={theme.tertiaryLabel}
                keyboardType="numeric"
                value={goalAmount}
                onChangeText={setGoalAmount}
              />
              <Button label="Add" onPress={addGoal} variant="tonal" size="sm" accessibilityLabel="Add savings goal" />
            </View>
            {goalError && <Text style={{ color: theme.systemRed, marginTop: 8 }}>{goalError}</Text>}
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
              maxLength={40}
            />
            <TextInput
              style={[styles.wideInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="Last 4 digits"
              placeholderTextColor={theme.tertiaryLabel}
              keyboardType="number-pad"
              maxLength={4}
              value={cardLastFour}
              onChangeText={(text) => setCardLastFour(text.replace(/\D/g, ''))}
            />
            <Button
              label="Add Card"
              icon="add"
              onPress={addNewCard}
              variant="tonal"
              size="sm"
              style={styles.inlineAction}
            />
            {cardError && <Text style={{ color: theme.systemRed, marginTop: 8 }}>{cardError}</Text>}
            {addedCardCount > 0 && <Text style={{ color: theme.secondaryLabel, marginTop: 8 }}>{addedCardCount} card(s) added</Text>}
          </View>
        )}
      </KeyboardAwareScreen>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        {step > 0 && <Button label="Back" onPress={back} variant="glass" size="lg" style={styles.footerButton} />}
        <Button
          label={step === STEPS.length - 1 ? 'Finish' : 'Next'}
          onPress={step === STEPS.length - 1 ? finish : next}
          variant="primary"
          size="lg"
          style={styles.footerButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // paddingTop/paddingBottom come from safe-area insets at render time: this
  // screen hides the header, and Android 15 draws edge-to-edge, so hardcoded
  // padding puts the first step and the footer buttons under the system bars.
  // The extra bottom room is so the last field of a step can scroll clear of
  // the keyboard rather than stopping flush against it.
  content: { padding: 20, paddingBottom: spacing.xxxl, gap: 12 },
  stepIndicator: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  section: { gap: 12 },
  helper: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  categoryNameInput: { flex: 1, fontSize: 14 },
  limitInput: { width: 70, padding: 6, borderRadius: radius.sm, textAlign: 'right' },
  wideInput: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginTop: 4 },
  goalAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  goalAmountInput: { width: 80, padding: 10, borderRadius: radius.sm },
  footer: { flexDirection: 'row', gap: 12, padding: spacing.xl },
  footerButton: { flex: 1 },
  // Inline "add" actions sit left, like the link they replace, instead of
  // stretching the full width of the column.
  inlineAction: { alignSelf: 'flex-start' },
});
