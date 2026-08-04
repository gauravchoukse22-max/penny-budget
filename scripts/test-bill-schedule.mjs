// Fixture harness for lib/bill-schedule.ts — the Bills calendar's pure event
// builder. Same shape as test-recurring-detect.mjs: no test runner, just Node
// importing the REAL source through the type-stripping loader and asserting
// exact outputs. Run it with:
//
//   node scripts/test-bill-schedule.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// bill-schedule.ts imports nothing — nothing to stub.
const { monthBillEvents, upcomingBillEvents, clampDay, shiftIsoDate } = await import(
  await transform(join(root, 'lib/bill-schedule.ts'), [])
);

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

const rule = (id, note, amount, dayOfMonth, active = true) => ({ id, note, amount, dayOfMonth, active });
const card = (id, name, dueDay) => ({ id, name, dueDay });

// ── clampDay: month-length clamping, mirroring daysUntilDue ────────────────
eq(clampDay(2026, 2, 31), 28, 'the 31st clamps to Feb 28 in a non-leap year');
eq(clampDay(2028, 2, 31), 29, 'the 31st clamps to Feb 29 in a leap year');
eq(clampDay(2026, 4, 31), 30, 'the 31st clamps to Apr 30');
eq(clampDay(2026, 1, 31), 31, 'the 31st stays the 31st in January');

// ── shiftIsoDate: window arithmetic across boundaries ──────────────────────
eq(shiftIsoDate('2026-12-20', 30), '2027-01-19', '30 days after Dec 20 crosses the year');
eq(shiftIsoDate('2026-03-01', -1), '2026-02-28', 'day-before of Mar 1 is Feb 28');

// ── monthBillEvents ────────────────────────────────────────────────────────
{
  const rules = [rule('r1', 'Water bill', 45, 15), rule('r2', 'Rent', 1200, 31)];
  const cards = [card('c1', 'Sapphire', 31), card('c2', 'Cash', null)];

  const feb = monthBillEvents(rules, cards, 2026, 2);
  eq(
    feb,
    [
      {
        id: 'bill-rec-r1-2026-02-15',
        date: '2026-02-15',
        label: 'Water bill',
        amount: 45,
        source: 'recurring',
      },
      {
        id: 'bill-rec-r2-2026-02-28',
        date: '2026-02-28',
        label: 'Rent',
        amount: 1200,
        source: 'recurring',
      },
      {
        id: 'bill-card-c1-2026-02-28',
        date: '2026-02-28',
        label: 'Sapphire payment',
        amount: null,
        source: 'card-due',
      },
    ],
    'February clamps day-31 rules AND card dues to the 28th; null dueDay is skipped; card amount is null'
  );

  const jan = monthBillEvents(rules, cards, 2026, 1);
  eq(
    jan.map((e) => e.date),
    ['2026-01-15', '2026-01-31', '2026-01-31'],
    'January keeps the 31st (sorted by date)'
  );
}

// ── inactive rules are excluded ────────────────────────────────────────────
eq(
  monthBillEvents([rule('r3', 'Paused gym', 30, 5, false)], [], 2026, 7),
  [],
  'inactive rule produces no events'
);

// ── upcomingBillEvents: 30-day window across month + year boundary ─────────
{
  const rules = [rule('r1', 'Rent', 1200, 31)];
  const cards = [card('c1', 'Sapphire', 5)];

  // Today Dec 20, 2026; window runs through Jan 19, 2027.
  const upcoming = upcomingBillEvents(rules, cards, '2026-12-20');
  eq(
    upcoming.map((e) => `${e.date} ${e.label}`),
    ['2026-12-31 Rent', '2027-01-05 Sapphire payment'],
    'window includes Dec 31 rent and next year\'s Jan 5 card due, sorted; Jan 31 rent falls outside'
  );
  eq(upcoming[1].amount, null, 'card due carries no amount');
  eq(upcoming[1].id, 'bill-card-c1-2027-01-05', 'card due id is stable and derived');
}

// A day-31 bill appears in BOTH months of a window spanning Jan → Feb, each
// clamped independently.
{
  const upcoming = upcomingBillEvents([rule('r1', 'Rent', 1200, 31)], [], '2026-01-30');
  eq(
    upcoming.map((e) => e.date),
    ['2026-01-31', '2026-02-28'],
    'the 31st lands on Jan 31 and again clamped to Feb 28 within one window'
  );
}

// Window boundaries are inclusive on both ends.
{
  const upcoming = upcomingBillEvents(
    [rule('r1', 'Today bill', 10, 20), rule('r2', 'Last-day bill', 20, 19)],
    [],
    '2026-06-20'
  );
  eq(
    upcoming.map((e) => e.date),
    ['2026-06-20', '2026-07-19', '2026-07-20'],
    'today (start) and today+30 (2026-07-20, end) are both included'
  );
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(failures.join('\n\n'));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
