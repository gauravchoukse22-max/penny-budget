// Fixture harness for lib/over-assign.ts — the Budget screen's explanation of
// an over-assigned month and the fixes it offers. Same shape as
// test-bill-schedule.mjs: no test runner, just Node importing the REAL source
// through the type-stripping loader. Run it with:
//
//   node scripts/test-over-assign.mjs
//
// The money maths is what matters here. Every fix promises to close the gap
// exactly; a fix that leaves you a cent over is a fix that didn't work, and
// the proportional split is where that goes wrong first.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// over-assign.ts imports nothing — nothing to stub.
const { analyseOverAssignment, projectAssignment } = await import(await transform(join(root, 'lib/over-assign.ts'), []));

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

const cat = (id, name, amount, previousAmount = null) => ({ id, name, kind: 'category', amount, previousAmount });
const goal = (id, name, amount, previousAmount = null) => ({ id, name, kind: 'goal', amount, previousAmount });

/** Total assigned after applying a fix's reductions. */
const totalAfter = (allocations, fix) => {
  const byId = new Map(allocations.map((a) => [a.id, a.amount]));
  for (const r of fix.reductions) byId.set(r.id, r.to);
  return Math.round([...byId.values()].reduce((s, v) => s + Math.round(v * 100), 0)) / 100;
};

// ── not over-assigned → nothing to explain ─────────────────────────────────
eq(analyseOverAssignment(1000, [cat('a', 'Rent', 600), cat('b', 'Food', 400)]), null, 'an exactly balanced month returns null');
eq(analyseOverAssignment(1000, [cat('a', 'Rent', 600)]), null, 'an under-assigned month returns null');

// Float drift must not fake an over-assignment: 0.1+0.2 is 0.30000000000000004
// in binary floating point, and comparing that to 0.3 the naive way reports the
// month as over by a fraction of a cent.
eq(analyseOverAssignment(0.3, [cat('a', 'A', 0.1), cat('b', 'B', 0.2)]), null, 'float drift does not fake an overage');

// ── the headline numbers ───────────────────────────────────────────────────
{
  const allocations = [cat('m', 'Mortgage', 2141, 2000), cat('g', 'Groceries', 800, 600), goal('e', 'Emergency', 200, 200)];
  const a = analyseOverAssignment(3000, allocations);
  eq(a.overage, 141, 'overage is assigned minus income');
  eq(a.assignedTotal, 3141, 'assignedTotal sums every allocation');
  eq(a.allocations.map((x) => x.name), ['Mortgage', 'Groceries', 'Emergency'], 'allocations come back largest first');
  eq(a.risers.map((x) => x.name), ['Groceries', 'Mortgage'], 'risers are sorted by size of increase, not size of assignment');
  eq(a.risers.map((x) => x.delta), [200, 141], 'delta is this month minus last month');
  ok(a.risersExplainIt, '$341 of increases more than covers a $141 overage');
}

// ── a brand-new allocation counts as a rise of its whole amount ────────────
{
  const allocations = [cat('m', 'Mortgage', 2000, 2000), cat('n', 'New thing', 150, null)];
  const a = analyseOverAssignment(2100, allocations);
  eq(a.risers.map((x) => x.name), ['New thing'], 'a new row is a riser');
  eq(a.risers[0].isNew, true, 'a new row is flagged isNew');
  eq(a.risers[0].delta, null, 'a new row has no delta rather than a fake one');
  ok(a.risersExplainIt, '$150 of new money covers a $50 overage');
}

// ── risersExplainIt is false when the plan was already too big ─────────────
{
  const a = analyseOverAssignment(1000, [cat('a', 'Rent', 900, 900), cat('b', 'Food', 400, 350)]);
  eq(a.overage, 300, 'overage is 300');
  ok(!a.risersExplainIt, 'a $50 rise cannot explain a $300 overage');
  ok(!a.fixes.some((f) => f.kind === 'trim-risers'), 'the trim-risers fix is withheld when it would not close the gap');
}

// ── every fix closes the gap exactly ───────────────────────────────────────
{
  const allocations = [
    cat('m', 'Mortgage', 2141, 2000),
    cat('g', 'Groceries', 800, 600),
    cat('u', 'Utilities', 500, 500),
    goal('e', 'Emergency', 300, 300),
    goal('v', 'Vacation', 200, 200),
  ];
  const income = 3800;
  const a = analyseOverAssignment(income, allocations);
  eq(a.overage, 141, 'overage is 141');

  for (const fix of a.fixes) {
    if (fix.kind === 'raise-income') {
      eq(fix.newIncome, 3941, 'raise-income proposes exactly the assigned total');
      eq(fix.reductions.length, 0, 'raise-income changes no assignment');
    } else {
      eq(totalAfter(allocations, fix), income, `fix "${fix.kind}" lands exactly on income`);
    }
  }
}

