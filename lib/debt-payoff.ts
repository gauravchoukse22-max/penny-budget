// Debt payoff ordering (avalanche / snowball) and month-by-month projection,
// plus the one number that actually changes behaviour: what an extra $50 a
// month buys you.
//
// Pure: no db, no React, no native modules, so scripts/test-debt-payoff.mjs
// runs it under plain Node. The Planner screen gathers the rows and renders
// what comes back — same split as lib/over-assign.ts.
//
// ── Why a missing rate is not 0% ────────────────────────────────────────────
// `liabilities` stores interestRate and minimumPayment, but both are nullable
// and null means "the user has not told us" — a different thing from zero.
// So `apr` and `minimum` are `number | null` here and `orderDebts` reports
// avalanche as UNAVAILABLE when any rate is missing, naming the rows, rather
// than filling the gap. Defaulting to 0% was considered and rejected: it turns
// a 24% card into a free loan, ranks it below a car loan, and recommends
// clearing the wrong debt first — a wrong answer stated confidently, which is
// worse than no answer. Snowball needs only balances, so it always works.
// `projectSimplePayoff` is the deliberate, LABELLED exception — see its note.

import { addMonths } from './goal-planner';

/** Money rounds to whole cents; a float balance carried through 60 monthly
 * interest accruals drifts far enough to move a payoff date. Non-finite input
 * collapses to 0 rather than poisoning every downstream number with NaN. */
const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) : 0);
const fromCents = (c: number): number => c / 100;
const rate = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);

/** 50 years. A plan longer than this is not a plan; it is reported as not
 * feasible rather than drawn as a schedule. */
export const MAX_PAYOFF_MONTHS = 600;

// ── Inputs ──────────────────────────────────────────────────────────────────

export type Strategy = 'avalanche' | 'snowball';

export interface DebtInput {
  id: string;
  name: string;
  /** Amount owed, positive. Magnitude is taken, matching computeNetWorth: a
   * negative that slipped into storage must not become a credit here. */
  balance: number;
  /** Annual percentage rate as a percentage, e.g. 19.99 for 19.99%. Null when
   * the user hasn't supplied one — the app stores no rate. */
  apr: number | null;
  /** Contractual minimum monthly payment. Null when unknown. */
  minimum: number | null;
}

/** A debt with both missing fields supplied, ready to simulate. */
export interface ResolvedDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minimum: number;
}

/** Splits a mixed list into the rows that can be simulated and the ones still
 * missing a number, so the screen can show a plan for what it has AND name
 * exactly what it needs. */
export function resolveDebts(debts: DebtInput[]): { resolved: ResolvedDebt[]; incomplete: DebtInput[] } {
  const resolved: ResolvedDebt[] = [];
  const incomplete: DebtInput[] = [];
  for (const d of debts) {
    if (d.apr === null || d.minimum === null) incomplete.push(d);
    else resolved.push({ id: d.id, name: d.name, balance: Math.abs(d.balance), apr: rate(d.apr), minimum: Math.abs(d.minimum) });
  }
  return { resolved, incomplete };
}

// ── Ordering ────────────────────────────────────────────────────────────────

export interface Ordering<T extends { id: string; name: string; balance: number }> {
  strategy: Strategy;
  /** False when the strategy needs a field some row is missing. `debts` is
   * then the input order, NOT a fallback ordering — presenting a guessed
   * avalanche as an avalanche is the whole thing to avoid. */
  available: boolean;
  /** Ids missing the field this strategy needs. Empty when available. */
  missingIds: string[];
  debts: T[];
}

/**
 * Avalanche = highest rate first (costs least overall). Snowball = smallest
 * balance first (clears a debt soonest, which is what keeps people going).
 *
 * Ties break on the other strategy's key and then on name, so the order is
 * stable across renders — two cards at the same 19.99% otherwise swapped
 * places on every reload and looked like a bug.
 */
