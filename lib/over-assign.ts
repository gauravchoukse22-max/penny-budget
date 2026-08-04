// Explains an over-assigned month and proposes ways out of it.
//
// Pure: no db, no native modules, no React — every input is passed in, so
// scripts/test-over-assign.mjs can run it under plain Node. The Budget screen
// gathers the data and renders what comes back.
//
// ── What this can and cannot say ────────────────────────────────────────────
// It CANNOT say *when* you over-assigned. category_budgets and
// savings_goal_budgets store only a current value per (thing, month) — there
// is no changed-at column and no history table, so nothing in the database
// knows the order or timing of the edits that got you here. Any "you did this
// on Tuesday" would be invented.
//
// It CAN say where the money sits, and what moved since last month — both are
// real, because the previous month's snapshot is its own row. That turns out
// to be the more useful answer anyway: "Groceries went from $600 to $800" is
// what you act on, not the timestamp.

export type AllocationKind = 'category' | 'goal';

export interface Allocation {
  id: string;
  name: string;
  kind: AllocationKind;
  /** What this month assigns to it. */
  amount: number;
  /** What last month assigned, or null when it did not exist then. */
  previousAmount: number | null;
}

export interface AllocationChange extends Allocation {
  /** amount − previousAmount. Positive means it grew. Null for brand-new rows,
   * which are reported as `isNew` rather than as an infinite increase. */
  delta: number | null;
  isNew: boolean;
}

export type FixKind = 'trim-risers' | 'trim-savings' | 'raise-income' | 'spread';

export interface Fix {
  kind: FixKind;
  /** One line, already phrased for the user. */
  title: string;
  /** What it does and what it costs, in plain words. */
  detail: string;
  /** Income needed for 'raise-income'; undefined for the others. */
  newIncome?: number;
  /** Per-allocation reductions to apply. Empty for 'raise-income'. */
  reductions: { id: string; kind: AllocationKind; name: string; from: number; to: number }[];
}

export interface OverAssignAnalysis {
  /** How much the plan exceeds income by. Always > 0 when this is built. */
  overage: number;
  income: number;
  assignedTotal: number;
  /** Everything holding money, largest first. */
  allocations: AllocationChange[];
  /** Only what grew or is new, biggest increase first — the likely culprits. */
  risers: AllocationChange[];
  /** True when the increases since last month alone account for the overage,
   * i.e. last month's plan would have fit. Lets the UI say so outright. */
  risersExplainIt: boolean;
  fixes: Fix[];
}

/** Money rounds to whole cents; comparing floats directly makes a balanced
 * month read as over-assigned by $0.000000001. */
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Distribute a reduction of `targetCents` across `pool`, proportional to each
 * item's size, never taking an item below zero. Returns per-item new values.
 *
 * Largest-remainder: the proportional split is fractional, so the naive
 * version leaves a cent or two unaccounted and the "fix" still leaves you
 * over. Whatever is left after flooring is handed out a cent at a time to the
 * items with the biggest fractional part.
 */
function proportionalReduction(
  pool: Allocation[],
  targetCents: number
): { id: string; kind: AllocationKind; name: string; from: number; to: number }[] {
  const totalCents = pool.reduce((s, a) => s + cents(a.amount), 0);
  if (totalCents <= 0 || targetCents <= 0) return [];
  const capped = Math.min(targetCents, totalCents);

  const exact = pool.map((a) => ({ a, share: (cents(a.amount) * capped) / totalCents }));
  const floored = exact.map((e) => ({ ...e, cut: Math.floor(e.share) }));
  let remainder = capped - floored.reduce((s, f) => s + f.cut, 0);
  floored
    .map((f, i) => ({ i, frac: f.share - Math.floor(f.share) }))
    .sort((x, y) => y.frac - x.frac)
    .forEach(({ i }) => {
      if (remainder > 0) {
        floored[i].cut += 1;
        remainder -= 1;
      }
    });

  return floored
    .filter((f) => f.cut > 0)
    .map((f) => ({
      id: f.a.id,
      kind: f.a.kind,
      name: f.a.name,
      from: f.a.amount,
      to: fromCents(Math.max(0, cents(f.a.amount) - f.cut)),
    }));
}

/** Take from `pool` in order, emptying each before moving to the next, until
 * `targetCents` is covered. Used by the fixes that have an opinion about which
 * money should go first. */
