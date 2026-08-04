// Fixture harness for lib/rollover.ts. Same shape as test-over-assign.mjs:
// no test runner, just Node importing the REAL source through the type-
// stripping loader. Run it with:
//
//   node scripts/test-rollover.mjs
//
// Rollover is a running sum over many months, so the two things most likely to
// break it are accumulation (does month three see months one AND two?) and
// float drift (does it compound instead of cancelling?). Both are pinned here,
// along with the overspend rule the old implementation got wrong by clamping
// negatives away.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const { carryInto, monthRange, rolloversInto, describeCarry } = await import(
  await transform(join(root, 'lib/rollover.ts'), [])
);

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
const m = (yearMonth, assigned, spent) => ({ yearMonth, assigned, spent });
const usd = (n) => `$${n.toFixed(2)}`;

// ── carryInto: accumulation ────────────────────────────────────────────────
eq(carryInto([], '2026-08'), 0, 'no history carries nothing');
eq(carryInto([m('2026-07', 600, 550)], '2026-08'), 50, 'one underspent month carries its remainder');

// The bug the old one-month lookback had: three quiet months must carry three
// months of underspend, not just the most recent.
eq(
  carryInto([m('2026-05', 600, 550), m('2026-06', 600, 500), m('2026-07', 600, 590)], '2026-08'),
  160,
  'carry accumulates across every earlier month, not just the last one'
);

// ── overspend carries as a negative ────────────────────────────────────────
eq(carryInto([m('2026-07', 600, 650)], '2026-08'), -50, 'overspend carries forward as a negative');
eq(
  carryInto([m('2026-06', 600, 500), m('2026-07', 600, 650)], '2026-08'),
  50,
  'an overspent month is netted against an underspent one'
);
eq(
  carryInto([m('2026-06', 100, 400), m('2026-07', 100, 100)], '2026-08'),
  -300,
  'a large overspend stays negative rather than being clamped to zero'
);

// ── only strictly-earlier months count ─────────────────────────────────────
eq(
  carryInto([m('2026-07', 600, 550), m('2026-08', 600, 100)], '2026-08'),
  50,
  'the target month itself does not carry into itself'
);
eq(
  carryInto([m('2026-07', 600, 550), m('2026-09', 600, 0)], '2026-08'),
  50,
  'a later month is ignored, so viewing an earlier month is not polluted by the future'
);
eq(
  carryInto([m('2026-09', 600, 0), m('2026-05', 600, 550), m('2026-07', 600, 500)], '2026-08'),
  150,
  'history may arrive unsorted'
);

// Year boundaries: month keys are compared as strings, so "2026-12" must sort
// before "2027-01" — zero padding is what makes that true.
eq(
  carryInto([m('2026-11', 100, 50), m('2026-12', 100, 40)], '2027-01'),
  110,
  'carry crosses a year boundary'
);
eq(carryInto([m('2027-01', 100, 0)], '2026-12'), 0, 'a next-year month does not carry backwards');

// ── float drift compounds in a running sum ─────────────────────────────────
{
  // Twelve months of 0.1 assigned and 0.2 spent. In binary floating point the
  // naive sum drifts; in whole cents it is exactly -1.20.
  const year = Array.from({ length: 12 }, (_, i) => m(`2026-${String(i + 1).padStart(2, '0')}`, 0.1, 0.2));
  eq(carryInto(year, '2027-01'), -1.2, 'twelve months of thirds sum exactly, with no drift');
}
eq(carryInto([m('2026-07', 0.3, 0.1)], '2026-08'), 0.2, 'a single month of cents is exact');
eq(
  carryInto([m('2026-06', 33.33, 0), m('2026-07', 33.34, 0)], '2026-08'),
  66.67,
  'indivisible cents add up exactly'
);

// ── monthRange ─────────────────────────────────────────────────────────────
eq(monthRange('2026-08', '2026-08'), ['2026-08'], 'a single-month range is inclusive');
eq(monthRange('2026-06', '2026-08'), ['2026-06', '2026-07', '2026-08'], 'a range is ascending and inclusive');
eq(
  monthRange('2026-11', '2027-02'),
  ['2026-11', '2026-12', '2027-01', '2027-02'],
  'a range crosses the year boundary'
);
eq(monthRange('2026-09', '2026-08'), [], 'a backwards range is empty, not infinite');
eq(monthRange('nonsense', '2026-08'), [], 'a malformed key returns empty rather than looping forever');

// ── rolloversInto ──────────────────────────────────────────────────────────
{
  const inputs = [
    { categoryId: 'a', rolloverEnabled: true, history: [m('2026-07', 600, 550)] },
    { categoryId: 'b', rolloverEnabled: false, history: [m('2026-07', 600, 100)] },
    { categoryId: 'c', rolloverEnabled: true, history: [m('2026-07', 100, 100)] },
  ];
  const out = rolloversInto(inputs, '2026-08');
  eq([...out.entries()].sort(), [['a', 50], ['c', 0]], 'only rollover-enabled categories are included');
  eq(out.has('b'), false, 'a category with rollover off is omitted, not mapped to zero');
  eq(out.get('c'), 0, 'a rollover category that broke even is present with a zero balance');
}

// ── describeCarry ──────────────────────────────────────────────────────────
eq(describeCarry(0, usd), 'Nothing left over last month', 'zero gets its own wording');
eq(describeCarry(50, usd), '$50.00 carried over', 'a positive carry reads as carried over');
eq(describeCarry(-50, usd), '$50.00 overspent, carried forward', 'a negative carry names the overspend and stays unsigned in the text');
eq(describeCarry(0.001, usd), 'Nothing left over last month', 'a sub-cent balance is zero, not a rounding artefact');

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
