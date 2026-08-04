// Fixture harness for lib/net-worth-history.ts — the Net Worth trend line's
// pure series builder. Same shape as test-bill-schedule.mjs and
// test-over-assign.mjs: no test runner in this repo, just Node importing the
// REAL source through the type-stripping loader and asserting exact outputs.
// Run it with:
//
//   node scripts/test-net-worth-history.mjs
//
// The bar most of these assertions are holding: the chart must never claim to
// know something it does not. There is no history in assets/liabilities, so a
// backfill would be fabrication — the "never before the first snapshot" and
// "one snapshot is not a trend" cases below are the ones that matter, not the
// month arithmetic.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// net-worth-history.ts imports nothing — nothing to stub.
const {
  buildNetWorthSeries,
  changeAcross,
  netWorthChartDomain,
  addMonths,
  monthsBetween,
  monthKeyOf,
  monthKeyFromDate,
  isMonthKey,
  snapshotIdFor,
  formatMonthShort,
  formatMonthYear,
  formatSeriesRange,
} = await import(await transform(join(root, 'lib/net-worth-history.ts'), []));

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

/** A stored snapshot row. netWorth is derived so the fixtures stay consistent. */
const snap = (yearMonth, assetTotal, liabilityTotal, capturedAt = `${yearMonth}-15T12:00:00.000Z`) => ({
  yearMonth,
  assetTotal,
  liabilityTotal,
  netWorth: Math.round((assetTotal - liabilityTotal) * 100) / 100,
  capturedAt,
});

const shape = (p) => `${p.yearMonth}:${p.value}${p.filled ? '~' : ''}`;

// ── Month-key arithmetic ────────────────────────────────────────────────────

eq(addMonths('2026-08', 1), '2026-09', 'next month');
eq(addMonths('2026-12', 1), '2027-01', 'December rolls into next year');
eq(addMonths('2026-01', -1), '2025-12', 'January rolls back into last year');
eq(addMonths('2026-03', -14), '2025-01', 'a multi-year step back lands correctly');
eq(addMonths('2026-08', 0), '2026-08', 'zero delta is identity');
eq(monthsBetween('2026-01', '2026-08'), 7, 'months between within a year');
eq(monthsBetween('2025-11', '2026-02'), 3, 'months between across a year');
eq(monthsBetween('2026-08', '2026-03'), -5, 'months between is negative going backwards');

eq(monthKeyOf('2026-08-04T09:12:33.000Z'), '2026-08', 'month key from an ISO timestamp');
eq(monthKeyOf('2026-08-04'), '2026-08', 'month key from a plain date');

eq(isMonthKey('2026-08'), true, 'well-formed month key');
eq(isMonthKey('2026-13'), false, 'month 13 rejected');
eq(isMonthKey('2026-8'), false, 'unpadded month rejected');
eq(isMonthKey(null), false, 'null is not a month key');

// LOCAL time, not UTC: this is the guard against a user west of UTC filing an
// evening edit on Aug 31 under September. new Date(y, m, d, h) is local.
eq(monthKeyFromDate(new Date(2026, 7, 31, 20, 0, 0)), '2026-08', 'late on the 31st stays in the local month');
eq(monthKeyFromDate(new Date(2026, 0, 1, 0, 30, 0)), '2026-01', 'just after midnight on Jan 1 is January');

// The derived id is what stops two phones creating two rows for one month.
eq(snapshotIdFor('2026-08'), 'nw-2026-08', 'snapshot id is derived from the period');

// ── Labels ──────────────────────────────────────────────────────────────────

eq(formatMonthShort('2026-01'), 'Jan', 'short month');
eq(formatMonthShort('2026-12'), 'Dec', 'short month, December');
eq(formatMonthYear('2026-08'), 'Aug 2026', 'month and year');

// ── The honesty rules ───────────────────────────────────────────────────────

// Nothing recorded → nothing shown. No zero point, no placeholder month.
eq(
  buildNetWorthSeries([], '2026-08'),
  { points: [], status: 'empty', recordedMonths: 0, change: null, rangeLabel: '' },
  'no snapshots → empty, and no invented points'
);

