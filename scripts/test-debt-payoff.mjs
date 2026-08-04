// Fixture harness for lib/debt-payoff.ts — the Planner screen's avalanche /
// snowball ordering and payoff simulation. Same shape as test-over-assign.mjs:
// no test runner, just Node importing the REAL source through the
// type-stripping loader. Run it with:
//
//   node scripts/test-debt-payoff.mjs
//
// Two things are pinned hardest here:
//   * the rollover — when a debt clears, its minimum has to keep working. Get
//     it wrong and the extra-payment headline understates itself by years.
//   * the cases with no payoff date at all: a minimum smaller than the monthly
//     interest, and nothing being paid. Both used to be a runaway loop or an
//     Infinity in a date field.
//
// debt-payoff.ts imports addMonths from goal-planner.ts, so that module is
// transpiled first and its URL handed in as a rewrite — the transpiled output
// lands in a different directory, where './goal-planner' would not resolve.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const goalPlannerUrl = await transform(join(root, 'lib/goal-planner.ts'), []);
const {
  orderDebts,
  resolveDebts,
  projectPayoff,
  projectSimplePayoff,
  extraPaymentImpact,
  compareStrategies,
  MAX_PAYOFF_MONTHS,
} = await import(await transform(join(root, 'lib/debt-payoff.ts'), [], { './goal-planner': goalPlannerUrl }));

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function ok(cond, label) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}`);
  }
}

/** A row whose rate and minimum the user has not filled in yet. */
const stored = (id, name, balance) => ({ id, name, balance, apr: null, minimum: null });
/** A row after the user has supplied the two missing numbers. */
const debt = (id, name, balance, apr, minimum) => ({ id, name, balance, apr, minimum });

// ── ordering ───────────────────────────────────────────────────────────────
{
  // Chosen so the two strategies disagree — a fixture where they happen to
  // match proves nothing about either.
  const debts = [debt('a', 'Card', 5000, 24, 100), debt('b', 'Car', 12000, 6, 250), debt('c', 'Store', 800, 4.9, 25)];
  const snow = orderDebts(debts, 'snowball');
  eq(snow.available, true, 'snowball works from balances alone');
  eq(snow.debts.map((d) => d.id), ['c', 'a', 'b'], 'snowball orders smallest balance first');
  const av = orderDebts(debts, 'avalanche');
  eq(av.available, true, 'avalanche works once every rate is known');
  eq(av.debts.map((d) => d.id), ['a', 'b', 'c'], 'avalanche orders highest rate first');
}

// The product decision, pinned: liabilities.interestRate is nullable and null
// means "not told us", NOT 0%. Avalanche must report itself unavailable and
// name the rows rather than guessing an order — assuming 0% would rank a credit
// card below a car loan and recommend clearing the wrong debt first.
{
  const debts = [stored('a', 'Card', 5000), stored('b', 'Car', 12000)];
  const av = orderDebts(debts, 'avalanche');
  eq(av.available, false, 'avalanche is unavailable when no rate has been entered');
  eq(av.missingIds, ['a', 'b'], 'the rows missing a rate are named');
  const snow = orderDebts(debts, 'snowball');
  eq(snow.available, true, 'snowball still works with no rates at all');
  eq(snow.debts.map((d) => d.id), ['a', 'b'], 'snowball still orders by balance');
}
{
  const av = orderDebts([debt('a', 'Card', 5000, 24, 100), stored('b', 'Car', 12000)], 'avalanche');
  eq(av.available, false, 'one missing rate is enough to withhold avalanche');
  eq(av.missingIds, ['b'], 'only the incomplete row is named');
}

// Ties must break deterministically — two cards at the same rate otherwise
// swap places between renders and read as a bug.
{
  const debts = [debt('b', 'Bravo', 1000, 20, 50), debt('a', 'Alpha', 1000, 20, 50)];
  eq(orderDebts(debts, 'snowball').debts.map((d) => d.name), ['Alpha', 'Bravo'], 'equal balances break the tie on name');
  eq(orderDebts(debts, 'avalanche').debts.map((d) => d.name), ['Alpha', 'Bravo'], 'equal rates break the tie on name');
}

// ── resolveDebts splits what can be simulated from what cannot ─────────────
{
  const { resolved, incomplete } = resolveDebts([
    debt('a', 'Card', 5000, 24, 100),
    stored('b', 'Car', 12000),
    { id: 'c', name: 'Loan', balance: 900, apr: 7, minimum: null },
  ]);
  eq(resolved.map((d) => d.id), ['a'], 'only fully specified rows are resolved');
  eq(incomplete.map((d) => d.id), ['b', 'c'], 'a row missing either field is incomplete');
}

// ── a plain interest-free schedule ─────────────────────────────────────────
{
  const plan = projectPayoff([debt('a', 'Loan', 1200, 0, 100)], 'snowball', { startMonth: '2026-08' });
  eq(plan.feasible, true, 'a 0% loan at $100/mo pays off');
  eq(plan.months, 12, '$1,200 at $100/mo is 12 months');
  eq(plan.payoffMonth, '2027-07', 'month 1 is the start month, so 12 payments land on start + 11');
  eq(plan.totalInterest, 0, 'a 0% loan costs no interest');
  eq(plan.totalPaid, 1200, 'total paid is the balance');
  eq(plan.lines[0].months, 12, 'the per-debt line agrees with the plan');
  eq(plan.lines[0].payoffMonth, '2027-07', 'the per-debt line carries the month');
}

// ── the rollover: a cleared debt's minimum keeps working ───────────────────
// Two debts, $50 minimum each, no extra. Once the $100 debt clears in month 2,
// the whole $100 budget lands on the other one. Recomputing the budget from
// only the ACTIVE minimums would take 10 months here instead of 6.
{
  const debts = [debt('a', 'Small', 100, 0, 50), debt('b', 'Big', 500, 0, 50)];
  const plan = projectPayoff(debts, 'snowball', { startMonth: '2026-01' });
  eq(plan.monthlyBudget, 100, 'the budget is the sum of the minimums');
  eq(plan.lines[0].months, 2, 'the small debt clears in month 2');
  eq(plan.months, 6, "the cleared debt's minimum rolls onto the next one");
  eq(plan.payoffMonth, '2026-06', 'the payoff month follows the month count');
}

// ── the headline: what an extra payment buys ───────────────────────────────
{
  const debts = [debt('a', 'Small', 100, 0, 50), debt('b', 'Big', 500, 0, 50)];
  const impact = extraPaymentImpact(debts, 'snowball', 50, { startMonth: '2026-01' });
  eq(impact.base.months, 6, 'the base plan is unchanged by asking about extra');
  eq(impact.boosted.months, 4, '$50 extra a month clears it in 4');
  eq(impact.monthsSaved, 2, '$50 extra clears this 2 months sooner');
  eq(impact.interestSaved, 0, 'a 0% plan saves no interest, and says 0 rather than null');
  eq(impact.unlocksPayoff, false, 'a plan that already paid off is not "unlocked"');
}

// With real interest the extra also has to save interest, and the books must
// balance: every cent paid is either principal or interest.
{
  const debts = [debt('a', 'Card', 4000, 22.9, 80), debt('b', 'Store', 900, 26.9, 30)];
  const impact = extraPaymentImpact(debts, 'avalanche', 50, { startMonth: '2026-08' });
  ok(impact.base.feasible && impact.boosted.feasible, 'both plans pay off');
  ok(impact.monthsSaved > 0, 'the extra takes real months off');
  ok(impact.interestSaved > 0, 'the extra saves real interest');
  const c = (n) => Math.round(n * 100);
  eq(
    c(impact.base.totalPaid),
    c(impact.base.startingBalance) + c(impact.base.totalInterest),
    'total paid is exactly principal plus interest, to the cent'
  );
  eq(
    c(impact.boosted.totalPaid),
    c(impact.boosted.startingBalance) + c(impact.boosted.totalInterest),
    'the boosted plan balances to the cent too'
  );
}

// ── the payment that never wins ────────────────────────────────────────────
// $1,000 at 24% accrues $20 a month; a $20 minimum exactly matches it and the
// balance never moves. This must terminate with a real reason, not run to the
// month cap and not report a date.
{
  const plan = projectPayoff([debt('a', 'Card', 1000, 24, 20)], 'avalanche', { startMonth: '2026-08' });
  eq(plan.feasible, false, 'a minimum that only covers the interest never pays off');
  eq(plan.reason, 'interest-outruns-payment', 'the reason names the actual problem');
  eq(plan.months, null, 'an unpayable plan has no month count');
  eq(plan.payoffMonth, null, 'an unpayable plan has no payoff month');
}

// ...and an extra payment that turns that into a real plan is the single most
// useful thing the screen can say.
{
  const debts = [debt('a', 'Card', 1000, 24, 20)];
  const impact = extraPaymentImpact(debts, 'avalanche', 100, { startMonth: '2026-08' });
  eq(impact.unlocksPayoff, true, 'the extra makes an unpayable debt payable');
  eq(impact.monthsSaved, null, 'no month saving is invented against a plan that never ends');
  eq(impact.interestSaved, null, 'no interest saving is invented against infinite interest');
  ok(impact.boosted.feasible && impact.boosted.months > 0, 'the boosted plan is real');
}

// ── nothing to pay with, and nothing to pay ────────────────────────────────
{
  const plan = projectPayoff([debt('a', 'Card', 1000, 24, 0)], 'snowball', {});
  eq(plan.reason, 'no-payment', 'no minimum and no extra means no plan');
  eq(plan.feasible, false, 'a plan with no payment is not feasible');
  eq(plan.months, null, 'no payment produces no month count');
}
{
  const plan = projectPayoff([], 'snowball', {});
  eq(plan.reason, 'no-debts', 'an empty list is not a failure');
  eq(plan.feasible, true, 'having no debt is a feasible state');
  eq(plan.months, 0, 'no debt takes no months');
}
{
  const plan = projectPayoff([debt('a', 'Paid off', 0, 24, 50)], 'snowball', {});
  eq(plan.reason, 'no-debts', 'a zero balance is not a debt');
}

// ── too slow to draw ───────────────────────────────────────────────────────
{
  const plan = projectPayoff([debt('a', 'Loan', 100000, 0, 1)], 'snowball', {});
  eq(plan.feasible, false, '$100,000 at $1/mo is not a plan');
  eq(plan.reason, 'too-slow', 'a payoff past the cap is reported as too slow');
  eq(plan.months, null, 'no 8,000-month date is drawn');
  ok(MAX_PAYOFF_MONTHS === 600, 'the cap is 50 years');
}

// ── the no-interest fallback (before any rate has been entered) ────────────
{
  const plan = projectSimplePayoff([stored('a', 'Card', 100), stored('b', 'Car', 500)], 100, { startMonth: '2026-01' });
  eq(plan.feasible, true, 'balances and a monthly total are enough for an earliest-possible date');
  eq(plan.months, 6, '$600 at $100/mo is 6 months with no interest');
  eq(plan.lines.map((l) => l.id), ['a', 'b'], 'the fallback is snowball-ordered');
  eq(plan.zeroInterestAssumed, true, 'the fallback flags that it assumed 0%');
  eq(plan.totalInterest, 0, 'the fallback charges no interest');
}
{
  const plan = projectPayoff([debt('a', 'Card', 1000, 19.99, 100)], 'snowball', {});
  eq(plan.zeroInterestAssumed, false, 'a plan with a real rate is not flagged as assumed');
}

// ── avalanche vs snowball ──────────────────────────────────────────────────
// A big expensive debt next to a small cheap one: paying the expensive one
// first costs less, which is the whole argument for avalanche.
{
  const debts = [debt('a', 'Card', 5000, 25, 100), debt('b', 'Family loan', 1000, 2, 50)];
  const cmp = compareStrategies(debts, { extra: 200, startMonth: '2026-08' });
  ok(cmp.avalanche.feasible && cmp.snowball.feasible, 'both strategies pay off');
  ok(cmp.interestDifference > 0, 'avalanche costs less interest than snowball here');
  eq(cmp.recommended, 'avalanche', 'the cheaper strategy is recommended');
  ok(cmp.monthsDifference !== null, 'both finishing means the month difference is a number');
}
// When the rates are identical there is nothing to gain, and the tie goes to
// snowball — same cost, but a debt clears sooner.
{
  const debts = [debt('a', 'One', 5000, 20, 100), debt('b', 'Two', 1000, 20, 50)];
  const cmp = compareStrategies(debts, { extra: 100, startMonth: '2026-08' });
  eq(cmp.recommended, 'snowball', 'a tie on interest goes to snowball');
}

// ── money is cents ─────────────────────────────────────────────────────────
// Float balances that sum to a clean total must clear exactly, not leave a
// fraction of a cent that keeps the loop running one extra month.
{
  const debts = [debt('a', 'A', 0.1, 0, 0.1), debt('b', 'B', 0.2, 0, 0.2)];
  const plan = projectPayoff(debts, 'snowball', {});
  eq(plan.months, 1, 'float-dust balances clear in the month they are paid');
  eq(plan.totalPaid, 0.3, 'the total is exact, not 0.30000000000000004');
}
// A negative balance that slipped into storage is taken as a magnitude, the
// same way computeNetWorth treats it — it must not become a credit that pays
// off the other debts.
{
  const plan = projectPayoff([debt('a', 'Odd', -500, 0, 100)], 'snowball', {});
  eq(plan.startingBalance, 500, 'a negative balance is taken as an amount owed');
  eq(plan.months, 5, 'a negative balance still takes real months to clear');
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
