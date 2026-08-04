import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from './Surface';
import { AmountText } from './AmountText';
import { Button } from './Button';
import { PlannerField } from './PlannerField';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency, formatMonthLabel, maskedAmount } from '../lib/format';
import type { DebtPayoffLine } from '../lib/debt-payoff';
import { useBudget } from '../context/BudgetContext';

// One liability in the payoff plan, plus the two numbers the database does not
// have for it.
//
// The rate and minimum fields are collapsed once both are filled in: five debts
// with two always-visible fields each is a screen of inputs and no answer. A
// debt still missing either number keeps them open, because that row is exactly
// what is holding the plan back.

// Hide amounts has to reach the sentences too. It is a privacy control, and a
// headline reading "$4,000 still to find" leaks exactly what it was turned on
// to hide — AmountText does this for standalone figures, but these amounts sit
// inside prose, so the same rule is applied here.
const money = (n: number, c: string, hidden: boolean) => (hidden ? maskedAmount(c) : formatCurrency(n, c));

type Props = {
  name: string;
  balance: number;
  /** "Credit Card", "Auto Loan" — from features/net-worth typeLabel. */
  kind: string;
  currency: string;
  apr: number | null;
  minimum: number | null;
  onChange: (patch: { apr?: number | null; minimum?: number | null }) => void;
  /** 1-based place in the payoff order. Null when this debt isn't in the plan. */
  position: number | null;
  /** This debt's projected payoff, when the plan could include it. */
  line: DebtPayoffLine | null;
};

export function PlannerDebtCard({ name, balance, kind, currency, apr, minimum, onChange, position, line }: Props) {
  const theme = useTheme();
  const { settings } = useBudget();
  const cash = (n: number) => money(n, currency, settings.hideAmounts);
  const complete = apr !== null && minimum !== null;
  const [editing, setEditing] = useState(false);
  const showFields = !complete || editing;

  return (
    <Surface style={styles.card}>
      <View style={styles.headerRow}>
        {position !== null ? (
          <View style={[styles.badge, { backgroundColor: theme.accentTint }]}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{position}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[type.headline, { color: theme.label }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }} numberOfLines={1}>
            {kind}
            {complete ? ` · ${apr}% · ${cash(minimum)}/mo min` : ''}
          </Text>
        </View>
        <AmountText amount={balance} currency={currency} size={15} weight="semibold" />
      </View>

      {line && line.months !== null ? (
        <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
          {line.payoffMonth ? `Cleared ${formatMonthLabel(line.payoffMonth)}` : `Cleared in ${line.months} months`}
          {line.interestPaid > 0 ? ` · ${cash(line.interestPaid)} interest` : ''}
        </Text>
      ) : null}

      {showFields ? (
        <>
          <View style={styles.fieldRow}>
            <PlannerField
              label="Interest rate"
              value={apr}
              onChangeValue={(v) => onChange({ apr: v })}
              suffix="%"
              placeholder="19.99"
            />
            <PlannerField
              label="Minimum payment"
              value={minimum}
              onChangeValue={(v) => onChange({ minimum: v })}
              prefix="$"
              placeholder="0"
            />
          </View>
          {complete ? (
            <Button label="Done" variant="ghost" size="sm" onPress={() => setEditing(false)} />
          ) : (
            <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
              Both numbers are on your statement. Without them this debt is left out of the plan.
            </Text>
          )}
        </>
      ) : (
        <Button
          label="Edit rate & minimum"
          variant="ghost"
          size="sm"
          onPress={() => setEditing(true)}
          accessibilityLabel={`Edit interest rate and minimum payment for ${name}`}
        />
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
});
