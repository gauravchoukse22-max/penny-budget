// Splitting one transaction across several categories.
//
// Pure: no db, no React, no native modules — scripts/test-transaction-splits.mjs
// imports it under plain Node. lib/queries.ts does the storage, the transaction
// screens do the UI.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A transaction held exactly one categoryId, so a single Costco run that is
// $80 of groceries, $40 of household and $25 of pharmacy had to be filed
// entirely under one of them. That is not a missing convenience — it silently
// corrupts every category total, every Budget Health bar and every Insights
// figure downstream, and nothing surfaces it. The wrong number just looks like
// a number.
//
// ── The invariant ───────────────────────────────────────────────────────────
// Split amounts must sum to the transaction total EXACTLY, in whole cents.
// Everything else here exists to keep that true while a human edits the parts:
// remainderFor() so the last row can be filled in without mental arithmetic,
// and validateSplits() so a plan that does not add up cannot be saved. A split
// set that is a cent off would quietly move a cent out of the category totals,
// which is the exact class of bug splits were introduced to stop.
//
// Sign is carried, not assumed: a refund is a negative transaction and its
// parts are negative too. Rejecting negatives here would make refunds
// unsplittable, so the rule is "same sign as the total, or zero", not
// "positive".

export interface SplitPart {
  /** Null is allowed while editing — an unassigned part is still money that
   * must be accounted for. Saving with nulls is permitted; those parts land in
   * "Uncategorized" the same way an uncategorised transaction does. */
  categoryId: string | null;
  amount: number;
}

/** Whole cents. Comparing split sums as floats reports a correct split as off
 * by 1e-13 and blocks the save with a message the user cannot act on. */
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

export const MIN_SPLIT_PARTS = 2;

export type SplitError =
  | { kind: 'too-few' }
  | { kind: 'sum-mismatch'; difference: number }
  | { kind: 'wrong-sign' }
  | { kind: 'duplicate-category'; categoryId: string };

/**
 * Is this set of parts a legal split of `total`?
 *
 * Returns every problem found rather than the first, so the editor can show
 * the whole picture instead of making the user fix one thing to discover the
 * next.
 */
export function validateSplits(total: number, parts: SplitPart[]): SplitError[] {
  const errors: SplitError[] = [];
  if (parts.length < MIN_SPLIT_PARTS) errors.push({ kind: 'too-few' });

  const totalCents = cents(total);
  const sumCents = parts.reduce((s, p) => s + cents(p.amount), 0);
  if (sumCents !== totalCents) {
    errors.push({ kind: 'sum-mismatch', difference: fromCents(totalCents - sumCents) });
  }

  // A part pointing the opposite way to the transaction is almost always a
  // typo'd minus sign, and it lets the parts sum correctly while attributing
  // impossible spend to a category. Zero is allowed: a placeholder row the
  // user has not filled in yet is not an error until they try to save.
  if (totalCents !== 0) {
    const totalSign = Math.sign(totalCents);
    if (parts.some((p) => cents(p.amount) !== 0 && Math.sign(cents(p.amount)) !== totalSign)) {
      errors.push({ kind: 'wrong-sign' });
    }
  }

  // Two rows on the same category are not wrong arithmetically, but they are
  // always a mistake in practice and they make the split unreadable — the user
  // meant to change one row and added a second.
  const seen = new Set<string>();
  for (const p of parts) {
    if (!p.categoryId) continue;
    if (seen.has(p.categoryId)) errors.push({ kind: 'duplicate-category', categoryId: p.categoryId });
    seen.add(p.categoryId);
  }

  return errors;
}

/** What `parts[index]` would have to be for the split to add up. Powers the
 * "fill the rest" affordance so the last row never has to be worked out by
 * hand — which is where users introduce the off-by-a-cent errors. */
export function remainderFor(total: number, parts: SplitPart[], index: number): number {
  const others = parts.reduce((s, p, i) => (i === index ? s : s + cents(p.amount)), 0);
  return fromCents(cents(total) - others);
}

/** Split `total` into `count` as-equal-as-possible parts that sum EXACTLY.
 *
 * Largest-remainder: $10.00 in 3 is 333.33 cents each, and flooring loses a
 * cent, so the split would not add up and could not be saved. The leftover
 * cents go to the earliest parts. */
export function equalParts(total: number, count: number): number[] {
  if (count <= 0) return [];
  const totalCents = cents(total);
  const base = Math.trunc(totalCents / count);
  let remainder = totalCents - base * count;
  const step = Math.sign(remainder) || 1;
  return Array.from({ length: count }, () => {
    let value = base;
    if (remainder !== 0) {
      value += step;
      remainder -= step;
    }
    return fromCents(value);
  });
}

/**
 * How much this transaction puts against each category.
 *
 * The ONE place that decides splits-beat-categoryId, so every consumer agrees.
 * A transaction with splits ignores its own categoryId entirely — keeping the
 * column populated as a fallback for older builds is fine, but counting BOTH
 * would double the money.
 *
 * Null-category amounts are returned under `null`, so uncategorised money stays
 * visible in totals instead of silently vanishing from the books.
 */
export function categoryAmounts(
  tx: { amount: number; categoryId: string | null; splits?: SplitPart[] | null }
): Map<string | null, number> {
  const out = new Map<string | null, number>();
  const add = (key: string | null, amount: number) => {
    out.set(key, fromCents(cents(out.get(key) ?? 0) + cents(amount)));
  };

  if (tx.splits && tx.splits.length > 0) {
    for (const p of tx.splits) add(p.categoryId, p.amount);
    return out;
  }
  add(tx.categoryId, tx.amount);
  return out;
}

/** Stable id for a split row.
 *
 * Derived, not random, per AGENTS.md: two devices in a household that both
 * apply the same imported transaction must produce the same split ids, or the
 * sync mirror ends up holding two copies of every part and the category totals
 * double on the second device. */
export function splitId(transactionId: string, index: number): string {
  return `split-${transactionId}-${index}`;
}
