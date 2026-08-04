import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { Button, Chip } from '../../components/Button';
import { AmountText } from '../../components/AmountText';
import { PlannerField } from '../../components/PlannerField';
import { PlannerGoalCard } from '../../components/PlannerGoalCard';
import { PlannerDebtCard } from '../../components/PlannerDebtCard';
import { formatCurrency, formatMonthLabel, maskedAmount } from '../../lib/format';
import { getDb, currentYearMonth } from '../../lib/db';
import { listSavingsGoals, resolveSavingsGoalAmounts, updateSavingsGoal } from '../../lib/queries';
import { listLiabilities, updateLiability, typeLabel, type Liability } from '../../features/net-worth';
import type { SavingsGoal } from '../../lib/models';
import {
  resolveDebts,
  extraPaymentImpact,
  compareStrategies,
  projectSimplePayoff,
  type DebtInput,
  type PayoffPlan,
  type Strategy,
} from '../../lib/debt-payoff';

// The Planner: when each savings goal is funded, and what order to clear debts
// in. Both are pure arithmetic over data the app already holds — the maths
// lives in lib/goal-planner.ts and lib/debt-payoff.ts so it can be pinned by
// scripts/test-goal-planner.mjs and scripts/test-debt-payoff.mjs under plain
// Node. This file only gathers and renders.
//
// ── Where the numbers come from, and where edits go ─────────────────────────
// Everything the plan needs is a real column: liabilities.interestRate and
// .minimumPayment, savings_goals.targetAmount. When one is null the screen asks
// for it and writes the answer back through updateLiability / updateSavingsGoal,
// so it is entered once, shows everywhere, and journals to sync like every
// other write (AGENTS.md rule 2). No planner-local copy of anything exists.
//
// A null rate is NOT read as 0%. Assuming interest-free would rank a credit
// card below a car loan and recommend clearing the wrong debt first, so a debt
// missing a rate is left out of the plan and named until it has one.
//
// The what-ifs — the extra payment, the strategy, a goal's "by when?" month —
// are deliberately NOT stored. They are things the user spins to see an answer,
// and writing them to the shared budget would turn an experiment into a
// commitment the other member sees.

/**
 * What each goal has actually banked: the months ticked as transferred, each
 * valued at the amount that month was budgeted at.
 *
 * Read straight from SQLite because lib/queries.ts has no "total saved per
 * goal" query and this change does not own that file.
 * The carry-forward subquery mirrors resolveSavingsGoalAmounts exactly — the
 * newest snapshot at or before the month, falling back to the goal's own
 * monthly amount — so a raise in June does not rewrite what went in in March.
 * Read-only: nothing here needs a sync journal entry.
 */
async function loadSavedByGoal(goals: SavingsGoal[]): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ goalId: string; amount: number | null }>(
    `SELECT t.goalId AS goalId,
            (SELECT b.monthlyAmount FROM savings_goal_budgets b
              WHERE b.goalId = t.goalId AND b.yearMonth <= t.yearMonth
              ORDER BY b.yearMonth DESC LIMIT 1) AS amount
       FROM savings_goal_transfers t
      WHERE t.transferred = 1`
  );
  const fallback = new Map(goals.map((g) => [g.id, g.monthlyAmount]));
  // Summed in cents: a column of monthly floats otherwise lands on totals like
  // 1249.9999999999998 and renders a met goal as one cent short.
  const cents = new Map<string, number>();
  for (const row of rows) {
    const amount = row.amount ?? fallback.get(row.goalId) ?? 0;
    cents.set(row.goalId, (cents.get(row.goalId) ?? 0) + Math.round(amount * 100));
  }
  const out = new Map<string, number>();
  for (const g of goals) out.set(g.id, (cents.get(g.id) ?? 0) / 100);
  return out;
}