export function orderDebts<T extends { id: string; name: string; balance: number; apr?: number | null }>(
  debts: T[],
  strategy: Strategy
): Ordering<T> {
  if (strategy === 'snowball') {
    const sorted = [...debts].sort(
      (a, b) => Math.abs(a.balance) - Math.abs(b.balance) || (b.apr ?? 0) - (a.apr ?? 0) || a.name.localeCompare(b.name)
    );
    return { strategy, available: true, missingIds: [], debts: sorted };
  }

  const missingIds = debts.filter((d) => d.apr === null || d.apr === undefined).map((d) => d.id);
  if (missingIds.length > 0) {
    return { strategy, available: false, missingIds, debts: [...debts] };
  }
  const sorted = [...debts].sort(
    (a, b) => (b.apr ?? 0) - (a.apr ?? 0) || Math.abs(a.balance) - Math.abs(b.balance) || a.name.localeCompare(b.name)
  );
  return { strategy, available: true, missingIds: [], debts: sorted };
}

// ── Projection ──────────────────────────────────────────────────────────────

export type PayoffReason =
  | 'ok'
  /** Nothing owed. */
  | 'no-debts'
  /** No money going in at all. */
  | 'no-payment'
  /** The payment doesn't even cover the interest, so the balance never falls.
   * This is a real answer, and the one people most need to hear. */
  | 'interest-outruns-payment'
  /** Feasible in principle but past MAX_PAYOFF_MONTHS. */
  | 'too-slow';

export interface DebtPayoffLine {
  id: string;
  name: string;
  startingBalance: number;
  /** Months until this debt hits zero, counting the first payment as month 1.
   * Null when it never clears within the cap. */
  months: number | null;
  /** Month the final payment lands in. Null without a startMonth, or when the
   * debt never clears. */
  payoffMonth: string | null;
  interestPaid: number;
  totalPaid: number;
}

export interface PayoffPlan {
  feasible: boolean;
  reason: PayoffReason;
  strategy: Strategy;
  /** Months to clear everything. Null when not feasible. */
  months: number | null;
  /** Month the last payment lands in. Null without a startMonth or when not
   * feasible. */
  payoffMonth: string | null;
  totalInterest: number;
  totalPaid: number;
  /** Minimums (all debts, including ones already cleared — that rollover is
   * what makes snowball a snowball) plus the extra. Constant every month. */
  monthlyBudget: number;
  startingBalance: number;
  /** In payoff order. */
  lines: DebtPayoffLine[];
  /** True when every rate used was 0 because the app has none stored. The UI
   * MUST say so — the date is a best case that no real card will hit. */
  zeroInterestAssumed: boolean;
}

export interface PayoffOptions {
  /** Paid on top of the minimums every month, thrown at whichever debt the
   * strategy puts first. */
  extra?: number;
  /** "YYYY-MM" the first payment lands in, so lines can carry a real month.
   * Month 1 IS startMonth (same convention as lib/goal-planner.ts). */
  startMonth?: string;
  maxMonths?: number;
}

function emptyPlan(strategy: Strategy, reason: PayoffReason, monthlyBudget: number, zeroInterestAssumed: boolean): PayoffPlan {
  return {
    feasible: reason === 'no-debts',
    reason,
    strategy,
    months: reason === 'no-debts' ? 0 : null,
    payoffMonth: null,
    totalInterest: 0,
    totalPaid: 0,
    monthlyBudget,
    startingBalance: 0,
    lines: [],
    zeroInterestAssumed,
  };
}

/**
 * Month-by-month simulation. Interest accrues first, then the month's budget is
 * paid: every active debt gets its minimum, and whatever is left goes to the
 * debts in strategy order until it runs out.
 *
 * The budget is the sum of ALL minimums plus the extra, held constant — when a
 * debt clears, its minimum rolls onto the next one. Recomputing the budget from
 * only the ACTIVE minimums was tried first and is wrong: it hands the money
 * back to the user each time a debt closes, which is the opposite of both
 * strategies and understates the extra payment's effect by years.
 *
 * Interest is `round(balanceCents × apr / 1200)` — one twelfth of the annual
 * rate, on the cent. Real lenders use daily accrual against a statement cycle;
 * a monthly approximation is what every consumer payoff calculator uses and is
 * within a few dollars over a typical schedule, which the UI wording reflects.
 */
