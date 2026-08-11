import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { Surface } from './Surface';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency, formatMonthLabel } from '../lib/format';
import type { Fix, OverAssignAnalysis } from '../lib/over-assign';

// The way out of an over-assigned month.
//
// Before this, the Budget screen said "assigned $103.00 more than income" in
// red and stopped there — and it also HIDES the "Assign the remaining" call to
// action once you go over, so the single moment you most need help was the one
// moment the screen offered none.
//
// What it deliberately does not claim: WHEN the over-assignment happened.
// Nothing in the database records the timing of a budget edit (see the header
// of lib/over-assign.ts). Instead it answers the question that actually leads
// somewhere — what moved since last month, and what to do about it.

export function OverAssignedSheet({
  visible,
  onClose,
  analysis,
  currency,
  yearMonth,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  analysis: OverAssignAnalysis | null;
  currency: string;
  yearMonth: string;
  onApply: (fix: Fix) => Promise<void>;
}) {
  const theme = useTheme();
  const [applying, setApplying] = useState<string | null>(null);

  if (!analysis) return null;
  const money = (n: number) => formatCurrency(n, currency);

  const apply = async (fix: Fix) => {
    setApplying(fix.kind);
    try {
      await onApply(fix);
      onClose();
    } finally {
      setApplying(null);
    }
  };

  return (
    <SheetModal visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Text style={[type.headline, { color: theme.label }]}>Over-assigned</Text>
          <Button label="Done" variant="ghost" size="sm" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* The number, restated plainly — the user arrived here from a red
              line and should not have to remember what it said. */}
          <Surface>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
              {formatMonthLabel(yearMonth)} assigns
            </Text>
            <Text style={{ color: theme.label, fontSize: 28, fontWeight: '700' }}>
              {money(analysis.assignedTotal)}
            </Text>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
              out of {money(analysis.income)} of income — {money(analysis.overage)} too much.
            </Text>
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: spacing.sm }}>
              Nothing is broken and no money has moved. A budget is a plan, and this plan
              currently promises more than the month brings in.
            </Text>
          </Surface>

          {/* What changed. This is the part that answers "how did I get here" —
              honestly, from the previous month's stored snapshot. */}
          {analysis.risers.length > 0 ? (
            <Surface>
              <Text style={[styles.sectionTitle, { color: theme.label }]}>What went up since last month</Text>
              {analysis.risersExplainIt ? (
                <Text style={{ color: theme.secondaryLabel, fontSize: 13, marginBottom: spacing.md }}>
                  These increases are enough to explain the whole gap — last month's plan fitted your income.
                </Text>
              ) : (
                <Text style={{ color: theme.secondaryLabel, fontSize: 13, marginBottom: spacing.md }}>
                  These went up, but they do not account for all of it — the plan was already
                  bigger than the month before that.
                </Text>
              )}
              {analysis.risers.map((r) => (
                <View key={r.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.label, fontSize: 15, fontWeight: '600' }}>{r.name}</Text>
                    <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                      {r.isNew
                        ? 'new this month'
                        : `was ${money(r.previousAmount ?? 0)} — now ${money(r.amount)}`}
                    </Text>
                  </View>
                  <Text style={{ color: theme.systemRed, fontSize: 15, fontWeight: '700' }}>
                    +{money(r.isNew ? r.amount : r.delta ?? 0)}
                  </Text>
                </View>
              ))}
            </Surface>
          ) : (
            <Surface>
              <Text style={[styles.sectionTitle, { color: theme.label }]}>Nothing went up this month</Text>
              <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
                No assignment is larger than last month's, so the gap comes from income being
                lower this month rather than from anything you changed.
              </Text>
            </Surface>
          )}

          {/* Where it all sits, so the user can go straight to the row they
              actually want to edit instead of hunting the list. */}
          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Where the money is assigned</Text>
            {analysis.allocations.slice(0, 8).map((a) => (
              <View key={a.id} style={styles.row}>
                <Ionicons
                  name={a.kind === 'goal' ? 'flag-outline' : 'pricetag-outline'}
                  size={15}
                  color={theme.tertiaryLabel}
                />
                <Text style={{ color: theme.label, fontSize: 15, flex: 1 }} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={{ color: theme.secondaryLabel, fontSize: 15, fontWeight: '600' }}>{money(a.amount)}</Text>
              </View>
            ))}
            {analysis.allocations.length > 8 ? (
              <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: spacing.sm }}>
                + {analysis.allocations.length - 8} smaller
              </Text>
            ) : null}
          </Surface>

          {/* The fixes. Each says exactly what it will do before it does it —
              this screen changes real budget numbers, so nothing is applied on
              a guess about what the user meant. */}
          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Ways to fix it</Text>
            {analysis.fixes.map((fix) => (
              <View key={fix.kind} style={[styles.fix, { borderColor: theme.separator }]}>
                <Text style={{ color: theme.label, fontSize: 15, fontWeight: '600' }}>{fix.title}</Text>
                <Text style={{ color: theme.secondaryLabel, fontSize: 13, marginTop: 2 }}>{fix.detail}</Text>
                {fix.reductions.length > 0 ? (
                  <View style={{ marginTop: spacing.sm, gap: 2 }}>
                    {fix.reductions.slice(0, 4).map((r) => (
                      <Text key={r.id} style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                        {r.name}  {money(r.from)} → {money(r.to)}
                      </Text>
                    ))}
                    {fix.reductions.length > 4 ? (
                      <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                        + {fix.reductions.length - 4} more
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <Button
                  label="Apply"
                  variant="tonal"
                  size="sm"
                  loading={applying === fix.kind}
                  disabled={applying !== null && applying !== fix.kind}
                  onPress={() => apply(fix)}
                  style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                />
              </View>
            ))}
          </Surface>

          <Text style={{ color: theme.tertiaryLabel, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.lg }}>
            You can also just leave it. KaiJar will keep showing the gap so you don't forget,
            and nothing stops you spending.
          </Text>
        </ScrollView>
      </View>
    </SheetModal>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  fix: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
});