// ── the proportional split must not leave stray cents ──────────────────────
// Three equal allocations and an overage that does not divide by three: the
// naive floor-everything version loses a cent and leaves the month over.
{
  const allocations = [cat('a', 'A', 100), cat('b', 'B', 100), cat('c', 'C', 100)];
  const a = analyseOverAssignment(299.99, allocations);
  eq(a.overage, 0.01, 'a one-cent overage is still an overage');
  const spread = a.fixes.find((f) => f.kind === 'spread');
  eq(totalAfter(allocations, spread), 299.99, 'a one-cent spread lands exactly, not a cent short');
  eq(spread.reductions.length, 1, 'one cent is taken from exactly one allocation, not smeared across three');
}
{
  const allocations = [cat('a', 'A', 33.33), cat('b', 'B', 33.33), cat('c', 'C', 33.34)];
  const a = analyseOverAssignment(90, allocations);
  const spread = a.fixes.find((f) => f.kind === 'spread');
  eq(totalAfter(allocations, spread), 90, 'an indivisible proportional split still lands exactly');
}

// ── savings-first ──────────────────────────────────────────────────────────
{
  const allocations = [cat('m', 'Mortgage', 2000, 2000), goal('e', 'Emergency', 300, 300), goal('v', 'Vacation', 100, 100)];
  const a = analyseOverAssignment(2300, allocations);
  const savings = a.fixes.find((f) => f.kind === 'trim-savings');
  eq(a.overage, 100, 'overage is 100');
  eq(savings.reductions.map((r) => [r.name, r.to]), [['Emergency', 200]], 'savings are taken largest-first and only as much as needed');
  ok(savings.title.startsWith('Save less'), 'the fix says it fully covers the gap');
  eq(
    allocations.filter((x) => x.kind === 'category').every((c) => !savings.reductions.some((r) => r.id === c.id)),
    true,
    'no spending category is touched when savings alone can cover it'
  );
}

// ── savings that only partly cover it are offered honestly ─────────────────
{
  const allocations = [cat('m', 'Mortgage', 2000, 2000), goal('e', 'Emergency', 50, 50)];
  const a = analyseOverAssignment(1900, allocations);
  const savings = a.fixes.find((f) => f.kind === 'trim-savings');
  eq(a.overage, 150, 'overage is 150');
  ok(savings.title.includes('part of it'), 'a partial fix says so in its title');
  ok(savings.detail.includes('still need'), 'a partial fix says how much is left to find');
  eq(savings.reductions.map((r) => r.to), [0], 'a partial fix empties the goal rather than going negative');
}

// ── no allocation is ever pushed below zero ────────────────────────────────
{
  const allocations = [cat('a', 'A', 10), cat('b', 'B', 10)];
  const a = analyseOverAssignment(1, allocations);
  for (const fix of a.fixes) {
    ok(
      fix.reductions.every((r) => r.to >= 0),
      `fix "${fix.kind}" never proposes a negative assignment`
    );
  }
}

// ── projectAssignment: the edit that has not been saved yet ────────────────
// The guard warns BEFORE the write, so what matters is that it measures the
// month as it would be, not as it is.
{
  const rows = {
    income: 3000,
    categories: [
      { id: 'a', amount: 1000 },
      { id: 'b', amount: 500 },
    ],
    goals: [{ id: 'g', amount: 400 }],
  };

  const same = projectAssignment({ ...rows, change: { kind: 'category', id: 'a', value: 1000 } });
  eq([same.assignedTotal, same.isOver], [1900, false], 'an unchanged edit reports the current total and fits');

  const raised = projectAssignment({ ...rows, change: { kind: 'category', id: 'a', value: 2200 } });
  eq([raised.assignedTotal, raised.overage, raised.isOver], [3100, 100, true], 'raising one category over the income is caught');

  const added = projectAssignment({ ...rows, change: { kind: 'category', id: null, value: 1200 } });
  eq([added.assignedTotal, added.overage], [3100, 100], 'a brand-new category is added, not substituted');

  const addedGoal = projectAssignment({ ...rows, change: { kind: 'goal', id: null, value: 1200 } });
  eq([addedGoal.assignedTotal, addedGoal.overage], [3100, 100], 'a brand-new savings goal is added too');

  const cutIncome = projectAssignment({ ...rows, change: { kind: 'income', value: 1500 } });
  eq([cutIncome.income, cutIncome.overage], [1500, 400], 'lowering the income can put an unchanged plan over');

  const exact = projectAssignment({ ...rows, change: { kind: 'category', id: 'a', value: 2100 } });
  eq([exact.assignedTotal, exact.overage, exact.isOver], [3000, 0, false], 'assigning the income exactly is not over');

  // The float trap over-assign.ts already guards: 0.1 + 0.2 !== 0.3.
  const drift = projectAssignment({
    income: 0.3,
    categories: [{ id: 'a', amount: 0.1 }],
    goals: [{ id: 'g', amount: 0.2 }],
    change: { kind: 'category', id: 'a', value: 0.1 },
  });
  eq([drift.overage, drift.isOver], [0, false], 'float drift does not read as over by a fraction of a cent');

  // A goal edit must not be applied to a category that happens to share an id.
  const collide = projectAssignment({
    income: 1000,
    categories: [{ id: 'x', amount: 100 }],
    goals: [{ id: 'x', amount: 100 }],
    change: { kind: 'goal', id: 'x', value: 900 },
  });
  eq(collide.assignedTotal, 1000, 'an edit only touches its own kind, even when ids collide');
}

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