export function projectPayoff(debts: ResolvedDebt[], strategy: Strategy, options: PayoffOptions = {}): PayoffPlan {
  const extraCents = Math.max(0, cents(options.extra ?? 0));
  const maxMonths = options.maxMonths ?? MAX_PAYOFF_MONTHS;
  const startMonth = options.startMonth;

  const active = debts.filter((d) => cents(Math.abs(d.balance)) > 0);
  const zeroInterestAssumed = debts.length > 0 && debts.every((d) => rate(d.apr) === 0);

  const minimumsCents = debts.reduce((s, d) => s + Math.max(0, cents(Math.abs(d.minimum))), 0);
  const budgetCents = minimumsCents + extraCents;

  if (active.length === 0) return emptyPlan(strategy, 'no-debts', fromCents(budgetCents), zeroInterestAssumed);
  if (budgetCents <= 0) return emptyPlan(strategy, 'no-payment', 0, zeroInterestAssumed);

  const ordering = orderDebts(active, strategy);
  const order = ordering.available ? ordering.debts : active;

  const state = order.map((d) => ({
    id: d.id,
    name: d.name,
    startingCents: cents(Math.abs(d.balance)),
    balanceCents: cents(Math.abs(d.balance)),
    minimumCents: Math.max(0, cents(Math.abs(d.minimum))),
    monthlyRate: rate(d.apr) / 1200,
    interestCents: 0,
    paidCents: 0,
    clearedMonth: null as number | null,
  }));

  const startingCents = state.reduce((s, d) => s + d.startingCents, 0);
  let month = 0;
  let stalled = false;

  while (month < maxMonths) {
    const before = state.reduce((s, d) => s + d.balanceCents, 0);
    if (before <= 0) break;
    month += 1;

    for (const d of state) {
      if (d.balanceCents <= 0) continue;
      const interest = Math.round(d.balanceCents * d.monthlyRate);
      d.balanceCents += interest;
      d.interestCents += interest;
    }

    let available = budgetCents;
    // Minimums first, so a debt further down the order is never left unserviced
    // by the extra being thrown at the target.
    for (const d of state) {
      if (d.balanceCents <= 0 || available <= 0) continue;
      const pay = Math.min(d.balanceCents, d.minimumCents, available);
      d.balanceCents -= pay;
      d.paidCents += pay;
      available -= pay;
    }
    // Then everything left, in strategy order.
    for (const d of state) {
      if (d.balanceCents <= 0 || available <= 0) continue;
      const pay = Math.min(d.balanceCents, available);
      d.balanceCents -= pay;
      d.paidCents += pay;
      available -= pay;
    }

    for (const d of state) {
      if (d.balanceCents <= 0 && d.clearedMonth === null) d.clearedMonth = month;
    }

    const after = state.reduce((s, d) => s + d.balanceCents, 0);
    if (after <= 0) break;
    // No progress this month means no progress ever — the budget is constant,
    // and interest on a balance that didn't fall is at least as large next
    // month. Bailing here is what stops the loop running to 600 months and
    // reporting a fake "too slow" for what is really an unpayable minimum.
    if (after >= before) {
      stalled = true;
      break;
    }
  }

  const remaining = state.reduce((s, d) => s + d.balanceCents, 0);
  const totalInterest = state.reduce((s, d) => s + d.interestCents, 0);
  const totalPaid = state.reduce((s, d) => s + d.paidCents, 0);

  const lines: DebtPayoffLine[] = state.map((d) => ({
    id: d.id,
    name: d.name,
    startingBalance: fromCents(d.startingCents),
    months: d.clearedMonth,
    payoffMonth: d.clearedMonth !== null && startMonth ? addMonths(startMonth, d.clearedMonth - 1) : null,
    interestPaid: fromCents(d.interestCents),
    totalPaid: fromCents(d.paidCents),
  }));

  if (remaining > 0) {
    return {
      feasible: false,
      reason: stalled ? 'interest-outruns-payment' : 'too-slow',
      strategy,
      months: null,
      payoffMonth: null,
      totalInterest: fromCents(totalInterest),
      totalPaid: fromCents(totalPaid),
      monthlyBudget: fromCents(budgetCents),
      startingBalance: fromCents(startingCents),
      lines,
      zeroInterestAssumed,
    };
  }

  return {
    feasible: true,
    reason: 'ok',
    strategy,
    months: month,
    payoffMonth: startMonth ? addMonths(startMonth, month - 1) : null,
    totalInterest: fromCents(totalInterest),
    totalPaid: fromCents(totalPaid),
    monthlyBudget: fromCents(budgetCents),
    startingBalance: fromCents(startingCents),
    lines,
    zeroInterestAssumed,
  };
}

