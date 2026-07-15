import React from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, type as typeScale, hexToRgba } from '../theme/colors';
import { Surface } from './Surface';
import { GradientCard } from './GradientCard';
import { AmountText } from './AmountText';
import { ProgressBar } from './ProgressBar';

// 1. StreakBadge
export function StreakBadge({ currentStreak, longestStreak }: { currentStreak: number; longestStreak: number }) {
  const theme = useTheme();
  const isRecord = currentStreak > 0 && currentStreak >= longestStreak;
  
  if (currentStreak === 0) return null;
  
  return (
    <View style={[styles.badgeRow, { backgroundColor: hexToRgba(theme.accent, 0.1) }]}>
      <Text style={{ fontSize: 13 }}>🔥</Text>
      <Text style={[typeScale.footnote, { color: theme.accent, fontWeight: '600' }]}>
        {currentStreak}-day streak
      </Text>
      {isRecord && <Text style={{ fontSize: 11 }}>⭐</Text>}
    </View>
  );
}

// 2. InMyPocketCard
export function InMyPocketCard({ amount, dailyRate, currency = 'USD' }: { amount: number; dailyRate: number; currency?: string }) {
  const theme = useTheme();
  return (
    <GradientCard colors={theme.heroNeutral} style={styles.centerCard}>
      <AmountText amount={amount} currency={currency} size={36} weight="bold" color="#FFFFFF" />
      <Text style={styles.whiteCaption}>Safe to spend right now</Text>
      <Text style={styles.whiteSubtext}>~{dailyRate > 0 ? `$${dailyRate.toFixed(0)}` : '$0'}/day for rest of month</Text>
    </GradientCard>
  );
}

// 3. SmartForecastCard
type Projection = { categoryName: string; categoryColor: string; currentSpend: number; projectedSpend: number; budgetLimit: number; status: 'on_track' | 'warning' | 'over_budget' };

export function SmartForecastCard({ projections, currency = 'USD' }: { projections: Projection[]; currency?: string }) {
  const theme = useTheme();
  const warnings = projections.filter(p => p.status !== 'on_track');
  
  return (
    <Surface style={styles.cardPadding}>
      <Text style={[typeScale.headline, { color: theme.label, marginBottom: spacing.md }]}>Smart Forecast</Text>
      
      {warnings.length === 0 ? (
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={20} color={theme.systemGreen} />
          <Text style={[typeScale.subhead, { color: theme.secondaryLabel }]}>All categories pacing well.</Text>
        </View>
      ) : (
        warnings.map((p, i) => (
          <View key={i} style={styles.projectionRow}>
            <Text style={[typeScale.subhead, { color: theme.label, marginBottom: 4 }]}>{p.categoryName}</Text>
            <ProgressBar percent={(p.projectedSpend / p.budgetLimit) * 100} status={p.status === 'warning' ? 'amber' : 'red'} />
            <Text style={[typeScale.footnote, { color: p.status === 'warning' ? theme.systemAmber : theme.systemRed, marginTop: 4 }]}>
              Pacing to ${p.projectedSpend.toFixed(0)} (Budget: ${p.budgetLimit})
            </Text>
            <Text style={[typeScale.caption, { color: theme.tertiaryLabel }]}>Based on past 3 months</Text>
          </View>
        ))
      )}
    </Surface>
  );
}