function sequentialReduction(
  pool: Allocation[],
  targetCents: number
): { id: string; kind: AllocationKind; name: string; from: number; to: number }[] {
  const out: { id: string; kind: AllocationKind; name: string; from: number; to: number }[] = [];
  let left = targetCents;
  for (const a of pool) {
    if (left <= 0) break;
    const available = cents(a.amount);
    if (available <= 0) continue;
    const take = Math.min(available, left);
    left -= take;
    out.push({ id: a.id, kind: a.kind, name: a.name, from: a.amount, to: fromCents(available - take) });
  }
  return out;
}

const money = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

/**
 * Build the explanation and the menu of fixes.
 *
 * Returns null when the month is not actually over-assigned — the caller
 * should not be showing this at all in that case.
 */
export function analyseOverAssignment(
  income: number,
  allocations: Allocation[],
  currency = 'USD'
): OverAssignAnalysis | null {
  const incomeCents = cents(income);
  const assignedCents = allocations.reduce((s, a) => s + cents(a.amount), 0);
  const overageCents = assignedCents - incomeCents;
  if (overageCents <= 0) return null;

  const overage = fromCents(overageCents);

  const withChange: AllocationChange[] = allocations.map((a) => ({
    ...a,
    isNew: a.previousAmount === null,
    delta: a.previousAmount === null ? null : fromCents(cents(a.amount) - cents(a.previousAmount)),
  }));

  const bySize = [...withChange].sort((x, y) => y.amount - x.amount);

  // A brand-new row is treated as a rise of its whole amount — it is new money
  // in the plan, which is exactly what the user needs to see.
  const riseOf = (c: AllocationChange): number => (c.isNew ? c.amount : c.delta ?? 0);
  const risers = withChange.filter((c) => riseOf(c) > 0).sort((x, y) => riseOf(y) - riseOf(x));
  const totalRiseCents = risers.reduce((s, c) => s + cents(riseOf(c)), 0);
  const risersExplainIt = totalRiseCents >= overageCents;

  const fixes: Fix[] = [];

  // 1. Trim what grew. Only offered when the increases can actually cover the
  //    overage — otherwise the fix wouldn't fix anything, and offering it
  //    would waste the user's tap.
  if (risersExplainIt && risers.length > 0) {
    const reductions = sequentialReduction(risers, overageCents);
    const names = reductions.slice(0, 2).map((r) => r.name);
    fixes.push({
      kind: 'trim-risers',
      title: `Undo the increases (${names.join(', ')}${reductions.length > names.length ? '…' : ''})`,
      detail:
        reductions.length === 1
          ? `Puts ${reductions[0].name} back to ${money(reductions[0].to, currency)}. Last month's plan fitted your income.`
          : `Takes ${money(overage, currency)} back off the ${reductions.length} things that went up, biggest first.`,
      reductions,
    });
  }

  // 2. Savings first. The standard advice when a plan doesn't fit: a missed
  //    savings month is recoverable, a missed bill is not.
  const goals = bySize.filter((a) => a.kind === 'goal' && a.amount > 0);
  const goalTotalCents = goals.reduce((s, g) => s + cents(g.amount), 0);
  if (goalTotalCents > 0) {
    const covers = goalTotalCents >= overageCents;
    const reductions = sequentialReduction(goals, overageCents);
    fixes.push({
      kind: 'trim-savings',
      title: covers ? 'Save less this month' : 'Pause savings (covers part of it)',
      detail: covers
        ? `Takes ${money(overage, currency)} off your savings goals, largest first, and leaves every spending category alone.`
        : `Frees ${money(fromCents(goalTotalCents), currency)} of the ${money(overage, currency)}. You would still need to trim ${money(fromCents(overageCents - goalTotalCents), currency)} elsewhere.`,
      reductions,
    });
  }

  // 3. The plan might be right and the income wrong — a raise, a bonus, or a
  //    second income never entered. Cheaper than re-cutting a correct budget.
  fixes.push({
    kind: 'raise-income',
    title: `Set income to ${money(fromCents(assignedCents), currency)}`,
    detail: `Keeps every assignment as it is. Pick this if the plan is right and it is the income that is out of date.`,
    newIncome: fromCents(assignedCents),
    reductions: [],
  });

  // 4. Everyone shares the cut. The fair option when nothing in particular is
  //    to blame.
  if (allocations.length > 1) {
    const reductions = proportionalReduction(bySize, overageCents);
    fixes.push({
      kind: 'spread',
      title: 'Take a little from everything',
      detail: `Shrinks all ${reductions.length} assignments proportionally until the plan fits.`,
      reductions,
    });
  }

  return {
    overage,
    income,
    assignedTotal: fromCents(assignedCents),
    allocations: bySize,
    risers,
    risersExplainIt,
    fixes,
  };
}
