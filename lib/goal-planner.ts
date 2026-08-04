// Answers both directions of the savings-goal timing question:
//   forward  — "at $200/mo you're funded in March 2027"
//   backward — "to hit it by June 2027 you need $340/mo"
//
// Pure: no db, no React, no native modules, so scripts/test-goal-planner.mjs
// runs it under plain Node. The Planner screen gathers the numbers and renders
// what comes back — same split as lib/over-assign.ts.
//
// ── Where the inputs come from ──────────────────────────────────────────────
// `saved` and `monthly` are real stored data (ticked transfer months, and the
// goal's monthly amount). `target` is NOT: savings_goals has no target-amount
// column, only `monthlyAmount`. The screen asks the user for it rather than
// inventing one, and this module takes it as a plain argument so it stays
// honest about that either way.
//
// ── Why every answer is a status, not just a number ─────────────────────────
// The interesting cases here are the ones that have no number: a zero
// contribution never funds anything, and a $1/mo contribution against $50,000
// "funds" in the year 6190. Both used to render as a date. Returning a status
// forces the screen to say what is actually true.

/** Money rounds to whole cents; a float division here renders a goal that is
 * exactly funded as $0.01 short. Non-finite input collapses to 0 rather than
 * poisoning every downstream number with NaN. */
const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) : 0);
const fromCents = (c: number): number => c / 100;

/** Beyond this a projection is arithmetic, not a plan. 1200 months is 100
 * years: any date past it is reported as "never at this rate" instead of being
 * drawn as a real month, which is what a $1/mo contribution used to produce. */
export const MAX_PROJECTION_MONTHS = 1200;

// ── Month arithmetic on "YYYY-MM" ───────────────────────────────────────────
// Kept local rather than imported from lib/queries.ts, which pulls in the
// database and would make this module unimportable by the test harness.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Months since year 0. Invalid input returns null so callers can't silently
 * project from NaN. */
