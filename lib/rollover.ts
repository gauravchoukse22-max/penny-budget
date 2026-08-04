// Category rollover — last month's unspent money carrying into this one.
//
// Pure: no db, no React. lib/queries.ts gathers the months and this decides
// what carries. scripts/test-rollover.mjs runs it under plain Node.
//
// ── What was here before ────────────────────────────────────────────────────
// features/streaks-and-gamification.ts had getCategoryBudgetWithRollover, used
// by the category detail screen and nothing else. It was wrong in five ways,
// each of which this module fixes:
//
//   1. It looked back exactly ONE month. Rollover accumulates — three quiet
//      months on Groceries should carry three months of underspend, not one.
//   2. Math.max(0, …) threw away overspend, so going $50 over was free and the
//      next month started clean. That is not a budget, it is a scoreboard that
//      only counts wins.
//   3. It fed nothing. Budget Health, the Budget ledger and "left to spend" all
//      ignored it, so the one screen that showed rollover disagreed with every
//      other screen about the same category.
//   4. It summed transactions.amount grouped by categoryId in SQL, which
//      double-counts split transactions — a split's parts live in
//      transaction_splits and its parent row still carries a categoryId.
//   5. setCategoryRolloverEnabled never journalled to sync (AGENTS.md rule 2),
//      so flipping the toggle never reached the other household member.
//
// ── The model ───────────────────────────────────────────────────────────────
// Carry is the running sum of (assigned − spent) over every month BEFORE the
// one being viewed, starting from the first month the category has any history.
//
// Overspend carries as a NEGATIVE, which is what YNAB does and the only honest
// option: money spent is gone, and a category that ran over has less to work
// with next month, not the same amount. The alternative silently prints money.
//
// Carry is deliberately NOT folded into the category's assigned limit. Assigned
// is money taken from THIS month's income, and the income ledger checks that
// the assigned total fits the income. Adding carry there would make every month
// with any underspend read as over-assigned. Carry raises what is AVAILABLE to
// spend without pretending it was assigned — the two numbers answer different
// questions and the Budget screen shows both.

/** Whole cents. Rollover is a running sum over many months, so float drift
 * compounds here rather than cancelling — twelve months of thirds is visibly
 * wrong by December. */
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export interface MonthLedger {
  /** "2026-08" */
  yearMonth: string;
  /** What was assigned to the category that month. */
  assigned: number;
  /** What was spent against it that month. */
  spent: number;
}

/**
 * The balance carried INTO `yearMonth` from every month before it.
 *
 * `history` may arrive in any order and may include the target month itself or
 * later months; both are ignored. Only strictly-earlier months count — a month
 * cannot carry its own underspend into itself.
 */
export function carryInto(history: MonthLedger[], yearMonth: string): number {
  let total = 0;
  for (const m of history) {
    if (m.yearMonth >= yearMonth) continue; // ISO month keys compare lexically
    total += cents(m.assigned) - cents(m.spent);
  }
  return fromCents(total);
}

/**
 * Month keys from `from` to `to` inclusive, ascending.
 *
 * Returns [] when `from` is after `to` rather than looping forever — the
 * callers derive `from` from stored data, and a household member with a fast
 * clock can put a row in the future.
 */
export function monthRange(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  // Guard against a malformed key rather than spinning: NaN comparisons are
  // always false, so the loop below would never terminate.
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(ty) || !Number.isFinite(tm)) return [];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface RolloverInput {
  categoryId: string;
  /** Only categories with the toggle on carry anything. */
  rolloverEnabled: boolean;
  history: MonthLedger[];
}

/**
 * Carry for every category, keyed by id. Categories with rollover off are
 * omitted entirely rather than mapped to 0, so a caller can tell "does not
 * roll over" from "rolls over, and the balance happens to be zero" — the
 * Budget screen words those two differently.
 */
export function rolloversInto(inputs: RolloverInput[], yearMonth: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const input of inputs) {
    if (!input.rolloverEnabled) continue;
    out.set(input.categoryId, carryInto(input.history, yearMonth));
  }
  return out;
}

/**
 * How a carried balance should read to a person.
 *
 * Zero gets its own case: "$0.00 carried over" invites the question "carried
 * over from what?", where "nothing left over last month" answers it.
 */
export function describeCarry(carry: number, format: (n: number) => string): string {
  const c = cents(carry);
  if (c === 0) return 'Nothing left over last month';
  if (c > 0) return `${format(carry)} carried over`;
  return `${format(-carry)} overspent, carried forward`;
}
