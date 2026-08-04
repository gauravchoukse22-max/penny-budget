// Pure bill-calendar math — no database, no Date.now(), no imports — so
// scripts/test-bill-schedule.mjs can run the REAL source under Node and pin the
// month-clamping and window-crossing behaviour with fixtures.
//
// A "bill event" is one dated occurrence of something the user owes:
//   - a recurring rule (features/recurring-transactions.ts) posting on its
//     dayOfMonth, or
//   - a card's payment due day (cards.dueDay) — amount unknown, so null.
//
// Day-of-month clamping matches lib/queries.ts daysUntilDue: "the 31st"
// resolves to Feb 28 / Apr 30, never overflows into the next month.

/** The fields of a RecurringTransaction this module reads. Kept structural so
 * fixtures don't have to fabricate cardId/categoryId/nextPostDate. */
export type RecurringRuleLike = {
  id: string;
  note: string;
  amount: number;
  /** Day of the month (1-31) the charge posts; clamped per month. */
  dayOfMonth: number;
  active: boolean;
};

/** The fields of a Card this module reads. */
export type CardLike = {
  id: string;
  name: string;
  /** Day of month (1-31) payment is due, or null if not tracked. */
  dueDay: number | null;
};

export type BillEvent = {
  /** Stable, derived id — doubles as the notification identifier so
   * rescheduling replaces rather than duplicates (same precedent as
   * rec-<ruleId>-<postDate> in features/recurring-transactions.ts). */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  label: string;
  /** Null for card dues — the statement balance isn't known here. */
  amount: number | null;
  source: 'recurring' | 'card-due';
};

/** Last day of a month. `month` is 1-based (1 = January). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Clamp a requested day-of-month to the month's actual length. */
export function clampDay(year: number, month: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(year, month));
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sortEvents(events: BillEvent[]): BillEvent[] {
  // Date first, then label, then id — total order, so the calendar, the
  // upcoming list, and the scheduled notifications all agree on sequence.
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  );
}

/**
 * Every bill event that lands in the given calendar month (1-based).
 * Inactive rules are skipped — the user paused them on the Recurring screen.
 */
export function monthBillEvents(
  rules: RecurringRuleLike[],
  cards: CardLike[],
  year: number,
  month: number
): BillEvent[] {
  const events: BillEvent[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    const day = clampDay(year, month, r.dayOfMonth);
    events.push({
      id: `bill-rec-${r.id}-${isoDate(year, month, day)}`,
      date: isoDate(year, month, day),
      label: r.note,
      amount: r.amount,
      source: 'recurring',
    });
  }
  for (const c of cards) {
    if (!c.dueDay) continue;
    const day = clampDay(year, month, c.dueDay);
    events.push({
      id: `bill-card-${c.id}-${isoDate(year, month, day)}`,
      date: isoDate(year, month, day),
      label: `${c.name} payment`,
      amount: null,
      source: 'card-due',
    });
  }
  return sortEvents(events);
}

/** Shift an ISO date by whole days, in local-midnight space (same convention
 * as the rest of the codebase: dates are calendar days, never timestamps). */
export function shiftIsoDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Bill events from `todayStr` (inclusive) through `todayStr + days`
 * (inclusive), sorted soonest first. Spans month and year boundaries by
 * generating each calendar month the window touches and filtering — each
 * month clamps independently, so a "31st" bill appears on Jan 31 AND Feb 28.
 */
export function upcomingBillEvents(
  rules: RecurringRuleLike[],
  cards: CardLike[],
  todayStr: string,
  days = 30
): BillEvent[] {
  const endStr = shiftIsoDate(todayStr, days);
  const events: BillEvent[] = [];
  // Walk month by month from today's month to the window's end month.
  let y = Number(todayStr.slice(0, 4));
  let m = Number(todayStr.slice(5, 7));
  const endY = Number(endStr.slice(0, 4));
  const endM = Number(endStr.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    for (const e of monthBillEvents(rules, cards, y, m)) {
      if (e.date >= todayStr && e.date <= endStr) events.push(e);
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return sortEvents(events);
}
