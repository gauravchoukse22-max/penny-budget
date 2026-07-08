import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, PanResponder } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { ProgressBar } from '../../components/ProgressBar';
import { Surface } from '../../components/Surface';
import { GradientCard } from '../../components/GradientCard';
import { TransactionRow } from '../../components/TransactionRow';
import { formatMonthLabel, daysLeftInMonth, formatCurrency } from '../../lib/format';
import { totalSavingsGoals } from '../../lib/queries';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    selectedMonth,
    goToPrevMonth,
    goToNextMonth,
    surplus,
    categorySummaries,
    transactions,
    categories,
    cards,
    settings,
    savingsGoals,
    uncategorizedCount,
  } = useBudget();

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const recent = transactions.slice(0, 5);
  const heroGradient = surplus.surplus > 0 ? theme.heroPositive : surplus.surplus < 0 ? theme.heroNegative : theme.heroNeutral;
  const savingsTarget = totalSavingsGoals(savingsGoals);

  const monthSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 15 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx <= -50) {
          goToNextMonth();
        } else if (gesture.dx >= 50) {
          goToPrevMonth();
        }
      },
    })
  ).current;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        {...monthSwipe.panHandlers}
      >
        <View style={styles.header}>
          <Pressable onPress={goToPrevMonth} hitSlop={12} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={20} color={theme.secondaryLabel} />
          </Pressable>
          <Text style={[type.headline, { color: theme.label }]}>{formatMonthLabel(selectedMonth)}</Text>
          <Pressable onPress={goToNextMonth} hitSlop={12} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryLabel} />
          </Pressable>
        </View>

        {uncategorizedCount > 0 && (
          <Pressable onPress={() => router.push('/(tabs)/transactions')}>
            <View style={[styles.banner, { backgroundColor: theme.systemAmber }]}>
              <Ionicons name="notifications" size={16} color="#FFFFFF" />
              <Text style={styles.bannerText}>
                {uncategorizedCount} transaction{uncategorizedCount === 1 ? '' : 's'} to review
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
        )}

        <GradientCard colors={heroGradient} style={styles.heroCard}>
          <Text style={styles.heroLabel}>Surplus</Text>
          <AmountText amount={surplus.surplus} currency={settings.currency} size={48} weight="bold" color="#FFFFFF" />
          <Text style={styles.formula}>Salary − Spend − Savings Transferred = Surplus</Text>
        </GradientCard>

        <View style={styles.statsRow}>
          <GradientCard colors={theme.statSpent} style={styles.statCard}>
            <Text style={styles.statLabel}>Spent</Text>
            <AmountText amount={surplus.spend} currency={settings.currency} size={17} weight="bold" color="#FFFFFF" />
          </GradientCard>
          <GradientCard colors={theme.statSaved} style={styles.statCard}>
            <Text style={styles.statLabel}>Saved</Text>
            <AmountText amount={surplus.savings} currency={settings.currency} size={17} weight="bold" color="#FFFFFF" />
            {savingsTarget > 0 && <Text style={styles.statHint}>of {formatCurrency(savingsTarget, settings.currency)}</Text>}
          </GradientCard>
          <GradientCard colors={theme.statDays} style={styles.statCard}>
            <Text style={styles.statLabel}>Days Left</Text>
            <Text style={styles.daysLeft}>{daysLeftInMonth(selectedMonth)}</Text>
          </GradientCard>
        </View>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Budget Health</Text>
          {categorySummaries.length === 0 ? (
            <Text style={{ color: theme.tertiaryLabel }}>No categories yet</Text>
          ) : (
            categorySummaries.map((s) => (
              <Pressable key={s.category.id} onPress={() => router.push(`/category/${s.category.id}`)} style={styles.healthRow}>
                <Text style={[styles.healthName, { color: theme.label }]} numberOfLines={1}>
                  {s.category.name}
                </Text>
                <View style={styles.healthBarWrap}>
                  <ProgressBar percent={s.percent} status={s.status} />
                </View>
                <AmountText amount={s.spend} currency={settings.currency} size={13} color={theme.secondaryLabel} />
              </Pressable>
            ))
          )}
        </Surface>

        <Surface>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Recent Transactions</Text>
            <Pressable onPress={() => router.push('/(tabs)/transactions')}>
              <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>See all</Text>
            </Pressable>
          </View>
          {recent.length === 0 ? (
            <Text style={{ color: theme.tertiaryLabel }}>No transactions yet this month</Text>
          ) : (
            recent.map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
                card={cardById.get(t.cardId)}
                currency={settings.currency}
                onPress={() => router.push(`/transaction/${t.id}`)}
              />
            ))
          )}
        </Surface>
      </ScrollView>

      <Pressable style={({ pressed }) => [styles.fab, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]} onPress={() => router.push('/transaction/add')}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 110 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xs,
  },
  monthArrow: { padding: spacing.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bannerText: { flex: 1, fontWeight: '700', fontSize: 14, color: '#FFFFFF' },
  heroCard: { alignItems: 'center', gap: 6, paddingVertical: spacing.xxl },
  heroLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(255,255,255,0.85)' },
  formula: { fontSize: 12, marginTop: 4, color: 'rgba(255,255,255,0.75)' },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  statLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  statHint: { fontSize: 10, color: 'rgba(255,255,255,0.75)' },
  daysLeft: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  healthName: { width: 90, fontSize: 13, fontWeight: '500' },
  healthBarWrap: { flex: 1 },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
});