// 4. AnomalyAlertBanner
export function AnomalyAlertBanner({ explanation, severity, onDismiss }: { explanation: string; severity: 'info' | 'warning' | 'critical'; onDismiss: () => void }) {
  const theme = useTheme();
  const bg = severity === 'critical' ? theme.systemRed : severity === 'warning' ? theme.systemAmber : theme.accent;
  
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Ionicons name="warning" size={16} color="#FFFFFF" />
      <Text style={styles.bannerText}>{explanation}</Text>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Ionicons name="close" size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

// 5. BillCalendarGrid
type Event = { day: number; label: string; amount: number; type: string; color: string };
export function BillCalendarGrid({ events, daysInMonth, firstDayOfWeek }: { events: Event[]; daysInMonth: number; firstDayOfWeek: number }) {
  const theme = useTheme();
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(<View key={`empty-${i}`} style={styles.calCell} />);
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dayEvents = events.filter(e => e.day === d);
    cells.push(
      <View key={`day-${d}`} style={[styles.calCell, { backgroundColor: theme.fieldBackground }]}>
        <Text style={[typeScale.subhead, { color: theme.label }]}>{d}</Text>
        <View style={styles.dotsRow}>
          {dayEvents.slice(0, 3).map((e, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: e.color }]} />
          ))}
        </View>
      </View>
    );
  }
  
  return (
    <Surface style={styles.cardPadding}>
      <View style={styles.calHeaderRow}>
        {days.map((d, i) => <Text key={i} style={[styles.calCellHeader, { color: theme.secondaryLabel }]}>{d}</Text>)}
      </View>
      <View style={styles.calGrid}>{cells}</View>
      
      <View style={{ marginTop: spacing.md }}>
        {events.map((e, i) => (
          <View key={i} style={styles.eventRow}>
            <View style={[styles.dot, { backgroundColor: e.color, width: 8, height: 8, borderRadius: 4 }]} />
            <Text style={[typeScale.subhead, { color: theme.label, flex: 1 }]}>{e.label} (Day {e.day})</Text>
            {e.amount > 0 && <AmountText amount={e.amount} size={14} color={theme.secondaryLabel} />}
          </View>
        ))}
      </View>
    </Surface>
  );
}

// 6. NetWorthSummaryCard
export function NetWorthSummaryCard({ assets, liabilities, netWorth, currency = 'USD' }: { assets: number; liabilities: number; netWorth: number; currency?: string }) {
  const theme = useTheme();
  return (
    <Surface style={styles.cardPadding}>
      <View style={styles.rowBetween}>
        <Text style={[typeScale.subhead, { color: theme.secondaryLabel }]}>Assets</Text>
        <AmountText amount={assets} currency={currency} size={16} color={theme.systemGreen} />
      </View>
      <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
        <Text style={[typeScale.subhead, { color: theme.secondaryLabel }]}>Liabilities</Text>
        <AmountText amount={liabilities} currency={currency} size={16} color={theme.systemRed} />
      </View>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <View style={styles.rowBetween}>
        <Text style={[typeScale.headline, { color: theme.label }]}>Net Worth</Text>
        <AmountText amount={Math.abs(netWorth)} currency={currency} size={24} weight="bold" color={netWorth >= 0 ? theme.systemGreen : theme.systemRed} />
      </View>
    </Surface>
  );
}

// 7. DebtPayoffList
type Debt = { name: string; balance: number; monthlyPayment: number; monthsToPayoff: number; payoffDate: string; isTarget: boolean };
export function DebtPayoffList({ debts, currency = 'USD' }: { debts: Debt[]; currency?: string }) {
  const theme = useTheme();
  return (
    <Surface style={{ padding: 0, overflow: 'hidden' }}>
      {debts.map((d, i) => (
        <View key={i} style={[styles.debtRow, d.isTarget && { backgroundColor: hexToRgba(theme.accent, 0.05) }]}>
          <View style={styles.rowBetween}>
            <Text style={[typeScale.subhead, { color: theme.label, fontWeight: d.isTarget ? '600' : '400' }]}>{d.name}</Text>
            <AmountText amount={d.balance} currency={currency} size={15} weight={d.isTarget ? 'semibold' : 'regular'} />
          </View>
          <Text style={[typeScale.caption, { color: theme.secondaryLabel, marginTop: 4 }]}>
            ${d.monthlyPayment}/mo · {d.monthsToPayoff < 999 ? `${d.monthsToPayoff} months left` : 'No plan'}
          </Text>
        </View>
      ))}
    </Surface>
  );
}

// 8. RecurringTransactionRow
type Recurring = { note: string; amount: number; dayOfMonth: number; active: boolean };
export function RecurringTransactionRow({ item, currency = 'USD', onToggle, onPress }: { item: Recurring; currency?: string; onToggle?: () => void; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.row, { paddingVertical: spacing.md }]}>
      <Ionicons name="repeat" size={20} color={item.active ? theme.accent : theme.tertiaryLabel} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[typeScale.subhead, { color: theme.label, opacity: item.active ? 1 : 0.5 }]}>{item.note}</Text>
        <Text style={[typeScale.caption, { color: theme.secondaryLabel }]}>Every {item.dayOfMonth}{[1,21,31].includes(item.dayOfMonth)?'st':[2,22].includes(item.dayOfMonth)?'nd':[3,23].includes(item.dayOfMonth)?'rd':'th'}</Text>
      </View>
      <AmountText amount={item.amount} currency={currency} size={16} color={item.active ? theme.label : theme.tertiaryLabel} />
      <Pressable onPress={onToggle} style={{ marginLeft: spacing.md }} hitSlop={10}>
        <View style={[styles.toggleDot, { backgroundColor: item.active ? theme.accent : theme.separator }]} />
      </Pressable>
    </Pressable>
  );
}