// One snapshot is a real figure but not a trend: 'building', one point, and
// explicitly NO change — a percentage needs two readings.
{
  const s = buildNetWorthSeries([snap('2026-08', 1000, 250)], '2026-08');
  eq(s.status, 'building', 'a single snapshot is still building');
  eq(s.recordedMonths, 1, 'one recorded month');
  eq(s.change, null, 'no change is claimed from one reading');
  eq(s.points.map(shape), ['2026-08:750'], 'one point, the month it was taken');
  eq(s.rangeLabel, 'Aug 2026', 'single-month range label names the month');
}

// THE core rule. A snapshot first taken in June must not produce points for
// January–May, however much nicer a full-width chart would look.
{
  const s = buildNetWorthSeries([snap('2026-06', 5000, 0), snap('2026-07', 5200, 0)], '2026-07');
  eq(s.points.map((p) => p.yearMonth), ['2026-06', '2026-07'], 'series starts at the FIRST snapshot, never before it');
}

// Even with a year of app usage behind it, history starts where the record
// starts — the balances existed before, but nothing wrote them down.
{
  const s = buildNetWorthSeries([snap('2026-08', 900, 100)], '2026-08', null);
  eq(s.points.length, 1, 'a lone snapshot in August yields exactly one point');
}

// ── Gap filling between real snapshots ──────────────────────────────────────

// March and August recorded, nothing between: April–July carry March forward
// and are flagged, so the chart can draw them hollow.
{
  const s = buildNetWorthSeries([snap('2026-03', 10000, 0), snap('2026-08', 12000, 0)], '2026-08', null);
  eq(
    s.points.map(shape),
    ['2026-03:10000', '2026-04:10000~', '2026-05:10000~', '2026-06:10000~', '2026-07:10000~', '2026-08:12000'],
    'months with no edit carry the previous figure forward and are marked filled'
  );
  eq(s.points[1].assetTotal, 10000, 'a filled point carries the asset total too');
  eq(s.points[1].liabilityTotal, 0, 'a filled point carries the liability total too');
  eq(s.recordedMonths, 2, 'only the real snapshots count as recorded');
  eq(s.status, 'ready', 'two real snapshots make a trend');
}

// Silence since the last edit still reaches today — the line does not just stop
// in March when it is August.
{
  const s = buildNetWorthSeries([snap('2026-02', 4000, 1000), snap('2026-03', 4100, 1000)], '2026-06', null);
  eq(
    s.points.map(shape),
    ['2026-02:3000', '2026-03:3100', '2026-04:3100~', '2026-05:3100~', '2026-06:3100~'],
    'the series runs forward to the current month, filled after the last edit'
  );
}

// A co-member's device with a fast clock can push a month this one has not
// reached. Keeping the row is right; dropping it would lose a real figure.
{
  const s = buildNetWorthSeries([snap('2026-08', 100, 0), snap('2026-10', 300, 0)], '2026-08', null);
  eq(s.points.map((p) => p.yearMonth), ['2026-08', '2026-09', '2026-10'], 'a future-dated snapshot is kept, not dropped');
}

// A device whose clock is behind the newest snapshot must not loop or truncate.
{
  const s = buildNetWorthSeries([snap('2026-08', 100, 0)], '2026-01', null);
  eq(s.points.map((p) => p.yearMonth), ['2026-08'], 'a current month before the first snapshot yields just that snapshot');
}

// ── Duplicate rows ──────────────────────────────────────────────────────────
// Should be impossible (derived id + UNIQUE yearMonth), but a doubled point on
// the chart would be a visible lie, so newest capture wins.
{
  const s = buildNetWorthSeries(
    [
      snap('2026-08', 100, 0, '2026-08-02T00:00:00.000Z'),
      snap('2026-08', 900, 0, '2026-08-20T00:00:00.000Z'),
      snap('2026-09', 950, 0),
    ],
    '2026-09',
    null
  );
  eq(s.points.map(shape), ['2026-08:900', '2026-09:950'], 'duplicate months collapse to the newest capture');
}

