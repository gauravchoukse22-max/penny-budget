import React, { useState } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MonthPickerSheet } from './MonthPickerSheet';
import { Button, IconButton } from './Button';
import { useBudget } from '../context/BudgetContext';
import { useTheme, spacing, type } from '../theme/colors';
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
      <IconButton
        icon="chevron-back"
        onPress={goPrev}
        accessibilityLabel={`Previous month, ${formatMonthLabel(addMonths(selectedMonth, -1))}`}
      />

      {/* Tapping the month opens a grid to jump straight to one. The arrows
          only ever move a month at a time, which makes anything further than
          last month tedious and another YEAR effectively unreachable. */}
      <Button
        label={formatMonthLabel(selectedMonth)}
        onPress={openPicker}
        variant="ghost"
        iconAfter="chevron-down"
        // The month name is this control's heading, so it keeps heading
        // typography and the label colour while taking the system's height,
        // press feel and haptics from Button.
        labelStyle={[type.headline, { color: theme.label }]}
        // Announced on its own rather than left to the arrows' labels, so the
        // month you are looking at is readable without moving off it.
        accessibilityLabel={`Showing ${formatMonthLabel(selectedMonth)}. Tap to go to another month.`}
      />

      <IconButton
        icon="chevron-forward"
        onPress={goNext}
        accessibilityLabel={`Next month, ${formatMonthLabel(addMonths(selectedMonth, 1))}`}
      />

      {/* Only while you are away from the current month — on it, a jump-back
          button is a dead control. Labelled with an arrow and the month it goes
          TO, because "This month" on a screen showing March read as a claim
          about March rather than a way back to August. */}
      {!isCurrentMonth && (
        <Button
          label={formatShortMonth(thisMonth)}
          icon="return-up-back"
          onPress={goToday}
          variant="tonal"
          size="sm"
          style={styles.today}
          accessibilityLabel={`Back to ${formatMonthLabel(thisMonth)}`}
        />
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
    // Tighter than it was: the arrows now carry their own glass box, so they
    // no longer need empty space to read as separate targets.
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // Absolute so showing and hiding it cannot nudge the centred month label.
  today: { position: 'absolute', right: 0 },
});
