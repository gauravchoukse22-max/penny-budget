import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, PanResponder, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { AmountText } from '../../components/AmountText';
import { AnimatedAmount } from '../../components/AnimatedAmount';
import { totalSavingsGoals } from '../../lib/queries';
import { ProgressBar } from '../../components/ProgressBar';
import { Surface } from '../../components/Surface';
import { PressableScale } from '../../components/PressableScale';
import { RemainingLabel } from '../../components/RemainingLabel';
import { TransactionRow } from '../../components/TransactionRow';
import { StreakBadge } from '../../components/FeatureCards';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { Button } from '../../components/Button';
import { daysLeftInMonth, formatCurrency } from '../../lib/format';
import { getStreaks } from '../../features/streaks-and-gamification';
import { selection, tapLight } from '../../lib/haptics';

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
    savingsGoalAmounts,
    uncategorizedCount,
  } = useBudget();

  const [streak, setStreak] = useState<{ current: number; longest: number }>({ current: 0, longest: 0 });
  useEffect(() => {
    getStreaks().then(({ logging }) =>
      setStreak({ current: logging?.currentStreak ?? 0, longest: logging?.longestStreak ?? 0 })
    );
  }, [transactions.length]);

  const [showBreakdown, setShowBreakdown] = useState(false);

  // Animated month transition — content slides + fades toward the new month.
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const animateMonth = (dir: number) => {
    slide.setValue(dir * 28);
    fade.setValue(0.35);
    Animated.parallel([
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  };
  // The swipe still lives here rather than in MonthSwitcher: it belongs to this
  // screen's ScrollView, and a pan responder inside a SectionList (Transactions)
  // fights the list's own scrolling.
  const handlePrev = () => {
    selection();
    goToPrevMonth();
    animateMonth(-1);
  };
  const handleNext = () => {
    selection();
    goToNextMonth();
    animateMonth(1);
  };

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const recent = transactions.slice(0, 5);
  const heroColor = surplus.surplus > 0 ? theme.positiveMuted : surplus.surplus < 0 ? theme.negativeMuted : theme.label;
  // The pace bar's denominator: what this month plans to spend (salary minus
  // planned savings), falling back to the category budgets' sum when no salary
  // is set. Zero means no bar — a fraction of nothing says nothing.
  const budgetedTotal = categorySummaries.reduce((sum, s) => sum + s.category.monthlyLimit, 0);
  const monthBudget = surplus.salary > 0 ? Math.max(0, surplus.salary - totalSavingsGoals(savingsGoals, savingsGoalAmounts)) : budgetedTotal;
  const daysLeft = daysLeftInMonth(selectedMonth);
  const daysInMonth = new Date(
    parseInt(selectedMonth.slice(0, 4), 10),
    parseInt(selectedMonth.slice(5, 7), 10),
    0
  ).getDate();
  const monthElapsedPct = Math.min(100, Math.max(0, ((daysInMonth - daysLeft) / daysInMonth) * 100));
  const dailyPace = daysLeft > 0 ? Math.max(0, surplus.surplus) / daysLeft : 0;
  // Same month-resolved amounts as the "Saved" figure — using the base
  // amounts here made the tile read nonsense like "$1,942 of $1,542" the
  // moment a goal's amount was edited for the month.
  const savingsTarget = totalSavingsGoals(savingsGoals, savingsGoalAmounts);

  // Scrolling this screen used to change the month by itself. The cause was
  // `onMoveShouldSetPanResponderCapture`: the CAPTURE phase runs before the
  // ScrollView can claim the touch, so this handler got first refusal on every
  // gesture and only had a threshold (dx > 15, dx > dy × 1.5) standing between
  // a scroll and a month change. A thumb arcs as it flicks, so a fast vertical
  // scroll clears 15pt sideways easily — the month then moved on release.
  //
  // The fix is the non-capture `onMoveShouldSetPanResponder`, which asks only
  // AFTER the ScrollView has declined. While the list is scrolling the
  // ScrollView owns the responder and this never runs, so a scroll cannot
  // change the month no matter how diagonal it is. Thresholds are still raised
  // for the remaining case (a drag that starts horizontal), and
  // onPanResponderTerminationRequest lets the ScrollView reclaim the gesture if
  // it turns vertical mid-drag.
  const monthSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2.5,
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (_, gesture) => {
        // Re-checked at release, not just at claim: a gesture can start
        // horizontal and end up mostly vertical, and that is a scroll.
        if (Math.abs(gesture.dx) < 60) return;
        if (Math.abs(gesture.dx) < Math.abs(gesture.dy) * 2) return;
        if (gesture.dx < 0) handleNext();
        else handlePrev();
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
        <MonthSwitcher onChange={animateMonth} />

        <Animated.View style={{ gap: spacing.lg, opacity: fade, transform: [{ translateX: slide }] }}>
          {streak.current > 0 && (
            <View style={{ alignItems: 'center' }}>
              <StreakBadge currentStreak={streak.current} longestStreak={streak.longest} />
            </View>
          )}

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

          {/* The "A+" hero: typography carries the verdict, not colored blocks.
              Four competing gradient cards became one quiet surface — the
              number is green/red/neutral, a 4pt pace line shows spend against
              the month with a tick at today, and Spent/Saved/Daily-pace sit in
              a hairline footer. "Days left" lives in the caption; the stat the
              user can act on is the per-day figure, so that gets the cell. */}
          <Surface style={styles.heroCard}>
            <Text style={[styles.heroLabel, { color: theme.secondaryLabel }]}>
              {surplus.surplus < 0 ? 'Over budget' : 'Left to spend'}
            </Text>
            <View style={styles.heroAmountWrap}>
              <AnimatedAmount
                amount={surplus.surplus < 0 ? Math.abs(surplus.surplus) : surplus.surplus}
                currency={settings.currency}
                size={44}
                weight="bold"
                color={heroColor}
              />
            </View>
            <Pressable
              onPress={() => {
                tapLight();
                setShowBreakdown((v) => !v);
              }}
              hitSlop={8}
              style={styles.breakdownToggle}
            >
              <Text style={[styles.formula, { color: theme.tertiaryLabel }]}>
                {showBreakdown
                  ? `${formatCurrency(surplus.salary, settings.currency)} in  −  ${formatCurrency(surplus.spend, settings.currency)} spent  −  ${formatCurrency(surplus.savings, settings.currency)} saved`
                  : `${formatCurrency(surplus.spend, settings.currency)} of ${formatCurrency(monthBudget, settings.currency)} spent · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
              </Text>
              <Ionicons name={showBreakdown ? 'chevron-up' : 'chevron-down'} size={12} color={theme.tertiaryLabel} />
            </Pressable>

            {/* Fill = share of the month's money spent; tick = share of the
                month's days elapsed. Fill past the tick reads instantly as
                "spending faster than the month". Only rendered when a budget
                exists — a bar with no denominator is noise. */}
            {monthBudget > 0 && (
              <View style={[styles.paceTrack, { backgroundColor: theme.fieldBackground }]}>
                <View
                  style={[
                    styles.paceFill,
                    {
                      backgroundColor: heroColor,
                      width: `${Math.min(100, (surplus.spend / monthBudget) * 100)}%`,
                    },
                  ]}
                />
                <View style={[styles.paceTick, { backgroundColor: theme.secondaryLabel, left: `${monthElapsedPct}%` }]} />
              </View>
            )}

            <View style={[styles.heroFooter, { borderTopColor: theme.separator }]}>
              <View style={styles.heroCell}>
                <Text style={[styles.heroCellLabel, { color: theme.secondaryLabel }]}>Spent</Text>
                <AmountText amount={surplus.spend} currency={settings.currency} size={15} weight="semibold" color={theme.label} />
              </View>
              <View style={styles.heroCell}>
                <Text style={[styles.heroCellLabel, { color: theme.secondaryLabel }]}>Saved</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                  <AmountText amount={surplus.savings} currency={settings.currency} size={15} weight="semibold" color={theme.label} />
                  {savingsTarget > 0 && (
                    <Text style={[styles.heroCellHint, { color: theme.tertiaryLabel }]}>of {formatCurrency(savingsTarget, settings.currency)}</Text>
                  )}
                </View>
              </View>
              <View style={[styles.heroCell, { alignItems: 'flex-end' }]}>
                <Text style={[styles.heroCellLabel, { color: theme.secondaryLabel }]}>Daily pace</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <AmountText amount={dailyPace} currency={settings.currency} size={15} weight="semibold" color={theme.label} />
                  <Text style={[styles.heroCellHint, { color: theme.tertiaryLabel }]}>/day</Text>
                </View>
              </View>
            </View>
          </Surface>

          {/* Quick access to the screens that left the tab bar. Deliberately
              flat (accentTint, no gradient) so the surplus hero stays the
              loudest thing on this screen. */}
          <View style={styles.quickRow}>
            <Button label="Budget" icon="pie-chart-outline" onPress={() => router.push('/(tabs)/budget')} variant="tonal" style={styles.quickCard} />
            <Button label="Cards" icon="card-outline" onPress={() => router.push('/(tabs)/cards')} variant="tonal" style={styles.quickCard} />
            <Button label="Insights" icon="bar-chart-outline" onPress={() => router.push('/(tabs)/insights')} variant="tonal" style={styles.quickCard} />
          </View>

          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Budget Health</Text>
            {categorySummaries.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="pie-chart-outline" size={28} color={theme.tertiaryLabel} />
                <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>Add categories to track where your money goes.</Text>
              </View>
            ) : (
              categorySummaries.map((s) => (
                <Pressable key={s.category.id} onPress={() => router.push(`/category/${s.category.id}`)} style={styles.healthRow}>
                  <Text style={[styles.healthName, { color: theme.label }]} numberOfLines={1}>
                    {s.category.name}
                  </Text>
                  <View style={styles.healthBarWrap}>
                    <ProgressBar percent={s.percent} status={s.status} />
                  </View>
                  {s.category.monthlyLimit > 0 ? (
                    <RemainingLabel remaining={s.remaining} currency={settings.currency} />
                  ) : (
                    <AmountText amount={s.spend} currency={settings.currency} size={13} color={theme.secondaryLabel} />
                  )}
                </Pressable>
              ))
            )}
          </Surface>

          <Surface>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.label }]}>Recent Transactions</Text>
              <Button
                label="See all"
                onPress={() => router.push('/(tabs)/transactions')}
                variant="ghost"
                size="sm"
                accessibilityLabel="See all transactions"
              />
            </View>
            {recent.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={28} color={theme.tertiaryLabel} />
                <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>No spending logged yet — tap + to add your first.</Text>
              </View>
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
        </Animated.View>
      </ScrollView>

      <PressableScale
        haptic
        activeScale={0.9}
        style={[styles.fab, { backgroundColor: theme.accent }]}
        onPress={() => router.push('/transaction/add')}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 110 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bannerText: { flex: 1, fontWeight: '700', fontSize: 14, color: '#FFFFFF' },
  heroCard: { gap: 6, paddingVertical: spacing.xl },
  heroLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  heroAmountWrap: { alignItems: 'center' },
  paceTrack: { height: 4, borderRadius: 2, marginTop: spacing.md, overflow: 'visible' },
  paceFill: { height: 4, borderRadius: 2 },
  // Slightly taller than the track and centered on it, so it reads as a marker
  // over the bar rather than a segment of it.
  paceTick: { position: 'absolute', top: -3, width: 1.5, height: 10, borderRadius: 1 },
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  heroCell: { gap: 2 },
  heroCellLabel: { fontSize: 11 },
  heroCellHint: { fontSize: 11 },
  breakdownToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4 },
  formula: { fontSize: 12 },
  quickRow: { flexDirection: 'row', gap: spacing.md },
  quickCard: { flex: 1 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  healthName: { width: 90, fontSize: 13, fontWeight: '500' },
  healthBarWrap: { flex: 1 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: spacing.lg },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.lg },
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