// 9. MonthlySummaryCard
type Summary = { totalSpent: number; transactionCount: number; topCategoryName?: string; topCategoryAmount?: number; biggestNote?: string; biggestAmount?: number; budgetScore: number };
export function MonthlySummaryCard({ summary, currency = 'USD' }: { summary: Summary; currency?: string }) {
  const theme = useTheme();
  return (
    <GradientCard colors={['#6C4CF5', '#8B5CF6']} style={styles.cardPadding}>
      <Text style={[typeScale.headline, { color: '#FFFFFF', marginBottom: spacing.md }]}>Month in Review</Text>
      <View style={styles.rowBetween}>
        <Text style={[typeScale.subhead, { color: 'rgba(255,255,255,0.8)' }]}>Total Spent</Text>
        <AmountText amount={summary.totalSpent} currency={currency} size={16} color="#FFFFFF" weight="semibold" />
      </View>
      <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
        <Text style={[typeScale.subhead, { color: 'rgba(255,255,255,0.8)' }]}>Transactions</Text>
        <Text style={[typeScale.subhead, { color: '#FFFFFF', fontWeight: '600' }]}>{summary.transactionCount}</Text>
      </View>
      {summary.topCategoryName && (
        <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
          <Text style={[typeScale.subhead, { color: 'rgba(255,255,255,0.8)' }]}>Top: {summary.topCategoryName}</Text>
          <AmountText amount={summary.topCategoryAmount || 0} currency={currency} size={15} color="#FFFFFF" />
        </View>
      )}
      <View style={[styles.divider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
      <View style={styles.rowBetween}>
        <Text style={[typeScale.subhead, { color: 'rgba(255,255,255,0.8)' }]}>Budget Score</Text>
        <Text style={[typeScale.headline, { color: '#FFFFFF' }]}>{summary.budgetScore}% on budget</Text>
      </View>
    </GradientCard>
  );
}

// 10. FundBalanceRow
export function FundBalanceRow({ name, balance, currency = 'USD' }: { name: string; balance: number; currency?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.rowBetween, { paddingVertical: spacing.sm }]}>
      <View style={styles.row}>
        <Ionicons name="wallet" size={18} color={theme.systemGreen} />
        <Text style={[typeScale.subhead, { color: theme.label, marginLeft: spacing.sm }]}>{name}</Text>
      </View>
      <AmountText amount={balance} currency={currency} size={16} color={theme.label} />
    </View>
  );
}

// 11. CategoryRuleRow
export function CategoryRuleRow({ keyword, categoryName, categoryColor, onDelete }: { keyword: string; categoryName: string; categoryColor: string; onDelete?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: spacing.sm }]}>
      <View style={[styles.dot, { backgroundColor: categoryColor, marginRight: spacing.sm }]} />
      <Text style={[typeScale.subhead, { color: theme.label, flex: 1 }]}>"{keyword}" <Text style={{color: theme.tertiaryLabel}}>→</Text> {categoryName}</Text>
      <Pressable onPress={onDelete} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color={theme.systemRed} />
      </Pressable>
    </View>
  );
}

// 12. RolloverBadge
export function RolloverBadge({ amount, currency = 'USD' }: { amount: number; currency?: string }) {
  const theme = useTheme();
  if (amount <= 0) return null;
  return (
    <View style={[styles.badgeRow, { backgroundColor: hexToRgba(theme.systemGreen, 0.14) }]}>
      <Text style={[typeScale.caption, { color: theme.systemGreen }]}>+{amount.toFixed(0)} rollover</Text>
    </View>
  );
}

