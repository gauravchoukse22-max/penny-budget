import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from './Surface';
import { ProgressBar } from './ProgressBar';
import { AmountText } from './AmountText';
import { Button, IconButton } from './Button';
import { PlannerField } from './PlannerField';
import { useTheme, spacing, type } from '../theme/colors';
import { formatCurrency, formatMonthLabel, maskedAmount } from '../lib/format';
import { forecastGoal, requiredMonthlyForDate, addMonths } from '../lib/goal-planner';
import { useBudget } from '../context/BudgetContext';

// One savings goal, answered in both directions: when the current contribution
// funds it, and what a chosen date would cost per month.
//
// The target comes from savings_goals.targetAmount and edits here write back to
// it, so setting a target on this screen is the same target the rest of the app
// sees and the other household member syncs. A null target is not an error: an
// open-ended goal still renders its saved total and monthly amount, and offers
// the field rather than nagging about it.

// Hide amounts has to reach the sentences too. It is a privacy control, and a
// headline reading "$4,000 still to find" leaks exactly what it was turned on
// to hide — AmountText does this for standalone figures, but these amounts sit
// inside prose, so the same rule is applied here.
const money = (n: number, c: string, hidden: boolean) => (hidden ? maskedAmount(c) : formatCurrency(n, c));

type Props = {
  name: string;
  /** Saved so far — summed from the months actually ticked as transferred. */
  saved: number;
  /** This month's contribution, as resolved for the current month. */
  monthly: number;
  currency: string;
  /** savings_goals.targetAmount. Null is an open-ended goal. */
  target: number | null;
  /** Month the next contribution lands in. */
  startMonth: string;
  /** Writes the target back to the goal row. */
  onChangeTarget: (value: number | null) => void;
};

export function PlannerGoalCard({ name, saved, monthly, currency, target, startMonth, onChangeTarget }: Props) {
  const theme = useTheme();
  const { settings } = useBudget();
  const cash = (n: number) => money(n, currency, settings.hideAmounts);

  // The "by when?" month is a what-if, not a fact about the goal: the user
  // spins it to see what a date would cost. Nothing stores it, so it lives here
  // and resets with the screen — persisting a number the user was only trying
  // out would make it look like a commitment they had made.
  const [targetMonth, setTargetMonth] = useState<string | null>(null);

  const forecast = forecastGoal({ saved, target, monthly, startMonth });
  const hasTarget = target !== null && target > 0;

  const requirement = targetMonth
    ? requiredMonthlyForDate({ saved, target, targetMonth, startMonth, monthly })
    : null;

  // Green for anything with a date, amber for anything without one. The bar's
  // status vocabulary is the budget's, but the colours carry the same meaning:
  // amber is "this needs your attention", not "you overspent".
  const status = forecast.status === 'funded' || forecast.status === 'projected' ? 'green' : 'amber';

  const headline = () => {
    switch (forecast.status) {
      case 'no-target':
        return 'Open-ended goal. Set a target to see a funded date.';
      case 'funded':
        return forecast.overfunded > 0
          ? `Funded — ${cash(forecast.overfunded)} past target.`
          : 'Funded.';
      case 'projected':
        return `Funded by ${formatMonthLabel(forecast.completionMonth!)} at ${cash(monthly)}/mo.`;
      case 'stalled':
        return `Nothing going in, so there is no funded date. ${cash(forecast.remaining)} still to find.`;
      case 'too-slow':
        return `At ${cash(monthly)}/mo this takes over 100 years. It needs a bigger monthly amount.`;
    }
  };

  const requirementLine = () => {
    if (!requirement || !hasTarget) return null;
    if (requirement.status === 'no-target') return null;
    if (requirement.status === 'funded') return 'Already funded — nothing more to put in.';
    if (requirement.status === 'past-date')
      return `${formatMonthLabel(targetMonth!)} has already passed. You would need ${cash(requirement.remaining)} now.`;
    const required = cash(requirement.requiredMonthly ?? 0);
    const change = requirement.changeFromCurrent ?? 0;
    if (change > 0)
      return `To hit it by ${formatMonthLabel(targetMonth!)} you need ${required}/mo — ${cash(change)} more than now.`;
    return `${required}/mo gets you there by ${formatMonthLabel(targetMonth!)}. Your current ${cash(monthly)}/mo already beats it.`;
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[type.headline, { color: theme.label, flex: 1 }]} numberOfLines={1}>
          {name}
        </Text>
        <AmountText amount={saved} currency={currency} size={15} weight="semibold" />
      </View>

      <ProgressBar percent={forecast.progress * 100} status={status} />

      <View style={styles.metaRow}>
        <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
          {hasTarget ? `of ${cash(target)}` : 'no target set'}
        </Text>
        <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
          {monthly > 0 ? `${cash(monthly)}/mo` : 'no monthly amount'}
        </Text>
      </View>

      <Text style={[styles.headline, { color: theme.label }]}>{headline()}</Text>

      <PlannerField
        label="Target amount"
        value={target}
        onChangeValue={onChangeTarget}
        prefix="$"
        placeholder="0"
        hint="Saved to the goal, so it shows on every device sharing this budget."
      />

      {hasTarget ? (
        <View style={styles.dateBlock}>
          {targetMonth ? (
            <>
              <View style={styles.monthRow}>
                <IconButton
                  icon="chevron-back"
                  accessibilityLabel="Move target month earlier"
                  size="sm"
                  onPress={() => setTargetMonth(addMonths(targetMonth, -1))}
                />
                <Text style={[styles.monthLabel, { color: theme.label }]}>{formatMonthLabel(targetMonth)}</Text>
                <IconButton
                  icon="chevron-forward"
                  accessibilityLabel="Move target month later"
                  size="sm"
                  onPress={() => setTargetMonth(addMonths(targetMonth, 1))}
                />
                <Button
                  label="Clear"
                  variant="ghost"
                  size="sm"
                  onPress={() => setTargetMonth(null)}
                  accessibilityLabel="Clear the target date"
                />
              </View>
              <Text style={[styles.requirement, { color: theme.secondaryLabel }]}>{requirementLine()}</Text>
            </>
          ) : (
            <Button
              label="Want it by a date?"
              variant="tonal"
              size="sm"
              icon="calendar-outline"
              // Seeds from the projected date when there is one, so the first
              // tap shows a believable month to step away from rather than an
              // arbitrary "a year from now".
              onPress={() => setTargetMonth(forecast.completionMonth ?? addMonths(startMonth, 11))}
            />
          )}
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  headline: { fontSize: 14, lineHeight: 19 },
  dateBlock: { gap: spacing.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  monthLabel: { fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  requirement: { fontSize: 13, lineHeight: 18 },
});
