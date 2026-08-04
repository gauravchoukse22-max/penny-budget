import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type as typeScale } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { detectAnomalies } from '../../features/predictive-engine';
import type { AnomalyAlert } from '../../features/models';
import {
  parseInsightsLayout,
  serializeInsightsLayout,
  type InsightCardId,
  type InsightCardPref,
} from '../../lib/insights-layout';
import { MonthHeadline } from '../../components/insights/MonthHeadline';
import { MoneyMap } from '../../components/insights/MoneyMap';
import { BiggestChanges } from '../../components/insights/BiggestChanges';
import { RecurringWatch } from '../../components/insights/RecurringWatch';
import { Watchlist } from '../../components/insights/Watchlist';
import { Outlook } from '../../components/insights/Outlook';
import { SpendingTrend } from '../../components/insights/SpendingTrend';
import { WhereItGoes } from '../../components/insights/WhereItGoes';
import { EditInsightsSheet } from '../../components/insights/EditInsightsSheet';

/**
 * Review Night — the monthly review, as a stack of self-contained cards the
 * user curates. Each card lives in components/insights/ and pulls its own data
 * (month-scoped cards key off selectedMonth via useBudget), so this screen's
 * only jobs are the header, the anomaly notices, and rendering the cards the
 * saved layout asks for, in the order it asks for them.
 *
 * The layout itself is the user's: the Edit button opens a sheet with a
 * show/hide switch and reorder arrows per card, persisted as JSON in
 * app_settings.insightsLayout (device-local on purpose — see
 * lib/insights-layout.ts).
 */

// Every card the layout can name, mapped to its component. A saved id missing
// from this map can't happen post-parse (unknown ids are dropped), so render
// is a straight lookup.
const CARD_COMPONENTS: Record<InsightCardId, React.ComponentType> = {
  headline: MonthHeadline,
  'money-map': MoneyMap,
  'biggest-changes': BiggestChanges,
  'recurring-watch': RecurringWatch,
  watchlist: Watchlist,
  outlook: Outlook,
  'spending-trend': SpendingTrend,
  'where-it-goes': WhereItGoes,
};

export default function InsightsScreen() {
  const theme = useTheme();
  const { selectedMonth, settings, surplus, categorySummaries, updateSettings } = useBudget();
  const [editOpen, setEditOpen] = useState(false);

  // Anomaly notices stay on the screen, above the cards: they are alerts, not
  // review material, so they are not part of the customizable card set.
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    detectAnomalies(selectedMonth).then((a) => alive && setAnomalies(a));
    setDismissed(new Set());
    return () => {
      alive = false;
    };
  }, [selectedMonth]);
  const visibleAnomalies = anomalies.filter((a) => !dismissed.has(a.transactionId));

  // Derived, not state: the saved JSON is the single source of truth, so the
  // sheet's edits (which write straight through updateSettings) come back
  // through settings and re-render both the sheet and the cards.
  const prefs = useMemo(() => parseInsightsLayout(settings.insightsLayout), [settings.insightsLayout]);
  const savePrefs = (next: InsightCardPref[]) => {
    updateSettings({ insightsLayout: serializeInsightsLayout(next) });
  };

  const hasAnyData = surplus.spend > 0 || surplus.salary > 0 || categorySummaries.some((s) => s.spend > 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={[typeScale.title1, { color: theme.label }]}>Insights</Text>
          <Pressable
            onPress={() => setEditOpen(true)}
            hitSlop={8}
            style={[styles.editButton, { backgroundColor: theme.fieldBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Customize which insight cards show"
          >
            <Ionicons name="options-outline" size={15} color={theme.secondaryLabel} />
            <Text style={[styles.editText, { color: theme.secondaryLabel }]}>Edit</Text>
          </Pressable>
        </View>
        <MonthSwitcher />

        {visibleAnomalies.map((a) => (
          <NoticeRow
            key={a.transactionId}
            text={a.explanation}
            critical={a.severity === 'critical'}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(a.transactionId))}
          />
        ))}

        {!hasAnyData && (
          <Surface>
            <View style={styles.emptyState}>
              <Ionicons name="sparkles-outline" size={26} color={theme.tertiaryLabel} />
              <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>
                Log some spending to see your monthly review here.
              </Text>
            </View>
          </Surface>
        )}

        {/* The cards, in the user's saved order. Hidden ones simply don't
            render; each card also returns null on its own when it has nothing
            to say, so an enabled card never shows as an empty shell. */}
        {hasAnyData &&
          prefs
            .filter((p) => p.visible)
            .map((p) => {
              const Card = CARD_COMPONENTS[p.id];
              return <Card key={p.id} />;
            })}
      </ScrollView>

      <EditInsightsSheet visible={editOpen} prefs={prefs} onChange={savePrefs} onClose={() => setEditOpen(false)} />
    </SafeAreaView>
  );
}

function NoticeRow({ text, critical, onDismiss }: { text: string; critical: boolean; onDismiss: () => void }) {
  const theme = useTheme();
  const accent = critical ? theme.negativeMuted : theme.secondaryLabel;
  return (
    <View style={[styles.notice, { backgroundColor: theme.card, borderColor: theme.separator }]}>
      <View style={[styles.noticeBar, { backgroundColor: accent }]} />
      <Text style={[styles.noticeText, { color: theme.secondaryLabel }]} numberOfLines={3}>
        {text}
      </Text>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Ionicons name="close" size={16} color={theme.tertiaryLabel} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  editText: { fontSize: 13, fontWeight: '600' },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  noticeBar: { width: 3, alignSelf: 'stretch', borderRadius: radius.pill },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },

  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
});
