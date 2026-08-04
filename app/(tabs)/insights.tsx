import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type as typeScale } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { formatMonthLabel } from '../../lib/format';
import { exportMonthlyReportPdf } from '../../features/report-export';
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
  const [exporting, setExporting] = useState(false);

  const monthLabel = formatMonthLabel(selectedMonth);

  // The PDF used to live in Settings → Data, between Export CSV and Import CSV,
  // where it read as a file-format chore rather than the summary of the month
  // you are looking at. Nothing about the export itself changed — only where
  // it is offered and what it says it gives you.
  const shareMonthlyReport = async () => {
    setExporting(true);
    try {
      await exportMonthlyReportPdf(selectedMonth);
    } finally {
      setExporting(false);
    }
  };

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

        {/* Last card in the stack on purpose: sharing the month is what you do
            once you've read it. The blurb spells out what lands in the PDF —
            the old Settings row named only the month, so the only way to find
            out what you'd get was to generate one and open it. */}
        {hasAnyData && (
          <Surface>
            <Text style={[styles.shareTitle, { color: theme.label }]}>Share {monthLabel}</Text>
            <Text style={[styles.shareBody, { color: theme.secondaryLabel }]}>
              A one-page PDF of this month: what came in, what went out, how each category tracked against its
              budget, totals per card, and your ten largest purchases. Amounts are shown in full even if
              "Hide amounts" is on — it's your own record.
            </Text>
            <Button
              label={`Create ${monthLabel} PDF`}
              icon="document-text-outline"
              variant="tonal"
              onPress={shareMonthlyReport}
              loading={exporting}
              full
              style={styles.shareButton}
              accessibilityLabel={`Create a PDF report for ${monthLabel} and open the share sheet`}
            />
          </Surface>
        )}
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

  shareTitle: { fontSize: 17, fontWeight: '700' },
  shareBody: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  shareButton: { marginTop: spacing.md },

  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
});