/**
 * The fallback for what the app can actually store today: balances and one
 * total monthly payment, no interest, snowball order.
 *
 * This is NOT a payoff date. With no rate it is the earliest date the debt
 * could possibly clear, and every real card will take longer. It sets
 * `zeroInterestAssumed`, and the screen has to label it — an unlabelled 0%
 * projection is the fabricated-rate problem wearing a different hat.
 */
export function projectSimplePayoff(
  debts: { id: string; name: string; balance: number }[],
  monthlyTotal: number,
  options: Omit<PayoffOptions, 'extra'> = {}
): PayoffPlan {
  const resolved: ResolvedDebt[] = debts.map((d) => ({
    id: d.id,
    name: d.name,
    balance: Math.abs(d.balance),
    apr: 0,
    minimum: 0,
  }));
  return projectPayoff(resolved, 'snowball', { ...options, extra: monthlyTotal });
}

// ── The number people act on ────────────────────────────────────────────────

export interface ExtraPaymentImpact {
  /** The plan as it stands. */
  base: PayoffPlan;
  /** The same plan with `extra` more per month. */
  boosted: PayoffPlan;
  extra: number;
  /** Months the extra takes off. Null when either side has no finite answer. */
  monthsSaved: number | null;
  /** Interest the extra avoids. Null when the base never pays off, because
   * "infinite interest minus finite interest" is not a number to show. */
  interestSaved: number | null;
  /** The base plan never clears and the boosted one does — a bigger deal than
   * any month count, and worth its own sentence in the UI. */
  unlocksPayoff: boolean;
}

/**
 * "Paying $50 extra clears this 14 months sooner." Runs the whole simulation
 * twice rather than estimating from the first run: the strategies re-order
 * their rollovers under a bigger budget, so a scaled estimate is wrong by
 * months on any list with more than one debt.
 */
export function extraPaymentImpact(
  debts: ResolvedDebt[],
  strategy: Strategy,
  extra: number,
  options: PayoffOptions = {}
): ExtraPaymentImpact {
  const baseExtra = Math.max(0, options.extra ?? 0);
  const base = projectPayoff(debts, strategy, { ...options, extra: baseExtra });
  const boosted = projectPayoff(debts, strategy, { ...options, extra: baseExtra + Math.max(0, extra) });

  const monthsSaved =
    base.months !== null && boosted.months !== null ? base.months - boosted.months : null;
  const interestSaved =
    base.feasible && boosted.feasible ? Math.round((base.totalInterest - boosted.totalInterest) * 100) / 100 : null;

  return {
    base,
    boosted,
    extra: Math.max(0, extra),
    monthsSaved,
    interestSaved,
    unlocksPayoff: !base.feasible && boosted.feasible,
  };
}

export interface StrategyComparison {
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  /** Interest avalanche saves over snowball. Negative would mean snowball won
   * (possible when balances and rates line up so that they tie in months).
   * Null when either side has no finite answer. */
  interestDifference: number | null;
  /** Months avalanche saves over snowball. Often 0 — the two usually finish
   * together and differ only in interest, which is worth saying outright. */
  monthsDifference: number | null;
  /** Which to recommend. Ties go to snowball: same cost, and clearing a debt
   * sooner is what keeps people paying. */
  recommended: Strategy;
}

export function compareStrategies(debts: ResolvedDebt[], options: PayoffOptions = {}): StrategyComparison {
  const avalanche = projectPayoff(debts, 'avalanche', options);
  const snowball = projectPayoff(debts, 'snowball', options);

  const bothFeasible = avalanche.feasible && snowball.feasible;
  const interestDifference = bothFeasible
    ? Math.round((snowball.totalInterest - avalanche.totalInterest) * 100) / 100
    : null;
  const monthsDifference =
    avalanche.months !== null && snowball.months !== null ? snowball.months - avalanche.months : null;

  return {
    avalanche,
    snowball,
    interestDifference,
    monthsDifference,
    recommended: interestDifference !== null && interestDifference > 0 ? 'avalanche' : 'snowball',
  };
}
