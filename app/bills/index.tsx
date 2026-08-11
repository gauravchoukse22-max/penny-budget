import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { AmountText } from '../../components/AmountText';
import { notify } from '../../lib/confirm';
import { listRecurringTransactions } from '../../features/recurring-transactions';
import type { RecurringTransaction } from '../../features/models';
import {
  monthBillEvents,
  upcomingBillEvents,
  type BillEvent,
} from '../../lib/bill-schedule';
import {
  areNotificationsAvailable,
  getBillRemindersEnabled,
  setBillRemindersEnabled,
  rescheduleBillReminders,
} from '../../features/bill-reminders';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BillsScreen() {
  const theme = useTheme();
  const { cards, settings } = useBudget();

  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [remindersOn, setRemindersOn] = useState(false);

  // This screen's month is deliberately independent of the budget's selected
  // month (no MonthSwitcher): a bill calendar is about the months AHEAD, and
  // paging it forward must not drag the whole app's transaction views along.
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based
  const [selectedDate, setSelectedDate] = useState(todayIso());

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [r, enabled] = await Promise.all([listRecurringTransactions(), getBillRemindersEnabled()]);
        if (!live) return;
        setRules(r);
        setRemindersOn(enabled);
        // Rules or due days may have changed since last visit — converge the
        // scheduled notifications with reality (no-op when off/unavailable).
        rescheduleBillReminders();
      })();
      return () => {
        live = false;
      };
    }, [])
  );

  const today = todayIso();
  const monthEvents = useMemo(() => monthBillEvents(rules, cards, year, month), [rules, cards, year, month]);
  const upcoming = useMemo(() => upcomingBillEvents(rules, cards, today), [rules, cards, today]);
  const eventDays = useMemo(() => new Set(monthEvents.map((e) => Number(e.date.slice(8, 10)))), [monthEvents]);
  const selectedEvents = monthEvents.filter((e) => e.date === selectedDate);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  const toggleReminders = async (next: boolean) => {
    if (!next) {
      setRemindersOn(false);
      await setBillRemindersEnabled(false);
      return;
    }
    const result = await setBillRemindersEnabled(true);
    if (result === 'enabled') {
      setRemindersOn(true);
    } else if (result === 'denied') {
      notify('Notifications are off', 'Allow notifications for KaiJar in your phone Settings, then try again.');
    } else {
      // Native module not linked in this binary (see features/bill-reminders.ts).
      notify('Update needed', 'Bill reminders need the latest app version. The calendar still works.');
    }
  };

  // Calendar geometry: weeks as rows, Sunday-first. Leading nulls pad to the
  // first weekday; trailing nulls square off the last row.
  const weeks = useMemo(() => {
    const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
    const total = new Date(year, month, 0).getDate();
    const cells: (number | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  const iso = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const renderEventRow = (e: BillEvent, showDate: boolean) => (
    <View key={e.id} style={styles.eventRow}>
      <Ionicons
        name={e.source === 'card-due' ? 'card-outline' : 'repeat'}
        size={17}
        color={e.source === 'card-due' ? theme.systemBlue : theme.accent}
      />
      <View style={styles.eventMiddle}>
        <Text style={[styles.eventTitle, { color: theme.label }]} numberOfLines={1}>
          {e.label}
        </Text>
        {showDate && (
          <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>{formatEventDate(e.date)}</Text>
        )}
      </View>
      {e.amount != null ? (
        <AmountText amount={e.amount} currency={settings.currency} size={14} weight="semibold" />
      ) : (
        // Card dues have no known amount — say so rather than showing $0.
        <Text style={{ color: theme.tertiaryLabel, fontSize: 13 }}>due date</Text>
      )}
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Surface>
        <View style={styles.reminderRow}>
          <View style={styles.eventMiddle}>
            <Text style={[styles.eventTitle, { color: theme.label }]}>Remind me about bills</Text>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
              A notification at 9 AM the day before each bill.
            </Text>
          </View>
          <Switch value={remindersOn} onValueChange={toggleReminders} />
        </View>
        {!areNotificationsAvailable() && (
          <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: 4 }}>
            Reminders need the latest app version.
          </Text>
        )}
      </Surface>

      <Surface>
        <View style={styles.monthHeader}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month">
            <Ionicons name="chevron-back" size={22} color={theme.accent} />
          </Pressable>
          <Text style={[styles.monthTitle, { color: theme.label }]}>
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month">
            <Ionicons name="chevron-forward" size={22} color={theme.accent} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={[styles.weekdayLabel, { color: theme.tertiaryLabel }]}>
              {w}
            </Text>
          ))}
        </View>

        {weeks.map((week, wi) => (
          <View key={wi} style={styles.weekRow}>
            {week.map((d, di) => {
              if (d === null) return <View key={di} style={styles.dayCell} />;
              const dateStr = iso(d);
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const hasEvents = eventDays.has(d);
              return (
                <Pressable
                  key={di}
                  style={styles.dayCell}
                  onPress={() => setSelectedDate(dateStr)}
                  accessibilityRole="button"
                  accessibilityLabel={`${MONTH_NAMES[month - 1]} ${d}${hasEvents ? ', has bills' : ''}`}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && { backgroundColor: theme.accent },
                      !isSelected && isToday && { backgroundColor: theme.accentTint },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: isToday || isSelected ? '700' : '400',
                        color: isSelected ? theme.onAccent : isToday ? theme.accent : theme.label,
                      }}
                    >
                      {d}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: hasEvents ? (isSelected ? theme.accent : theme.accent) : 'transparent' },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={[styles.selectedList, { borderTopColor: theme.separator }]}>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>{formatEventDate(selectedDate)}</Text>
          {selectedEvents.length === 0 ? (
            <Text style={{ color: theme.tertiaryLabel }}>No bills on this day.</Text>
          ) : (
            selectedEvents.map((e) => renderEventRow(e, false))
          )}
        </View>
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Upcoming — next 30 days</Text>
        {upcoming.length === 0 ? (
          <Text style={{ color: theme.tertiaryLabel }}>
            Nothing due. Add recurring bills, or set a payment due day on a card, and they show up here.
          </Text>
        ) : (
          upcoming.map((e) => renderEventRow(e, true))
        )}
      </Surface>

      <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
        Built from your recurring bills and card due days — nothing leaves your phone.
      </Text>
    </ScrollView>
  );
}

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  monthTitle: { fontSize: 17, fontWeight: '700' },
  weekRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', paddingVertical: 4 },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
  selectedList: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  eventMiddle: { flex: 1 },
  eventTitle: { fontSize: 14, fontWeight: '500' },
  footer: { textAlign: 'center', fontSize: 12 },
});
