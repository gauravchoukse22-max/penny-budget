// Fixture harness for lib/goal-planner.ts — the Planner screen's savings-goal
// timing maths, in both directions. Same shape as test-over-assign.mjs: no test
// runner, just Node importing the REAL source through the type-stripping
// loader. Run it with:
//
//   node scripts/test-goal-planner.mjs
//
// The cases that matter are the ones with no sensible number: a zero
// contribution, a target already met, a date already gone. Each of those is a
// divide-by-zero, a negative "remaining", or an Infinity away from rendering
// nonsense as a headline.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// goal-planner.ts imports nothing — nothing to stub.
const { forecastGoal, requiredMonthlyForDate, addMonths, monthsBetween, currentMonth, MAX_PROJECTION_MONTHS } =
  await import(await transform(join(root, 'lib/goal-planner.ts'), []));

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function ok(cond, label) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}`);
  }
}

// ── month arithmetic ───────────────────────────────────────────────────────
eq(addMonths('2026-08', 1), '2026-09', 'adding a month inside the year');
eq(addMonths('2026-12', 1), '2027-01', 'adding a month rolls the year over');
eq(addMonths('2026-01', -1), '2025-12', 'subtracting a month rolls the year back');
eq(addMonths('2026-08', 19), '2028-03', 'adding 19 months crosses two year boundaries');
eq(addMonths('2026-08', 0), '2026-08', 'adding nothing is the same month');
eq(addMonths('not-a-month', 3), 'not-a-month', 'a malformed month comes back unchanged, not "NaN-NaN"');
eq(addMonths('2026-13', 1), '2026-13', 'month 13 is rejected rather than normalised');
eq(monthsBetween('2026-08', '2027-06'), 10, 'months between two months');
eq(monthsBetween('2027-06', '2026-08'), -10, 'a backwards span is negative, not absolute');
eq(monthsBetween('2026-08', 'nope'), null, 'a malformed month has no span');
eq(currentMonth(new Date(2026, 0, 31)), '2026-01', 'currentMonth zero-pads the month');

// ── forward: a plain projection ────────────────────────────────────────────
{
  const f = forecastGoal({ saved: 1000, target: 5000, monthly: 200, startMonth: '2026-08' });
  eq(f.status, 'projected', 'a funded-in-future goal is projected');
  eq(f.remaining, 4000, 'remaining is target minus saved');
  eq(f.monthsRemaining, 20, '$4,000 at $200/mo is 20 contributions');
  // Month 1 IS the start month, so 20 contributions land on start + 19.
  eq(f.completionMonth, '2028-03', 'the final contribution lands 19 months after the first');
  eq(f.progress, 0.2, 'progress is saved over target');
  eq(f.overfunded, 0, 'a goal short of target is not overfunded');
}

// A goal needing exactly one more payment completes in the start month itself —
// off-by-one here shows the user a month later than the money actually lands.
{
  const f = forecastGoal({ saved: 800, target: 1000, monthly: 200, startMonth: '2026-08' });
  eq(f.monthsRemaining, 1, 'one contribution left');
  eq(f.completionMonth, '2026-08', 'the last contribution lands this month, not next');
}

// The remainder is a whole payment, not a fraction of one.
{
  const f = forecastGoal({ saved: 0, target: 4050, monthly: 200, startMonth: '2026-01' });
  eq(f.monthsRemaining, 21, 'a part-month remainder still costs a whole contribution');
  eq(f.completionMonth, '2027-09', 'the completion month follows the rounded-up count');
}

// ── forward: already funded ────────────────────────────────────────────────
{
  const f = forecastGoal({ saved: 5000, target: 5000, monthly: 200, startMonth: '2026-08' });
  eq(f.status, 'funded', 'saved exactly the target is funded');
  eq(f.remaining, 0, 'a funded goal needs nothing more');
  eq(f.monthsRemaining, 0, 'a funded goal has no months left');
  eq(f.completionMonth, '2026-08', 'a funded goal completed by now');
  eq(f.progress, 1, 'a funded goal is at 100%');
}

// A target SMALLER than what is already saved must not report negative
// remaining or a progress above 1.
{
  const f = forecastGoal({ saved: 6000, target: 5000, monthly: 200, startMonth: '2026-08' });
  eq(f.status, 'funded', 'saving past the target is still funded');
  eq(f.remaining, 0, 'remaining never goes negative');
  eq(f.overfunded, 1000, 'the amount above target is reported separately');
  eq(f.progress, 1, 'progress is capped at 1');
}

// A target of zero is what an empty target field parses to — it must read as
// "nothing to fund", not as a divide-by-zero in the progress bar.
{
  const f = forecastGoal({ saved: 0, target: 0, monthly: 200, startMonth: '2026-08' });
  eq(f.status, 'funded', 'a zero target is trivially funded');
  eq(f.progress, 1, 'a zero target does not divide by zero');
  eq(f.overfunded, 0, 'nothing saved against a zero target is not overfunded');
}

// ── forward: nothing going in ──────────────────────────────────────────────
{
  const f = forecastGoal({ saved: 1000, target: 5000, monthly: 0, startMonth: '2026-08' });
  eq(f.status, 'stalled', 'a zero contribution never funds the goal');
  eq(f.monthsRemaining, null, 'a stalled goal has no month count — not Infinity');
  eq(f.completionMonth, null, 'a stalled goal has no completion month');
  eq(f.remaining, 4000, 'a stalled goal still reports what is left to find');
  ok(Number.isFinite(f.progress), 'progress stays finite when nothing is going in');
}
{
  const f = forecastGoal({ saved: 1000, target: 5000, monthly: -50, startMonth: '2026-08' });
  eq(f.status, 'stalled', 'a negative contribution is stalled, not a negative month count');
  eq(f.monthsRemaining, null, 'a negative contribution produces no month count');
}

// Non-finite input (an unparsed field reaching the lib) must not become NaN
// months and a "NaN-NaN" date.
{
  const f = forecastGoal({ saved: NaN, target: 5000, monthly: Infinity, startMonth: '2026-08' });
  eq(f.status, 'stalled', 'non-finite input collapses to nothing going in');
  eq(f.remaining, 5000, 'non-finite saved reads as 0, so remaining stays a real number');
}

// ── forward: too slow to be a plan ─────────────────────────────────────────
{
  const f = forecastGoal({ saved: 0, target: 50000, monthly: 1, startMonth: '2026-08' });
  eq(f.status, 'too-slow', '$1/mo against $50,000 is not a plan');
  eq(f.completionMonth, null, 'a century-away date is withheld rather than drawn');
  ok(50000 / 1 > MAX_PROJECTION_MONTHS, 'the fixture really does exceed the cap');
}
// Just inside the cap still projects.
{
  const f = forecastGoal({ saved: 0, target: MAX_PROJECTION_MONTHS, monthly: 1, startMonth: '2026-08' });
  eq(f.status, 'projected', 'exactly at the cap is still a projection');
  eq(f.monthsRemaining, MAX_PROJECTION_MONTHS, 'the cap is inclusive');
}

// Float drift must not leave a goal a fraction of a cent short: 0.1 + 0.2 is
// 0.30000000000000004, and a naive comparison reports "$0.00 to go" forever.
{
  const f = forecastGoal({ saved: 0.1 + 0.2, target: 0.3, monthly: 10, startMonth: '2026-08' });
  eq(f.status, 'funded', 'float drift does not leave a met target unfunded');
}

// ── backward: what the date costs ──────────────────────────────────────────
{
  const r = requiredMonthlyForDate({
    saved: 1000,
    target: 5000,
    targetMonth: '2027-06',
    startMonth: '2026-08',
    monthly: 200,
  });
  eq(r.status, 'required', 'a future date has a required contribution');
  eq(r.monthsAvailable, 11, 'the span counts both the start month and the target month');
  eq(r.requiredMonthly, 363.64, '$4,000 over 11 months, rounded up to the cent');
  eq(r.changeFromCurrent, 163.64, 'the increase is required minus current');
  ok(r.requiredMonthly * r.monthsAvailable >= r.remaining, 'the required amount actually reaches the target');
}

// Rounding must go UP: 33.33 × 3 leaves the goal a cent short on the very date
// it was supposed to be funded.
{
  const r = requiredMonthlyForDate({ saved: 0, target: 100, targetMonth: '2026-10', startMonth: '2026-08' });
  eq(r.monthsAvailable, 3, 'three contributions between August and October');
  eq(r.requiredMonthly, 33.34, 'the required amount rounds up, never down');
  ok(r.requiredMonthly * 3 >= 100, 'three payments of the required amount clear the target');
}

// Same month start and target = one contribution, not zero.
{
  const r = requiredMonthlyForDate({ saved: 0, target: 500, targetMonth: '2026-08', startMonth: '2026-08' });
  eq(r.monthsAvailable, 1, 'a target this month leaves this month to fund it');
  eq(r.requiredMonthly, 500, 'one contribution covers the whole remaining amount');
}

// A contribution that already beats the date reports a negative change rather
// than pretending an increase is needed.
{
  const r = requiredMonthlyForDate({
    saved: 0,
    target: 1000,
    targetMonth: '2027-07',
    startMonth: '2026-08',
    monthly: 500,
  });
  eq(r.monthsAvailable, 12, 'a year of contributions');
  eq(r.requiredMonthly, 83.34, '$1,000 over 12 months rounded up');
  ok(r.changeFromCurrent < 0, 'contributing more than needed reports a negative change');
}

// ── backward: already funded ───────────────────────────────────────────────
{
  const r = requiredMonthlyForDate({ saved: 5000, target: 5000, targetMonth: '2027-06', startMonth: '2026-08' });
  eq(r.status, 'funded', 'a met target needs no contribution');
  eq(r.requiredMonthly, 0, 'a funded goal requires $0/mo');
  eq(r.remaining, 0, 'a funded goal has nothing remaining');
}
{
  const r = requiredMonthlyForDate({ saved: 9000, target: 5000, targetMonth: '2020-01', startMonth: '2026-08' });
  eq(r.status, 'funded', 'funded wins over a past date — there is nothing to schedule');
}

// ── backward: the date has already gone ────────────────────────────────────
{
  const r = requiredMonthlyForDate({ saved: 1000, target: 5000, targetMonth: '2026-07', startMonth: '2026-08' });
  eq(r.status, 'past-date', 'a date behind the start month cannot be scheduled');
  eq(r.monthsAvailable, 0, 'a passed date leaves no contributions');
  eq(r.requiredMonthly, null, 'no per-month figure is invented for a passed date');
  eq(r.changeFromCurrent, null, 'no increase is invented for a passed date');
  eq(r.remaining, 4000, 'the honest answer is the lump still outstanding');
}
{
  const r = requiredMonthlyForDate({ saved: 0, target: 500, targetMonth: 'garbage', startMonth: '2026-08' });
  eq(r.status, 'past-date', 'an unparseable target month is treated as unschedulable, not NaN');
  eq(r.requiredMonthly, null, 'an unparseable month produces no figure');
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
