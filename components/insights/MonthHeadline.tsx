import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Surface } from '../Surface';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing } from '../../theme/colors';
import { formatCurrency, maskedAmount } from '../../lib/format';

/**
 * The one-sentence verdict Review Night opens with: "In July, you kept $412 of
 * the $6,100 you brought in." Uses the SAME surplus the Home tab shows (salary
 * − spend − transferred savings), so the two tabs can never disagree about
 * what a month left over — that disagreement is a bug this app already fixed
 * once ("Make Insights agree with Home") and must not regress.
 */
export function MonthHeadline() {
  const theme = useTheme();
  const { selectedMonth, surplus, settings } = useBudget();
  const { salary: income, spend, surplus: net } = surplus;

  // Month name only ("July"), not "July 2026" — a sentence about last month
  // reads naturally; the year is already on the MonthSwitcher above.
  const [y, m] = selectedMonth.split('-').map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });

  // Respect "Hide amounts" the same way AmountText does — the headline is the
  // loudest number on the screen, so it is the one shoulder-surfers read first.
  const money = (v: number) => (settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(v, settings.currency));

  const sentence = (() => {
    if (income <= 0 && spend <= 0) {
      return <Text>Nothing logged in {monthName} yet.</Text>;
    }
    if (income <= 0) {
      return (
        <Text>
          In {monthName}, you spent <Bold color={theme.label}>{money(spend)}</Bold>. Set your income to see what you kept.
        </Text>
      );
    }
    if (net >= 0) {
      return (
        <Text>
          In {monthName}, you kept <Bold color={theme.positiveMuted}>{money(net)}</Bold> of the{' '}
          <Bold color={theme.label}>{money(income)}</Bold> you brought in.
        </Text>
      );
    }
    return (
      <Text>
        In {monthName}, you spent <Bold color={theme.negativeMuted}>{money(-net)}</Bold> more than the{' '}
        <Bold color={theme.label}>{money(income)}</Bold> you brought in.
      </Text>
    );
  })();

  return (
    <Surface>
      <Text style={[styles.sentence, { color: theme.secondaryLabel }]}>{sentence}</Text>
    </Surface>
  );
}

function Bold({ children, color }: { children: React.ReactNode; color: string }) {
  return <Text style={[styles.bold, { color }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  // Big enough to be the headline, small enough that a long currency string
  // ("₹1,00,000") still wraps into a readable second line.
  sentence: { fontSize: 22, lineHeight: 30, fontWeight: '500', marginVertical: spacing.xs },
  bold: { fontWeight: '700', fontVariant: ['tabular-nums'] },
});
