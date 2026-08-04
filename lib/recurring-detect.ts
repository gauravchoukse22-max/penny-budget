// Finds likely recurring charges in raw transaction history — the
// subscriptions nobody set up a recurring rule for.
//
// Pure on purpose: no database access, just Transaction[] in and candidates
// out, so scripts/test-recurring-detect.mjs can pin the behaviour with fixtures
// the same way the statement parser is tested. The caller (the Recurring Watch
// card) supplies the notes of already-tracked recurring rules so this only ever
// surfaces the UNTRACKED ones.

import type { Transaction } from './models';

export type RecurringCandidate = {
  /** Display name — the most recent transaction's note, original casing. */
  name: string;
  /** The grouping key the matches share (see normalizeRecurringNote). */
  normalizedNote: string;
  /** Median of the matched amounts — the price this charge "usually" is. */
  typicalAmount: number;
  /** The most recent charge's amount. */
  latestAmount: number;
  /** How many DISTINCT months this charge appeared in. */
  monthsSeen: number;
  firstMonth: string; // YYYY-MM
  lastMonth: string; // YYYY-MM
  /** True when the latest charge is more than 5% above the median — the
   * "your subscription quietly got more expensive" flag. */
  priceWentUp: boolean;
};

/**
 * Collapses a transaction note to a comparable key. Lowercased, punctuation
 * and runs of 3+ digits dropped — statement notes carry per-charge reference
 * ids ("SPOTIFY *38291", "NETFLIX.COM 866123") that would otherwise make every
 * month of the same subscription look like a different merchant. Short digit
 * runs stay, so "Channel 4" and "Channel 5" remain distinct.
 */
export function normalizeRecurringNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAscending[mid] : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

/**
 * A candidate is a normalized note that appears in >= 3 distinct months with
 * amounts within 10% of each other (max − min <= 10% of the median). The
 * amount band is what separates "Netflix every month" from "the grocery store
 * every month" — a merchant you merely visit often has amounts all over the
 * place, a subscription does not.
 */
export function detectRecurringCharges(
  transactions: Transaction[],
  opts: { excludeNotes?: string[] } = {}
): RecurringCandidate[] {
  const excluded = new Set((opts.excludeNotes ?? []).map(normalizeRecurringNote).filter((n) => n.length > 0));

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    // Refunds and credits (negative amounts) can never be a recurring CHARGE,
    // and folding one in would drag the median toward zero.
    if (!t.note || t.amount <= 0) continue;
    const key = normalizeRecurringNote(t.note);
    if (!key || excluded.has(key)) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [key, txs] of groups) {
    const months = new Set(txs.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;

    const amounts = txs.map((t) => t.amount).sort((a, b) => a - b);
    const typical = median(amounts);
    if (typical <= 0) continue;
    const spread = amounts[amounts.length - 1] - amounts[0];
    if (spread > typical * 0.1) continue;

    // Latest by posted date, createdAt as tiebreak — its note names the card
    // row and its amount is what the price-rise flag compares.
    const latest = txs.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.createdAt > a.createdAt) ? b : a));
    const sortedMonths = Array.from(months).sort();

    candidates.push({
      name: latest.note ?? key,
      normalizedNote: key,
      typicalAmount: typical,
      latestAmount: latest.amount,
      monthsSeen: months.size,
      firstMonth: sortedMonths[0],
      lastMonth: sortedMonths[sortedMonths.length - 1],
      // Strictly above 5%: a price that IS the 5% boundary reads as noise, not
      // a rise, and the epsilon guards float drift (10.49 vs 9.99 * 1.05).
      priceWentUp: latest.amount > typical * 1.05 + 1e-9,
    });
  }

  // Biggest money first — the $60 gym matters more than the $3 icloud tier.
  return candidates.sort((a, b) => b.typicalAmount - a.typicalAmount);
}
