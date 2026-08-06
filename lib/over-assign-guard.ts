// The warning shown at the moment of the edit.
//
// `over-assign.ts` explains a month that is ALREADY over-assigned and offers
// ways out; the Budget tab surfaces that on the red headline row. This is the
// step before: it catches the edit that is about to put you over, so the number
// never lands silently in a screen you might not look at again.
//
// Deliberately a warning, not a block. The ledger's whole model is that you may
// over-assign and then fix it — the same as YNAB. Saving anyway is always
// allowed, and lands you on the existing red row with its fixes.
//
// Kept out of over-assign.ts on purpose: this imports react-native (via
// confirm), and over-assign.ts must stay runnable under plain Node for
// scripts/test-over-assign.mjs.

import { confirmAction } from './confirm';
import { formatCurrency } from './format';
import { projectAssignment, type Projection } from './over-assign';

export { projectAssignment };

/** The one wording every screen uses, so the warning reads the same everywhere. */
export function overAssignWarning(projection: Projection, currency: string): string {
  return (
    `That puts ${formatCurrency(projection.assignedTotal, currency)} against an income of ` +
    `${formatCurrency(projection.income, currency)} — ${formatCurrency(projection.overage, currency)} more ` +
    `than you have.\n\n` +
    `You can still save it. The Budget tab will show what changed and how to fix it.`
  );
}

/**
 * Resolves true when the edit should go through: either it fits, or the user
 * chose to save it anyway.
 *
 * An income of 0 means "not set yet" — a new user assigning their first budget
 * before entering a salary is not making a mistake, and warning them there
 * would be the first thing the app ever said to them.
 */
export async function confirmOverAssign(projection: Projection, currency: string): Promise<boolean> {
  if (!projection.isOver || projection.income <= 0) return true;
  return confirmAction({
    title: 'More than your income',
    message: overAssignWarning(projection, currency),
    confirmLabel: 'Save anyway',
    cancelLabel: 'Go back',
  });
}
