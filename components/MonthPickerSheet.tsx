import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton } from './Button';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { currentYearMonth } from '../lib/db';
import { listMonthsWithTransactions } from '../lib/queries';
import { selection } from '../lib/haptics';

// Jump straight to a month instead of stepping to it.
//
// The arrows are fine for "last month" and useless for anything further: going
// back to a January means twelve taps, and a statement that imported into the
// wrong YEAR is effectively unreachable — you would have to suspect it was
// there and then tap forward twelve times to confirm.
//
// The dots are the other half of that. A month with transactions is marked, so
// the grid answers "where is my data?" without visiting a single month. That is
// what turns finding a mis-dated import from a hunch into a glance.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthPickerSheet({
  visible,
  selectedMonth,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** "YYYY-MM" currently being shown. */
  selectedMonth: string;
  onSelect: (yearMonth: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const thisMonth = currentYearMonth();
  const selectedYear = parseInt(selectedMonth.slice(0, 4), 10);

  const [year, setYear] = useState(selectedYear);
  const [monthsWithData, setMonthsWithData] = useState<Set<string>>(new Set());

  // Re-open on the year you're looking at, not the year you last browsed to.
  useEffect(() => {
    if (visible) setYear(selectedYear);
  }, [visible, selectedYear]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    listMonthsWithTransactions().then((months) => {
      if (alive) setMonthsWithData(new Set(months));
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  // Years worth offering: everything that holds data, plus this year and the
  // year either side of it, so a brand-new install still has somewhere to go.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const ym of monthsWithData) set.add(parseInt(ym.slice(0, 4), 10));
    const now = parseInt(thisMonth.slice(0, 4), 10);
    set.add(now - 1);
    set.add(now);
    set.add(now + 1);
    set.add(selectedYear);
    return [...set].sort((a, b) => a - b);
  }, [monthsWithData, thisMonth, selectedYear]);

  const minYear = years[0];
  const maxYear = years[years.length - 1];

  const pick = (monthIndex: number) => {
    selection();
    onSelect(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.groupedBackground }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={[type.headline, { color: theme.label }]}>Go to month</Text>
          <IconButton icon="close" onPress={onClose} variant="glass" accessibilityLabel="Close" />
        </View>

        <View style={styles.yearRow}>
          <IconButton
            icon="chevron-back"
            onPress={() => setYear((y) => y - 1)}
            disabled={year <= minYear}
            variant="tonal"
            accessibilityLabel={`Previous year, ${year - 1}`}
          />
          <Text style={[styles.yearLabel, { color: theme.label }]}>{year}</Text>
          <IconButton
            icon="chevron-forward"
            onPress={() => setYear((y) => y + 1)}
            disabled={year >= maxYear}
            variant="tonal"
            accessibilityLabel={`Next year, ${year + 1}`}
          />
        </View>

        <ScrollView contentContainerStyle={styles.grid}>
          {MONTH_NAMES.map((name, i) => {
            const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
            const isSelected = ym === selectedMonth;
            const isThisMonth = ym === thisMonth;
            const hasData = monthsWithData.has(ym);
            return (
              <Pressable
                key={ym}
                onPress={() => pick(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${name} ${year}${hasData ? ', has transactions' : ', no transactions'}`}
                style={[
                  styles.cell,
                  { backgroundColor: isSelected ? theme.accent : theme.card },
                  isThisMonth && !isSelected && { borderWidth: 1.5, borderColor: theme.accent },
                ]}
              >
                <Text
                  style={[
                    styles.cellText,
                    { color: isSelected ? theme.onAccent : hasData ? theme.label : theme.tertiaryLabel },
                  ]}
                >
                  {name}
                </Text>
                {/* A month you have data in is marked, so a mis-dated import is
                    visible from here rather than needing to be guessed at. */}
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: hasData ? (isSelected ? theme.onAccent : theme.accent) : 'transparent' },
                  ]}
                />
              </Pressable>
            );
          })}
        </ScrollView>

        <Button
          label="This month"
          onPress={() => {
            selection();
            onSelect(thisMonth);
            onClose();
          }}
          variant="tonal"
          size="lg"
          style={styles.todayButton}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  yearLabel: { fontSize: 20, fontWeight: '700', minWidth: 72, textAlign: 'center', fontVariant: ['tabular-nums'] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  // Three per row on any phone width, and 64pt tall clears the 44pt tap target
  // with room for the dot underneath the label.
  cell: {
    width: '30%',
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cellText: { fontSize: 15, fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  todayButton: { marginHorizontal: spacing.xl, marginBottom: spacing.lg },
});
