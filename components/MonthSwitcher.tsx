import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { MonthPickerSheet } from './MonthPickerSheet';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatMonthLabel, formatShortMonth } from '../lib/format';
import { currentYearMonth } from '../lib/db';
import { addMonths } from '../lib/queries';
import { selection } from '../lib/haptics';

type Props = {
  /**
   * Fired AFTER the month has already changed, with the direction moved.
   * Only for a screen that wants to animate the swap — the month change itself
   * is this component's job, so a screen that doesn't animate passes nothing.
   */
  onChange?: (direction: -1 | 1) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * The one month control, shared by every bottom tab that shows month-scoped
 * numbers (Home, Budget, Insights, Transactions, Cards — not Settings).
 *
 * It exists as a component rather than five copies for a specific reason: the
 * month lives in BudgetContext and every one of those screens already reads
 * month-scoped data from it, so a control that differs per tab — or is missing
 * on two of them — makes the same numbers look like a bug. Transactions and
 * Cards were the missing two: their data was already scoped to `selectedMonth`
 * through the context, but nothing on either screen said so, so a Cards total
 * silently meant "September" while the user believed it meant "ever".
 *
 * The label is centred and the arrows sit next to it, so the whole control
 * reads as one thing. "This month" is absolutely positioned at the right edge
 * precisely so that its appearing and disappearing never shifts the label.
 */
export function MonthSwitcher({ onChange, style }: Props) {
  const theme = useTheme();
  const { selectedMonth, setSelectedMonth, goToPrevMonth, goToNextMonth } = useBudget();
  const [pickerOpen, setPickerOpen] = useState(false);

  const thisMonth = currentYearMonth();
  const isCurrentMonth = selectedMonth === thisMonth;

  const goPrev = () => {
    selection();
    goToPrevMonth();
    onChange?.(-1);
  };
  const goNext = () => {
    selection();
    goToNextMonth();
    onChange?.(1);
  };
  const goToday = () => {
    selection();
    // Direction matters to the caller's animation: jumping back from a future
    // month should slide the same way stepping back does.
    const direction = selectedMonth > thisMonth ? -1 : 1;
    setSelectedMonth(thisMonth);
    onChange?.(direction);
  };

  const openPicker = () => {
    selection();
    setPickerOpen(true);
  };
  const jumpTo = (ym: string) => {
    if (ym === selectedMonth) return;
    const direction = ym < selectedMonth ? -1 : 1;
    setSelectedMonth(ym);
    onChange?.(direction);
  };

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={goPrev}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Previous month, ${formatMonthLabel(addMonths(selectedMonth, -1))}`}
        style={styles.arrow}
      >
        <Ionicons name="chevron-back" size={20} color={theme.secondaryLabel} />
      </Pressable>

      {/* Tapping the month opens a grid to jump straight to one. The arrows
          only ever move a month at a time, which makes anything further than
          last month tedious and another YEAR effectively unreachable. */}
      <Pressable
        onPress={openPicker}
        hitSlop={8}
        accessibilityRole="button"
        // Announced on its own rather than left to the arrows' labels, so the
        // month you are looking at is readable without moving off it.
        accessibilityLabel={`Showing ${formatMonthLabel(selectedMonth)}. Tap to go to another month.`}
        style={styles.label}
      >
        <Text style={[type.headline, { color: theme.label }]}>{formatMonthLabel(selectedMonth)}</Text>
        <Ionicons name="chevron-down" size={14} color={theme.secondaryLabel} />
      </Pressable>

      <Pressable
        onPress={goNext}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Next month, ${formatMonthLabel(addMonths(selectedMonth, 1))}`}
        style={styles.arrow}
      >
        <Ionicons name="chevron-forward" size={20} color={theme.secondaryLabel} />
      </Pressable>

      {/* Only while you are away from the current month — on it, a jump-back
          button is a dead control. Labelled with an arrow and the month it goes
          TO, because "This month" on a screen showing March read as a claim
          about March rather than a way back to August. */}
      {!isCurrentMonth && (
        <Pressable
          onPress={goToday}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${formatMonthLabel(thisMonth)}`}
          style={[styles.today, { backgroundColor: theme.accentTint }]}
        >
          <Ionicons name="return-up-back" size={13} color={theme.accent} />
          <Text style={[styles.todayText, { color: theme.accent }]}>{formatShortMonth(thisMonth)}</Text>
        </Pressable>
      )}

      <MonthPickerSheet
        visible={pickerOpen}
        selectedMonth={selectedMonth}
        onSelect={jumpTo}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xs,
  },
  // 44pt — Apple's minimum tap target, and the same reason PressableScale sizes
  // its own box. A chevron glyph on its own is about 20pt and misses taps.
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Row so the chevron sits beside the month name and the whole thing reads as
  // one tappable control rather than a label with a stray glyph next to it.
  label: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 44 },
  // Absolute so showing and hiding it cannot nudge the centred month label.
  today: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  todayText: { fontSize: 12, fontWeight: '700' },
});
