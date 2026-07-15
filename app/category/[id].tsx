import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';
import { AmountText } from '../../components/AmountText';
import { TransactionRow } from '../../components/TransactionRow';
import { LineChart } from '../../components/charts/LineChart';
import { Surface } from '../../components/Surface';
import { computeCategoryTrend } from '../../lib/queries';
import { formatMonthLabel } from '../../lib/format';
import type { TrendPoint } from '../../lib/models';
import { listCategoryRules, addCategoryRule, removeCategoryRule } from '../../features/smart-categorizer';
import {
  getCategoryRolloverEnabled,
  setCategoryRolloverEnabled,
  getCategoryBudgetWithRollover,
} from '../../features/streaks-and-gamification';
import type { CategoryRule } from '../../features/models';

export default function CategoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { categories, categorySummaries, transactions, cards, settings, selectedMonth, setCategoryLimitForSelectedMonth, removeCategory } =
    useBudget();

  const category = categories.find((c) => c.id === id);
  // categorySummaries carries the limit already resolved for selectedMonth (with carry-forward) — the raw `categories` list only has the value from whenever the category was created.
  const resolvedLimit = categorySummaries.find((s) => s.category.id === id)?.category.monthlyLimit ?? category?.monthlyLimit ?? 0;
  const [limitDraft, setLimitDraft] = useState(String(resolvedLimit));
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [rolloverOn, setRolloverOn] = useState(false);
  const [rolloverAmount, setRolloverAmount] = useState(0);

  const loadRollover = React.useCallback(async () => {
    if (!id) return;
    const [enabled, info] = await Promise.all([
      getCategoryRolloverEnabled(id),
      getCategoryBudgetWithRollover(id, selectedMonth),
    ]);
    setRolloverOn(enabled);
    setRolloverAmount(info.rollover);
  }, [id, selectedMonth]);

  useEffect(() => {
    loadRollover();
  }, [loadRollover]);

  const toggleRollover = async (value: boolean) => {
    if (!id) return;
    setRolloverOn(value);
    await setCategoryRolloverEnabled(id, value);
    await loadRollover();
  };

  const loadRules = React.useCallback(async () => {
    if (!id) return;
    const all = await listCategoryRules();
    setRules(all.filter((r) => r.categoryId === id));
  }, [id]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const addRule = async () => {
    const kw = keywordDraft.trim();
    if (!kw || !id) return;
    await addCategoryRule(kw, id);
    setKeywordDraft('');
    await loadRules();
  };

  const deleteRule = async (ruleId: string) => {
    await removeCategoryRule(ruleId);
    await loadRules();
  };

  useEffect(() => {
    setLimitDraft(String(resolvedLimit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id, selectedMonth]);

  useEffect(() => {
    if (id) computeCategoryTrend(id, selectedMonth, 6).then(setTrend);
  }, [id, selectedMonth]);

  if (!category) {
    return (
      <View style={[styles.content, { backgroundColor: theme.groupedBackground }]}>
        <Text style={{ color: theme.tertiaryLabel }}>Category not found</Text>
      </View>
    );
  }

  const categoryTransactions = transactions.filter((t) => t.categoryId === category.id);
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const saveLimit = () => {
    setCategoryLimitForSelectedMonth(category.id, parseFloat(limitDraft) || 0);
  };

  const confirmDelete = () => {
    Alert.alert('Delete category?', 'Transactions will become uncategorized.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeCategory(category.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <CategoryIcon icon={category.icon} color={category.color} size={26} />
        <Text style={[styles.title, { color: theme.label }]}>{category.name}</Text>
      </View>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>6-Month Trend</Text>
        <LineChart points={trend.map((t) => ({ yearMonth: t.yearMonth, value: t.totalSpend }))} color={category.color} />
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Monthly Limit</Text>
        <View style={styles.limitRow}>
          <TextInput
            style={[styles.limitInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            keyboardType="numeric"
            value={limitDraft}
            onChangeText={setLimitDraft}
            onBlur={saveLimit}
          />
        </View>
        <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
          Applies from {formatMonthLabel(selectedMonth)} forward — past months keep their own budget.
        </Text>

        <View style={styles.rolloverRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Roll unused budget forward</Text>
            {rolloverOn && rolloverAmount > 0 && (
              <Text style={{ color: theme.systemGreen, fontSize: 12, marginTop: 2 }}>
                +{rolloverAmount.toFixed(0)} carried from last month
              </Text>
            )}
          </View>
          <Switch value={rolloverOn} onValueChange={toggleRollover} />
        </View>
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Auto-Categorize Keywords</Text>
        <Text style={[styles.hint, { color: theme.tertiaryLabel, marginTop: 0, marginBottom: 10 }]}>
          New transactions whose note contains one of these words are suggested for {category.name}.
        </Text>
        {rules.map((r) => (
          <View key={r.id} style={styles.ruleRow}>
            <Text style={{ color: theme.label, flex: 1 }}>{r.keyword}</Text>
            <Pressable onPress={() => deleteRule(r.id)} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={theme.tertiaryLabel} />
            </Pressable>
          </View>
        ))}
        <View style={styles.ruleAddRow}>
          <TextInput
            style={[styles.ruleInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Add a keyword (e.g. starbucks)"
            placeholderTextColor={theme.tertiaryLabel}
            value={keywordDraft}
            onChangeText={setKeywordDraft}
            autoCapitalize="none"
            onSubmitEditing={addRule}
          />
          <Pressable onPress={addRule} hitSlop={8}>
            <Ionicons name="add-circle" size={28} color={theme.accent} />
          </Pressable>
        </View>
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>This Month&apos;s Transactions</Text>
        {categoryTransactions.length === 0 ? (
          <Text style={{ color: theme.tertiaryLabel }}>No transactions</Text>
        ) : (
          categoryTransactions.map((t) => (
            <TransactionRow
              key={t.id}
              transaction={t}
              category={category}
              card={cardById.get(t.cardId)}
              currency={settings.currency}
              onPress={() => router.push(`/transaction/${t.id}`)}
            />
          ))
        )}
      </Surface>

      <Pressable style={[styles.deleteButton, { borderColor: theme.systemRed }]} onPress={confirmDelete}>
        <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Delete Category</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  limitRow: { flexDirection: 'row' },
  limitInput: { flex: 1, padding: 12, borderRadius: radius.sm, fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 10 },
  deleteButton: { borderWidth: 1.5, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  ruleAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  ruleInput: { flex: 1, padding: 10, borderRadius: radius.sm },
  rolloverRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
});