// 13. AppLockScreen
export function AppLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.lockScreen, { backgroundColor: hexToRgba(theme.background, 0.95) }]}>
      <Ionicons name="lock-closed" size={48} color={theme.accent} style={{ marginBottom: spacing.lg }} />
      <Text style={[typeScale.headline, { color: theme.label, marginBottom: spacing.md }]}>Penny Budget is Locked</Text>
      <Pressable 
        onPress={onUnlock} 
        style={({ pressed }) => [
          styles.unlockButton, 
          { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }
        ]}
      >
        <Ionicons name="scan" size={20} color="#FFF" style={{ marginRight: spacing.sm }} />
        <Text style={[typeScale.subhead, { color: '#FFF', fontWeight: '600' }]}>Unlock with Face ID</Text>
      </Pressable>
    </View>
  );
}

// 14. SearchBar
export function SearchBar({ value, onChangeText, onClear }: { value: string; onChangeText: (t: string) => void; onClear: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.searchBarContainer, { backgroundColor: theme.fieldBackground }]}>
      <Ionicons name="search" size={20} color={theme.secondaryLabel} />
      <TextInput
        style={[styles.searchInput, { color: theme.label }]}
        placeholder="Search transactions..."
        placeholderTextColor={theme.tertiaryLabel}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
      />
      {value.length > 0 && (
        <Pressable onPress={onClear} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={theme.tertiaryLabel} />
        </Pressable>
      )}
    </View>
  );
}

// 15. TransactionMultiSelectRow
export function TransactionMultiSelectRow({ 
  selected, 
  onToggle, 
  note, 
  amount, 
  currency = 'USD' 
}: { 
  selected: boolean; 
  onToggle: () => void; 
  note: string; 
  amount: number; 
  currency?: string 
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onToggle} style={[styles.row, styles.multiSelectRow, selected && { backgroundColor: hexToRgba(theme.accent, 0.1) }]}>
      <View style={[styles.checkbox, { borderColor: selected ? theme.accent : theme.separator, backgroundColor: selected ? theme.accent : 'transparent' }]}>
        {selected && <Ionicons name="checkmark" size={16} color="#FFF" />}
      </View>
      <Text style={[typeScale.subhead, { color: theme.label, flex: 1, marginHorizontal: spacing.md }]} numberOfLines={1}>
        {note}
      </Text>
      <AmountText amount={amount} currency={currency} size={16} color={theme.label} />
    </Pressable>
  );
}

// 16. BulkActionBar
export function BulkActionBar({ 
  count, 
  onCategorize, 
  onDelete 
}: { 
  count: number; 
  onCategorize: () => void; 
  onDelete: () => void; 
}) {
  const theme = useTheme();
  if (count === 0) return null;
  
  return (
    <View style={[styles.bulkActionBar, { backgroundColor: theme.groupedBackground }]}>
      <Text style={[typeScale.subhead, { color: theme.label, fontWeight: '600' }]}>{count} selected</Text>
      <View style={styles.row}>
        <Pressable onPress={onCategorize} style={[styles.bulkActionBtn, { backgroundColor: theme.accent }]}>
          <Text style={[typeScale.footnote, { color: '#FFF', fontWeight: '600' }]}>Categorize</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={[styles.bulkActionBtn, { backgroundColor: theme.systemRed, marginLeft: spacing.sm }]}>
          <Text style={[typeScale.footnote, { color: '#FFF', fontWeight: '600' }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardPadding: { padding: spacing.lg },
  centerCard: { alignItems: 'center', padding: spacing.xl },
  whiteCaption: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 },
  whiteSubtext: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start', gap: 4 },
  projectionRow: { marginTop: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  calHeaderRow: { flexDirection: 'row', marginBottom: spacing.sm },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  calCellHeader: { width: '13%', textAlign: 'center', fontSize: 12 },
  calCell: { width: '13%', aspectRatio: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  dotsRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  divider: { height: 1, width: '100%', marginVertical: spacing.md },
  debtRow: { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(150,150,150,0.2)' },
  toggleDot: { width: 14, height: 14, borderRadius: 7 },
  lockScreen: { zIndex: 9999, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  unlockButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, marginVertical: spacing.sm },
  searchInput: { flex: 1, marginLeft: spacing.sm, fontSize: 16 },
  multiSelectRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(150,150,150,0.1)' },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bulkActionBar: { position: 'absolute', bottom: 30, left: spacing.lg, right: spacing.lg, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 10 },
  bulkActionBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
});
