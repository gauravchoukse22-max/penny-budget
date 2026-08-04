// Turns a table of monthly net-worth snapshots into a trend line.
//
// Pure: no db, no React, no native modules — every input is passed in, so
// scripts/test-net-worth-history.mjs runs it under plain Node. Same split as
// lib/over-assign.ts: features/net-worth.ts does the database, the Net Worth
// screen renders what comes back.
//
// ── The honesty rule this file exists to enforce ────────────────────────────
// `assets` and `liabilities` each hold one current balance and no history, so
// before the first snapshot lands there is genuinely nothing to plot. Monarch
// and Copilot draw this line from a bank feed's daily balances; this app has
// whatever the user last typed in. That difference is not cosmetic:
//
//   • Nothing is EVER emitted before the first real snapshot. Backfilling
//     today's balance backwards was the obvious way to get a full-width chart
//     on day one, and it is a lie — it draws a confident flat line through
//     months the user may have been thousands of dollars poorer.
//   • A month with no snapshot AFTER the first one carries the previous value
//     forward and is flagged `filled`. That is not invention: "nobody touched
//     a balance in May" really does mean net worth was unchanged as far as
//     this app can know. The chart still draws those points hollow so the user
//     can tell a confirmed figure from a carried one.
//   • One snapshot is not a trend. `status` reports 'building' so the screen
//     can say so in words instead of drawing a one-point line.
//
// ── Why the month labels are hand-rolled ────────────────────────────────────
// lib/format.ts formats months through toLocaleDateString, which is the right
// call in the app but makes exact assertions unpinnable — Node's ICU build and
// the device's do not always agree on abbreviations. The range label is part of
// what the harness checks, so it uses a fixed table.

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Money rounds to whole cents. A carried-forward value that went through a
 * float subtraction otherwise reports a $0.0000000001 "change" for a month
 * where nothing happened at all. */
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

// ── Types ───────────────────────────────────────────────────────────────────

/** One stored row of `net_worth_snapshots`, as the feature module reads it. */
export interface NetWorthSnapshot {
  /** 'YYYY-MM'. */
  yearMonth: string;
  assetTotal: number;
  liabilityTotal: number;
  netWorth: number;
  /** ISO timestamp of the write that produced this row. */
  capturedAt: string;
}

export interface NetWorthPoint {
  yearMonth: string;
  /** Net worth — what the line plots. */
  value: number;
  assetTotal: number;
  liabilityTotal: number;
  /** True when no snapshot exists for this month and the previous month's
   * figures were carried forward. Drawn hollow, never presented as confirmed. */
  filled: boolean;
}

/**
 * 'empty'    — no snapshot has ever been taken; there is nothing to show.
 * 'building' — exactly one; a real figure, but not yet a trend.
 * 'ready'    — two or more; the line means something.
 */
export type NetWorthTrendStatus = 'empty' | 'building' | 'ready';

export interface NetWorthChange {
  /** Last point minus first point, in currency units. */
  amount: number;
  /** Null when the starting value is zero — a percentage off zero is
   * undefined, and rendering "∞%" or "0%" would both be wrong. */
  percent: number | null;
  fromMonth: string;
  toMonth: string;
}

export interface NetWorthSeries {
  /** Chronological, one per month, first real snapshot → latest month. */
  points: NetWorthPoint[];
  status: NetWorthTrendStatus;
  /** Real (non-filled) snapshots that exist in total, ignoring the window —
   * this is what 'building' vs 'ready' hangs on. */
  recordedMonths: number;
  /** Movement across the visible window. Null unless status is 'ready'. */
  change: NetWorthChange | null;
  /** "Mar – Aug 2026", already phrased for display. Empty when there are no
   * points. */
  rangeLabel: string;
}

// ── Month-key arithmetic ────────────────────────────────────────────────────
// 'YYYY-MM' sorts and compares correctly as a plain string, so there is no
// comparator here on purpose.

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY.test(value);
}

/** 'YYYY-MM' from an ISO date or timestamp. */
export function monthKeyOf(isoDate: string): string {
  return typeof isoDate === 'string' ? isoDate.slice(0, 7) : '';
}

/**
 * 'YYYY-MM' for a Date, in the device's LOCAL time.
 *
 * Deliberately not toISOString().slice(0,7): on the last evening of a month,
 * a user west of UTC is already in the next month by UTC reckoning, so the
 * snapshot would file itself under a month the user has not reached. The
 * capture path and the chart both call this, so they can never disagree about
 * which month it is.
 */
export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const absolute = y * 12 + (m - 1) + delta;
  const year = Math.floor(absolute / 12);
  const month = absolute - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** How many months from `a` to `b`. Negative when `b` is earlier. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

/**
 * The snapshot row's primary key, derived from the period rather than random.
 *
 * Two phones in one household both write a snapshot for the same month the
 * moment either of them edits a balance. With uuid() ids that is two rows for
 * August and two points on the chart; with this, the second write is an upsert
 * onto the first (AGENTS.md rule 2, same reasoning as `rec-<ruleId>-<postDate>`
 * in features/recurring-transactions.ts).
 */
export function snapshotIdFor(yearMonth: string): string {
  return `nw-${yearMonth}`;
}

// ── Labels ──────────────────────────────────────────────────────────────────

export function formatMonthShort(yearMonth: string): string {
  const m = Number(yearMonth.slice(5, 7));
  return MONTH_ABBR[m - 1] ?? yearMonth;
}

export function formatMonthYear(yearMonth: string): string {
  return `${formatMonthShort(yearMonth)} ${yearMonth.slice(0, 4)}`;
}