// Unparseable month keys are skipped rather than poisoning the fill loop.
{
  const s = buildNetWorthSeries(
    [{ yearMonth: 'junk', assetTotal: 1, liabilityTotal: 0, netWorth: 1, capturedAt: 'x' }, snap('2026-08', 500, 0)],
    '2026-08',
    null
  );
  eq(s.points.map(shape), ['2026-08:500'], 'a malformed row is ignored');
}

// ── Windowing ───────────────────────────────────────────────────────────────
{
  const rows = [];
  for (let i = 0; i < 18; i++) rows.push(snap(addMonths('2025-03', i), 1000 + i * 100, 0));
  const all = buildNetWorthSeries(rows, '2026-08', null);
  eq(all.points.length, 18, 'null window shows everything');

  const year = buildNetWorthSeries(rows, '2026-08', 12);
  eq(year.points.length, 12, '12-month window keeps 12 points');
  eq(year.points[0].yearMonth, '2025-09', 'the window is the most recent months');
  eq(year.points[11].yearMonth, '2026-08', 'the window ends on the latest month');

  const six = buildNetWorthSeries(rows, '2026-08', 6);
  eq(six.points.map((p) => p.yearMonth), ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'], '6-month window');
  // Change is measured across what is VISIBLE, so switching range changes the
  // headline figure — as it does in Monarch.
  eq(six.change.amount, 500, 'change is measured across the visible window, not all history');
  eq(year.change.amount, 1100, 'the 1-year window reports its own span');
  // status hangs on total recorded months, never on how many fit the window.
  eq(six.status, 'ready', 'a windowed series is still ready');
}

// A window larger than the data is not padded.
{
  const s = buildNetWorthSeries([snap('2026-07', 10, 0), snap('2026-08', 20, 0)], '2026-08', 12);
  eq(s.points.length, 2, 'a short history is not padded out to fill the window');
}

// ── Change and percent ──────────────────────────────────────────────────────

{
  const s = buildNetWorthSeries([snap('2026-07', 10000, 0), snap('2026-08', 11000, 0)], '2026-08', null);
  eq(s.change, { amount: 1000, percent: 10, fromMonth: '2026-07', toMonth: '2026-08' }, 'a 10% gain');
}

{
  const s = buildNetWorthSeries([snap('2026-07', 10000, 0), snap('2026-08', 9000, 0)], '2026-08', null);
  eq(s.change.amount, -1000, 'a loss is negative');
  eq(s.change.percent, -10, 'a loss reports a negative percent');
}

// Climbing out of debt reads as an improvement. Dividing by the SIGNED base
// would report −50% for halving what you owe, which is exactly backwards for
// the person who most needs the number to feel right.
{
  const s = buildNetWorthSeries([snap('2026-07', 0, 10000), snap('2026-08', 0, 5000)], '2026-08', null);
  eq(s.change.amount, 5000, 'paying down debt is a positive move');
  eq(s.change.percent, 50, 'percent is measured off the absolute base, so debt reduction is +50%');
}

// Crossing zero from below.
{
  const s = buildNetWorthSeries([snap('2026-07', 1000, 3000), snap('2026-08', 4000, 1000)], '2026-08', null);
  eq(s.change.amount, 5000, 'crossing from negative to positive');
  eq(s.change.percent, 250, 'percent off a magnitude-2000 base');
}

// Percent off zero is undefined, not 0 and not infinity.
{
  const s = buildNetWorthSeries([snap('2026-07', 0, 0), snap('2026-08', 500, 0)], '2026-08', null);
  eq(s.change.amount, 500, 'change from zero still has an amount');
  eq(s.change.percent, null, 'percent from a zero base is null, not infinity');
}

// Percent rounds to one decimal.
{
  const s = buildNetWorthSeries([snap('2026-07', 3000, 0), snap('2026-08', 3100, 0)], '2026-08', null);
  eq(s.change.percent, 3.3, 'percent rounds to one decimal place');
}

// A flat stretch reports exactly zero. This is the assertion float drift would
// break: 3100.5 - 3100.5 through carried-forward floats can land on 4.5e-13,
// and the card would announce a change for a month where nothing happened.
{
  const s = buildNetWorthSeries([snap('2026-05', 3100.5, 0), snap('2026-08', 3100.5, 0)], '2026-08', null);
  eq(s.change.amount, 0, 'an unchanged balance reports exactly zero, not float dust');
  eq(s.change.percent, 0, 'and exactly zero percent');
}

// Cents throughout: the classic 0.1 + 0.2 case, through the whole pipeline.
{
  const s = buildNetWorthSeries([snap('2026-07', 0.1, 0), snap('2026-08', 0.3, 0)], '2026-08', null);
  eq(s.change.amount, 0.2, 'a two-cent move is exactly 0.2');
  eq(s.points[1].value, 0.3, 'point values are exact cents');
}
{
  const s = buildNetWorthSeries([snap('2026-07', 124732.33, 0.99), snap('2026-08', 124732.33, 0.33)], '2026-08', null);
  eq(s.change.amount, 0.66, 'a 66-cent move inside a six-figure balance stays exact');
}

// changeAcross on its own: fewer than two points has nothing to compare.
eq(changeAcross([]), null, 'no points, no change');
eq(changeAcross([{ yearMonth: '2026-08', value: 5, assetTotal: 5, liabilityTotal: 0, filled: false }]), null, 'one point, no change');

// ── Range labels ────────────────────────────────────────────────────────────
{
  const sameYear = buildNetWorthSeries([snap('2026-03', 1, 0), snap('2026-08', 2, 0)], '2026-08', null);
  eq(sameYear.rangeLabel, 'Mar – Aug 2026', 'within one year the year is printed once');

  const across = buildNetWorthSeries([snap('2025-11', 1, 0), snap('2026-02', 2, 0)], '2026-02', null);
  eq(across.rangeLabel, 'Nov 2025 – Feb 2026', 'across a year boundary both years are printed');
}
eq(formatSeriesRange([]), '', 'no points, no range label');

// ── Chart domain ────────────────────────────────────────────────────────────
// The reason this app does not reuse components/charts/LineChart for net worth:
// that chart pins the axis to zero, which flattens a real six-figure movement
// into a straight line at the top of an empty chart.
{
  const points = [
    { yearMonth: '2026-07', value: 124000, assetTotal: 124000, liabilityTotal: 0, filled: false },
    { yearMonth: '2026-08', value: 127000, assetTotal: 127000, liabilityTotal: 0, filled: false },
  ];
  const d = netWorthChartDomain(points);
  eq(d.min > 100000, true, 'the domain does not drag itself down to zero');
  eq(Math.round(d.min), 123760, 'lower bound is padded by 8% of the range');
  eq(Math.round(d.max), 127240, 'upper bound is padded by 8% of the range');
}

// A perfectly flat series still gets a drawable range instead of dividing by 0.
{
  const flat = [
    { yearMonth: '2026-07', value: 1000, assetTotal: 1000, liabilityTotal: 0, filled: false },
    { yearMonth: '2026-08', value: 1000, assetTotal: 1000, liabilityTotal: 0, filled: true },
  ];
  const d = netWorthChartDomain(flat);
  eq(d.max > d.min, true, 'a flat series still has a non-zero range');
  eq([d.min, d.max], [950, 1050], 'flat series is padded 5% either side so the line sits mid-height');
}

// A flat series sitting at exactly zero must not produce a zero-height domain.
{
  const d = netWorthChartDomain([
    { yearMonth: '2026-08', value: 0, assetTotal: 0, liabilityTotal: 0, filled: false },
  ]);
  eq([d.min, d.max], [-1, 1], 'a flat zero series falls back to ±1');
}

eq(netWorthChartDomain([]), { min: 0, max: 1 }, 'no points still returns a drawable domain');

// A series spanning zero keeps zero inside the domain, so the break-even rule
// has somewhere real to sit.
{
  const d = netWorthChartDomain([
    { yearMonth: '2026-07', value: -2000, assetTotal: 0, liabilityTotal: 2000, filled: false },
    { yearMonth: '2026-08', value: 3000, assetTotal: 3000, liabilityTotal: 0, filled: false },
  ]);
  eq(d.min < 0 && d.max > 0, true, 'a series crossing zero contains zero');
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(failures.join('\n\n'));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