export function monthIndex(yearMonth: string): number | null {
  if (!MONTH_RE.test(yearMonth ?? '')) return null;
  const [y, m] = yearMonth.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function monthFromIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** "2026-08" + 5 → "2027-01". Returns the input unchanged when it isn't a
 * month, so a bad value shows as itself rather than as "NaN-NaN". */
export function addMonths(yearMonth: string, delta: number): string {
  const i = monthIndex(yearMonth);
  if (i === null) return yearMonth;
  return monthFromIndex(i + delta);
}

/** Whole months from `from` to `to`; negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number | null {
  const a = monthIndex(from);
  const b = monthIndex(to);
  if (a === null || b === null) return null;
  return b - a;
}

/** The "YYYY-MM" a Date falls in — the screen's default start month. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── Forward: when does this goal finish? ────────────────────────────────────

export type GoalForecastStatus =
  /** Already at or past the target — nothing left to fund. */
  | 'funded'
  /** A real completion month came back. */
  | 'projected'
  /** Nothing is going in, so it never completes. */
  | 'stalled'
  /** Something is going in, but completion is past MAX_PROJECTION_MONTHS. */
  | 'too-slow';

export interface GoalForecast {
  status: GoalForecastStatus;
  /** Still needed to reach the target. Never negative. */
  remaining: number;
  /** Amount saved ABOVE the target, when there is one. Otherwise 0. */
  overfunded: number;
  /** Contributions still to make. Null when there is no finite answer. */
  monthsRemaining: number | null;
  /** Month the final contribution lands in. Null when there is no finite
   * answer; equal to `startMonth` when the goal is already funded. */
  completionMonth: string | null;
  /** 0..1 progress toward the target. A target of 0 or less reports 1. */
  progress: number;
}

export interface GoalForecastInput {
  /** Saved so far. */
  saved: number;
  /** What the goal is for. A target at or below `saved` means funded. */
  target: number;
  /** Per-month contribution. Zero or negative means the goal is stalled — this
   * is the divide-by-zero that used to render "funded ∞". */
  monthly: number;
  /** Month the NEXT contribution lands in. The first contribution therefore
   * lands in `startMonth` itself, so a goal needing exactly one more payment
   * completes in `startMonth`, not the month after. */
  startMonth: string;
}

export function forecastGoal({ saved, target, monthly, startMonth }: GoalForecastInput): GoalForecast {
  const savedCents = cents(saved);
  const targetCents = cents(target);
  const monthlyCents = cents(monthly);

  const remainingCents = Math.max(0, targetCents - savedCents);
  const progress = targetCents <= 0 ? 1 : Math.min(1, Math.max(0, savedCents / targetCents));

  // Funded covers both "reached it" and "the target is smaller than what is
  // already saved" — including a target of zero, which is what an untouched
  // target field parses to.
  if (remainingCents === 0) {
    return {
      status: 'funded',
      remaining: 0,
      overfunded: fromCents(Math.max(0, savedCents - targetCents)),
      monthsRemaining: 0,
      completionMonth: startMonth,
      progress,
    };
  }

  if (monthlyCents <= 0) {
    return {
      status: 'stalled',
      remaining: fromCents(remainingCents),
      overfunded: 0,
      monthsRemaining: null,
      completionMonth: null,
      progress,
    };
  }

  // Ceil: a part-month contribution doesn't finish the goal, so the last one is
  // a whole payment. Integer division on cents keeps it exact.
  const months = Math.ceil(remainingCents / monthlyCents);
  if (months > MAX_PROJECTION_MONTHS) {
    return {
      status: 'too-slow',
      remaining: fromCents(remainingCents),
      overfunded: 0,
      monthsRemaining: null,
      completionMonth: null,
      progress,
    };
  }

  return {
    status: 'projected',
    remaining: fromCents(remainingCents),
    overfunded: 0,
    monthsRemaining: months,
    completionMonth: addMonths(startMonth, months - 1),
    progress,
  };
}

// ── Backward: what does hitting a date cost per month? ──────────────────────

export type GoalRequirementStatus =
  /** Already funded — no contribution is required at all. */
  | 'funded'
  /** The date is behind `startMonth`, so no schedule of payments reaches it. */
  | 'past-date'
  /** A real per-month figure came back. */
  | 'required';

export interface GoalRequirement {
  status: GoalRequirementStatus;
  /** Still needed to reach the target. Never negative. */
  remaining: number;
  /** Contributions available between startMonth and targetMonth, inclusive.
   * 0 for a date already gone. */
  monthsAvailable: number;
  /** Per-month figure that lands on the target by the date. Null when the date
   * has passed — the honest answer there is `remaining`, as a lump. */
  requiredMonthly: number | null;
  /** requiredMonthly − current monthly. Positive means "increase by this".
   * Negative means the current contribution already beats the date. Null when
   * there is no requiredMonthly. */
  changeFromCurrent: number | null;
}

export interface GoalRequirementInput {
  saved: number;
  target: number;
  /** Month the goal should be funded by. */
  targetMonth: string;
  /** Month the next contribution lands in. */
  startMonth: string;
  /** What is being contributed today, for the "increase by" line. Optional —
   * omit and `changeFromCurrent` is the full required amount. */
  monthly?: number;
}

export function requiredMonthlyForDate({
  saved,
  target,
  targetMonth,
  startMonth,
  monthly = 0,
}: GoalRequirementInput): GoalRequirement {
  const savedCents = cents(saved);
  const targetCents = cents(target);
  const remainingCents = Math.max(0, targetCents - savedCents);

  if (remainingCents === 0) {
    return {
      status: 'funded',
      remaining: 0,
      monthsAvailable: 0,
      requiredMonthly: 0,
      changeFromCurrent: null,
    };
  }

  // Inclusive of both ends: a target month equal to the start month still has
  // this month's contribution to work with, so that is 1 payment, not 0.
  const span = monthsBetween(startMonth, targetMonth);
  const monthsAvailable = span === null ? 0 : span + 1;

  if (monthsAvailable <= 0) {
    return {
      status: 'past-date',
      remaining: fromCents(remainingCents),
      monthsAvailable: 0,
      requiredMonthly: null,
      changeFromCurrent: null,
    };
  }

  // Ceil to the cent: rounding down leaves the goal a few cents short on the
  // date it was supposed to be funded, which is exactly the failure this
  // function exists to prevent.
  const requiredCents = Math.ceil(remainingCents / monthsAvailable);
  return {
    status: 'required',
    remaining: fromCents(remainingCents),
    monthsAvailable,
    requiredMonthly: fromCents(requiredCents),
    changeFromCurrent: fromCents(requiredCents - cents(monthly)),
  };
}