/** "Aug 2026" for one point, "Mar – Aug 2026" within a year, "Nov 2025 – Aug
 * 2026" across one. The year is printed once when it is the same at both ends,
 * because repeating it in a 4-word label reads as noise. */
export function formatSeriesRange(points: NetWorthPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0].yearMonth;
  const last = points[points.length - 1].yearMonth;
  if (first === last) return formatMonthYear(first);
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${formatMonthShort(first)} – ${formatMonthShort(last)} ${last.slice(0, 4)}`;
  }
  return `${formatMonthYear(first)} – ${formatMonthYear(last)}`;
}

// ── Series building ─────────────────────────────────────────────────────────

/** Guard against a malformed month key walking the fill loop forever. 100 years
 * of monthly points is far past anything this chart would ever render. */
const MAX_POINTS = 1200;

/**
 * Build the trend series.
 *
 * @param snapshots   Rows as stored. Order and duplicates are tolerated.
 * @param currentMonth The month the device is in, from monthKeyFromDate.
 * @param windowMonths How many months to show, or null for everything.
 */
export function buildNetWorthSeries(
  snapshots: NetWorthSnapshot[],
  currentMonth: string,
  windowMonths: number | null = 12
): NetWorthSeries {
  // Two rows for one month should be impossible — the id is derived from the
  // month and the column is UNIQUE — but a remote row that arrived from a build
  // that got this wrong must not double a point on the chart. Newest capture
  // wins, matching the last-writer-wins upsert the sync pull performs.
  const byMonth = new Map<string, NetWorthSnapshot>();
  for (const s of snapshots) {
    if (!isMonthKey(s?.yearMonth)) continue;
    const existing = byMonth.get(s.yearMonth);
    if (!existing || (s.capturedAt ?? '') >= (existing.capturedAt ?? '')) {
      byMonth.set(s.yearMonth, s);
    }
  }

  const real = [...byMonth.values()].sort((a, b) => (a.yearMonth < b.yearMonth ? -1 : 1));
  if (real.length === 0) {
    return { points: [], status: 'empty', recordedMonths: 0, change: null, rangeLabel: '' };
  }

  const firstMonth = real[0].yearMonth;
  const lastReal = real[real.length - 1].yearMonth;
  // Fill through today, or through the newest snapshot when that is later — a
  // co-member's device with a fast clock can push a month this device has not
  // reached, and dropping their row would lose a real figure.
  const endMonth = isMonthKey(currentMonth) && currentMonth > lastReal ? currentMonth : lastReal;

  const points: NetWorthPoint[] = [];
  let month = firstMonth;
  let previous: NetWorthPoint | null = null;
  while (month <= endMonth && points.length < MAX_POINTS) {
    const snapshot = byMonth.get(month);
    const point: NetWorthPoint = snapshot
      ? {
          yearMonth: month,
          value: fromCents(cents(snapshot.netWorth)),
          assetTotal: fromCents(cents(snapshot.assetTotal)),
          liabilityTotal: fromCents(cents(snapshot.liabilityTotal)),
          filled: false,
        }
      : {
          yearMonth: month,
          // previous is never null here: the loop starts on a month that has a
          // snapshot, so the first iteration always takes the branch above.
          value: previous!.value,
          assetTotal: previous!.assetTotal,
          liabilityTotal: previous!.liabilityTotal,
          filled: true,
        };
    points.push(point);
    previous = point;
    month = addMonths(month, 1);
  }

  const windowed =
    windowMonths !== null && windowMonths > 0 && points.length > windowMonths
      ? points.slice(-windowMonths)
      : points;

  const recordedMonths = real.length;
  const status: NetWorthTrendStatus = recordedMonths >= 2 ? 'ready' : 'building';

  return {
    points: windowed,
    status,
    recordedMonths,
    change: status === 'ready' ? changeAcross(windowed) : null,
    rangeLabel: formatSeriesRange(windowed),
  };
}

/**
 * Movement from the first visible point to the last.
 *
 * Percent is measured against the ABSOLUTE starting value, so climbing out of
 * debt from −$10,000 to −$5,000 reads as +50% rather than −50%. Dividing by the
 * signed value flips the sign of every improvement made while underwater, which
 * is the one audience that most needs the number to feel right.
 */
export function changeAcross(points: NetWorthPoint[]): NetWorthChange | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const deltaCents = cents(last.value) - cents(first.value);
  const baseCents = Math.abs(cents(first.value));
  return {
    amount: fromCents(deltaCents),
    percent: baseCents === 0 ? null : Math.round((deltaCents / baseCents) * 1000) / 10,
    fromMonth: first.yearMonth,
    toMonth: last.yearMonth,
  };
}

/**
 * The vertical range the chart should draw over.
 *
 * components/charts/LineChart.tsx forces 0 into its domain, which is right for
 * spending (a category's floor is zero) and wrong here: a net worth moving
 * between $124,000 and $127,000 renders as a dead-flat line at the top of a
 * chart that is 97% empty space. This scales to the data and only includes zero
 * when the series actually crosses it, so a real $3,000 gain looks like one.
 *
 * A completely flat series gets an arbitrary ±1 unit of padding so it lands
 * mid-height instead of dividing by a zero range.
 */
export function netWorthChartDomain(points: NetWorthPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 1 };
  const values = points.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) {
    const pad = Math.max(1, Math.abs(low) * 0.05);
    return { min: low - pad, max: high + pad };
  }
  const pad = (high - low) * 0.08;
  return { min: low - pad, max: high + pad };
}
