import { confirmAction } from './confirm';
import { formatCurrency } from './format';

// Budget allocation vs. salary.
//
// A month's salary is the ceiling for everything the user *plans* to spend:
// the sum of every category's monthly budget plus every savings goal's monthly
// amount. Nothing stops those two from drifting past the salary — you can set
// a $2,000 groceries budget on a $1,500 salary — so the checks here let the
// screens warn before an over-allocated plan gets saved.
//
// This is about the plan, not actual spend. Real transactions going over is a
// separate signal (category status / surplus), already handled elsewhere.

export type Allocation = {
  salary: number;
  /** Sum of every category's monthly budget for the month. */
  categoryTotal: number;
  /** Sum of every savings goal's monthly amount for the month. */
  savingsTotal: number;
  /** categoryTotal + savingsTotal. */
  allocated: number;
  /** salary − allocated. Negative when over-allocated. */
  unallocated: number;
  /** How far past the salary the plan goes; 0 when it fits. */
  overBy: number;
  isOver: boolean;
};

export function buildAllocation(input: {
  salary: number;
  categoryLimits: number[];
  savingsAmounts: number[];
}): Allocation {
  const sum = (ns: number[]) => ns.reduce((total, n) => total + (Number.isFinite(n) ? n : 0), 0);
  const categoryTotal = sum(input.categoryLimits);
  const savingsTotal = sum(input.savingsAmounts);
  const allocated = categoryTotal + savingsTotal;
  const unallocated = input.salary - allocated;
  // Round to cents so float drift (0.1 + 0.2) never reads as "over by $0.00".
  const overBy = Math.max(0, Math.round(-unallocated * 100) / 100);
  return {
    salary: input.salary,
    categoryTotal,
    savingsTotal,
    allocated,
    unallocated,
    overBy,
    isOver: overBy > 0,
  };
}

/**
 * The same allocation, recomputed as if one value were changed — used to check
 * an edit *before* committing it. Pass the id of the row being edited (or
 * `null` for a brand-new row) and its would-be amount.
 */
export function projectAllocation(input: {
  salary: number;
  categories: { id: string; limit: number }[];
  savingsGoals: { id: string; amount: number }[];
  change:
    | { kind: 'salary'; value: number }
    | { kind: 'category'; id: string | null; value: number }
    | { kind: 'savings'; id: string | null; value: number };
}): Allocation {
  const { change } = input;
  const salary = change.kind === 'salary' ? change.value : input.salary;

  const apply = (rows: { id: string; value: number }[], kind: 'category' | 'savings') => {
    if (change.kind !== kind) return rows.map((r) => r.value);
    if (change.id === null) return [...rows.map((r) => r.value), change.value];
    return rows.map((r) => (r.id === change.id ? change.value : r.value));
  };

  return buildAllocation({
    salary,
    categoryLimits: apply(
      input.categories.map((c) => ({ id: c.id, value: c.limit })),
      'category'
    ),
    savingsAmounts: apply(
      input.savingsGoals.map((g) => ({ id: g.id, value: g.amount })),
      'savings'
    ),
  });
}

/** The "you're over your salary" copy, shared by every screen that warns. */
export function overAllocationMessage(allocation: Allocation, currency: string): string {
  return (
    `Your budgets and savings goals add up to ${formatCurrency(allocation.allocated, currency)}, ` +
    `which is ${formatCurrency(allocation.overBy, currency)} more than your salary of ` +
    `${formatCurrency(allocation.salary, currency)}.\n\n` +
    `Lower a category budget or savings goal, or increase your salary.`
  );
}

/**
 * Warns when `allocation` exceeds the salary and asks whether to save anyway.
 * Resolves true when the change should go through — either it fits, or the
 * user chose to keep it. A salary of 0 means "not set yet", so it never warns.
 */
export async function confirmOverAllocation(allocation: Allocation, currency: string): Promise<boolean> {
  if (!allocation.isOver || allocation.salary <= 0) return true;
  return confirmAction({
    title: 'Over your salary',
    message: overAllocationMessage(allocation, currency),
    confirmLabel: 'Save anyway',
    cancelLabel: 'Go back',
    destructive: true,
  });
}