export default function PlannerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useBudget();
  const currency = settings.currency;
  // Hide amounts has to reach the sentences too — see the note in
  // components/PlannerGoalCard.tsx.
  const cash = (n: number) => (settings.hideAmounts ? maskedAmount(currency) : formatCurrency(n, currency));

  // `/planner?tab=debt` opens straight on the payoff plan, so a link from the
  // Net Worth screen lands on the half of this screen it was talking about
  // rather than on savings goals.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'savings' | 'debt'>(tabParam === 'debt' ? 'debt' : 'savings');
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [monthlyByGoal, setMonthlyByGoal] = useState<Map<string, number>>(new Map());
  const [savedByGoal, setSavedByGoal] = useState<Map<string, number>>(new Map());
  const [liabilities, setLiabilities] = useState<Liability[]>([]);

  // What-ifs, not stored data — see the note at the top of the file. $50 is
  // where every payoff calculator opens; null means the field was cleared, and
  // the maths then reads it as no extra rather than silently keeping the 50.
  const [strategy, setStrategy] = useState<Strategy>('avalanche');
  const [extraInput, setExtraInput] = useState<number | null>(50);
  const [simpleMonthly, setSimpleMonthly] = useState<number | null>(null);
  const extra = extraInput ?? 0;

  const startMonth = currentYearMonth();

  const load = useCallback(async () => {
    const [goalRows, liabilityRows, amounts] = await Promise.all([
      listSavingsGoals(),
      listLiabilities(),
      resolveSavingsGoalAmounts(startMonth),
    ]);
    setGoals(goalRows);
    setLiabilities(liabilityRows);
    setMonthlyByGoal(amounts);
    setSavedByGoal(await loadSavedByGoal(goalRows));
  }, [startMonth]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ── Write-through ─────────────────────────────────────────────────────────
  // Both go through the existing feature functions rather than new SQL: those
  // already journal the whole row to sync, and a second write path would be one
  // more place for a row to diverge silently.

  /** Rewrites the liability's rate or minimum, leaving the rest of the row as
   * it stands — updateLiability replaces every column, so the untouched fields
   * are passed back unchanged. */
  const saveDebtNumbers = useCallback(
    async (row: Liability, patch: { apr?: number | null; minimum?: number | null }) => {
      await updateLiability(row.id, {
        name: row.name,
        type: row.type,
        balance: row.balance,
        note: row.note,
        interestRate: patch.apr !== undefined ? patch.apr : row.interestRate,
        minimumPayment: patch.minimum !== undefined ? patch.minimum : row.minimumPayment,
      });
      await load();
    },
    [load]
  );

  /** Null is a real value here: clearing the field makes the goal open-ended
   * again rather than leaving a stale target behind. */
  const saveGoalTarget = useCallback(
    async (goalId: string, targetAmount: number | null) => {
      await updateSavingsGoal(goalId, { targetAmount });
      await load();
    },
    [load]
  );

  // ── Debt maths ────────────────────────────────────────────────────────────

  const debtInputs: DebtInput[] = useMemo(
    () =>
      liabilities.map((l) => ({
        id: l.id,
        name: l.name,
        balance: l.balance,
        apr: l.interestRate,
        minimum: l.minimumPayment,
      })),
    [liabilities]
  );

  const { resolved, incomplete } = useMemo(() => resolveDebts(debtInputs), [debtInputs]);

  const impact = useMemo(
    () => (resolved.length > 0 ? extraPaymentImpact(resolved, strategy, extra, { startMonth }) : null),
    [resolved, strategy, extra, startMonth]
  );

  const comparison = useMemo(
    () => (resolved.length > 0 ? compareStrategies(resolved, { extra, startMonth }) : null),
    [resolved, extra, startMonth]
  );

  // The answer available before any rate has been entered: balances plus one
  // total monthly payment, no interest. Only offered while no debt has a rate.
  const simplePlan: PayoffPlan | null = useMemo(
    () =>
      resolved.length === 0 && liabilities.length > 0 && simpleMonthly !== null && simpleMonthly > 0
        ? projectSimplePayoff(liabilities, simpleMonthly, { startMonth })
        : null,
    [resolved.length, liabilities, simpleMonthly, startMonth]
  );

  const plan = impact?.boosted ?? null;
  const lineFor = (id: string) => plan?.lines.find((l) => l.id === id) ?? simplePlan?.lines.find((l) => l.id === id) ?? null;
  const positionFor = (id: string) => {
    const source = plan?.lines ?? simplePlan?.lines ?? [];
    const index = source.findIndex((l) => l.id === id);
    return index === -1 ? null : index + 1;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const note = (text: string) => (
    <Text style={[styles.note, { color: theme.tertiaryLabel }]}>{text}</Text>
  );

  return (
    <>
      {/* The route is not declared in app/_layout.tsx, whose Stack hides headers
          by default — without this the screen would render with no title and no
          way back. Declaring options here is route-local and needs no change to
          a layout this file does not own. */}
      <Stack.Screen options={{ headerShown: true, title: 'Planner' }} />
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.tabs}>
          <Chip label="Savings goals" selected={tab === 'savings'} onPress={() => setTab('savings')} />
          <Chip label="Debt payoff" selected={tab === 'debt'} onPress={() => setTab('debt')} />
        </View>

        {tab === 'savings' ? (
          goals.length === 0 ? (
            <Surface style={styles.card}>
              <Text style={[type.headline, { color: theme.label }]}>No savings goals yet</Text>
              {note('Add a goal on the Budget tab and this screen will tell you when it is funded, and what a date would cost per month.')}
            </Surface>
          ) : (
            <>
              {goals.map((g) => (
                <PlannerGoalCard
                  key={g.id}
                  name={g.name}
                  saved={savedByGoal.get(g.id) ?? 0}
                  monthly={monthlyByGoal.get(g.id) ?? g.monthlyAmount}
                  currency={currency}
                  target={g.targetAmount ?? null}
                  startMonth={startMonth}
                  onChangeTarget={(v) => saveGoalTarget(g.id, v)}
                />
              ))}
              {note(
                'Saved so far counts only the months you ticked as transferred, valued at what each month was budgeted at.'
              )}
            </>
          )
        ) : liabilities.length === 0 ? (
          <Surface style={styles.card}>
            <Text style={[type.headline, { color: theme.label }]}>Nothing owed</Text>
            {note('Add what you owe under Net Worth — cards, loans, a mortgage — and the payoff plan appears here.')}
            <Button label="Open Net Worth" variant="tonal" size="sm" onPress={() => router.push('/net-worth')} />
          </Surface>
        ) : (
          <>
            {incomplete.length > 0 ? (
              <Surface style={styles.card}>
                <Text style={[type.headline, { color: theme.label }]}>
                  {resolved.length === 0 ? 'Two numbers are missing' : `${incomplete.length} debt${incomplete.length === 1 ? '' : 's'} left out`}
                </Text>
                {note(
                  'A debt needs its interest rate and minimum payment before it can be ordered or its interest worked out. Guessing them would recommend clearing the wrong debt first, so these are left out until you add both — once, below.'
                )}
                <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>
                  Waiting on: {incomplete.map((d) => d.name).join(', ')}
                </Text>
              </Surface>
            ) : null}

            {resolved.length > 0 && impact ? (
              <>
                <Surface style={styles.card}>
                  <Text style={[styles.eyebrow, { color: theme.secondaryLabel }]}>Paying extra</Text>
                  {impact.unlocksPayoff ? (
                    <Text style={[type.title3, { color: theme.label }]}>
                      {cash(extra)} extra is what makes this payable at all
                    </Text>
                  ) : impact.monthsSaved !== null && impact.monthsSaved > 0 ? (
                    <Text style={[type.title3, { color: theme.label }]}>
                      {cash(extra)} extra clears this {impact.monthsSaved} month
                      {impact.monthsSaved === 1 ? '' : 's'} sooner
                    </Text>
                  ) : (
                    <Text style={[type.title3, { color: theme.label }]}>
                      {extra > 0 ? 'That extra does not change the finish date' : 'Add an extra amount to see what it buys'}
                    </Text>
                  )}
                  {impact.interestSaved !== null && impact.interestSaved > 0 ? (
                    <Text style={{ color: theme.secondaryLabel, fontSize: 14 }}>
                      and saves {cash(impact.interestSaved)} in interest.
                    </Text>
                  ) : null}

                  <View style={styles.splitRow}>
                    <View style={styles.split}>
                      <Text style={[styles.eyebrow, { color: theme.tertiaryLabel }]}>Minimums only</Text>
                      <Text style={{ color: theme.label, fontSize: 15, fontWeight: '600' }}>
                        {impact.base.feasible && impact.base.payoffMonth
                          ? formatMonthLabel(impact.base.payoffMonth)
                          : 'Never'}
                      </Text>
                    </View>
                    <View style={styles.split}>
                      <Text style={[styles.eyebrow, { color: theme.tertiaryLabel }]}>
                        With {cash(extra)} extra
                      </Text>
                      <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>
                        {impact.boosted.feasible && impact.boosted.payoffMonth
                          ? formatMonthLabel(impact.boosted.payoffMonth)
                          : 'Never'}
                      </Text>
                    </View>
                  </View>

                  <PlannerField
                    label="Extra per month"
                    value={extraInput}
                    onChangeValue={setExtraInput}
                    prefix="$"
                    placeholder="50"
                  />

                  {!impact.boosted.feasible ? (
                    <Text style={{ color: theme.systemAmber, fontSize: 13 }}>
                      {impact.boosted.reason === 'interest-outruns-payment'
                        ? 'At this payment the interest grows faster than the balance falls, so it never clears. It needs more per month.'
                        : impact.boosted.reason === 'no-payment'
                          ? 'Nothing is being paid, so nothing clears.'
                          : 'This payment takes over 50 years — treat it as not payable at this rate.'}
                    </Text>
                  ) : null}
                </Surface>

                <View style={styles.tabs}>
                  <Chip
                    label="Avalanche"
                    selected={strategy === 'avalanche'}
                    onPress={() => setStrategy('avalanche')}
                  />
                  <Chip
                    label="Snowball"
                    selected={strategy === 'snowball'}
                    onPress={() => setStrategy('snowball')}
                  />
                </View>
                {note(
                  strategy === 'avalanche'
                    ? 'Avalanche pays the highest rate first. It costs the least overall.'
                    : 'Snowball pays the smallest balance first. It costs a little more, but a debt disappears sooner.'
                )}

                {comparison && comparison.interestDifference !== null ? (
                  <Surface style={styles.card}>
                    <Text style={[styles.eyebrow, { color: theme.secondaryLabel }]}>Avalanche vs snowball</Text>
                    <Text style={{ color: theme.label, fontSize: 14, lineHeight: 19 }}>
                      {comparison.interestDifference > 0
                        ? `Avalanche saves ${cash(comparison.interestDifference)} of interest${
                            comparison.monthsDifference ? ` and ${comparison.monthsDifference} months` : ''
                          }.`
                        : 'Both cost the same here, so pick whichever you will stick to.'}
                    </Text>
                  </Surface>
                ) : null}

                {plan?.feasible && plan.payoffMonth ? (
                  <Surface style={styles.card}>
                    <Text style={[styles.eyebrow, { color: theme.secondaryLabel }]}>Debt free</Text>
                    <Text style={[type.title2, { color: theme.label }]}>{formatMonthLabel(plan.payoffMonth)}</Text>
                    <View style={styles.splitRow}>
                      <View style={styles.split}>
                        <Text style={[styles.eyebrow, { color: theme.tertiaryLabel }]}>Owed now</Text>
                        <AmountText amount={plan.startingBalance} currency={currency} size={15} weight="semibold" />
                      </View>
                      <View style={styles.split}>
                        <Text style={[styles.eyebrow, { color: theme.tertiaryLabel }]}>Interest to come</Text>
                        <AmountText amount={plan.totalInterest} currency={currency} size={15} weight="semibold" />
                      </View>
                      <View style={styles.split}>
                        <Text style={[styles.eyebrow, { color: theme.tertiaryLabel }]}>Per month</Text>
                        <AmountText amount={plan.monthlyBudget} currency={currency} size={15} weight="semibold" />
                      </View>
                    </View>
                    {note(
                      'Interest is worked out monthly from the rate you entered. Your lender charges daily against a statement cycle, so the real figure will be a few dollars either side.'
                    )}
                  </Surface>
                ) : null}
              </>
            ) : (
              <Surface style={styles.card}>
                <Text style={[type.headline, { color: theme.label }]}>Rough projection</Text>
                {note(
                  'Until a rate is entered this is the earliest these balances could clear — it charges no interest at all, so a real card will take longer.'
                )}
                <PlannerField
                  label="Total you can pay each month"
                  value={simpleMonthly}
                  onChangeValue={setSimpleMonthly}
                  prefix="$"
                  placeholder="0"
                />
                {simplePlan?.feasible && simplePlan.payoffMonth ? (
                  <Text style={[type.title3, { color: theme.label }]}>
                    Clear by {formatMonthLabel(simplePlan.payoffMonth)} at the very earliest
                  </Text>
                ) : simplePlan && !simplePlan.feasible ? (
                  <Text style={{ color: theme.systemAmber, fontSize: 13 }}>
                    That payment does not clear these balances within 50 years.
                  </Text>
                ) : null}
              </Surface>
            )}

            {liabilities.map((l) => (
              <PlannerDebtCard
                key={l.id}
                name={l.name}
                balance={l.balance}
                kind={typeLabel('liability', l.type)}
                currency={currency}
                apr={l.interestRate}
                minimum={l.minimumPayment}
                onChange={(patch) => saveDebtNumbers(l, patch)}
                position={positionFor(l.id)}
                line={lineFor(l.id)}
              />
            ))}

            {note('Rates and minimums are saved to each debt, so you enter them once and both phones see them.')}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  card: { gap: spacing.sm },
  eyebrow: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  note: { fontSize: 12, lineHeight: 17 },
  splitRow: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs },
  split: { flex: 1, gap: 2, borderRadius: radius.sm },
});
