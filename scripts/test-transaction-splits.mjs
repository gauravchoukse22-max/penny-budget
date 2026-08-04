// Fixture harness for lib/transaction-splits.ts. Same shape as
// test-over-assign.mjs: no test runner, just Node importing the REAL source
// through the type-stripping loader. Run it with:
//
//   node scripts/test-transaction-splits.mjs
//
// The whole point of splits is that category totals stop being wrong, so the
// arithmetic is the feature. A split set that is a cent off moves a cent out
// of the books — every case below is a way that has been made to happen.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const { validateSplits, remainderFor, equalParts, categoryAmounts, splitId, MIN_SPLIT_PARTS } = await import(
  await transform(join(root, 'lib/transaction-splits.ts'), [])
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
function ok(cond, label) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}`);
  }
}
const part = (categoryId, amount) => ({ categoryId, amount });
const kinds = (errs) => errs.map((e) => e.kind).sort();
/** Map -> sorted pairs, so key order never makes a passing test fail. */
const pairs = (map) => [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

// ── validateSplits ─────────────────────────────────────────────────────────
eq(validateSplits(145, [part('a', 80), part('b', 65)]), [], 'a split that adds up is legal');
eq(kinds(validateSplits(145, [part('a', 145)])), ['too-few'], 'one part is not a split, even when it sums correctly');
eq(MIN_SPLIT_PARTS, 2, 'a split needs at least two parts');

{
  const errs = validateSplits(145, [part('a', 80), part('b', 60)]);
  eq(kinds(errs), ['sum-mismatch'], 'parts that do not sum are rejected');
  eq(errs[0].difference, 5, 'the difference says how much is missing, so the UI can say it');
}
{
  const errs = validateSplits(145, [part('a', 80), part('b', 70)]);
  eq(errs[0].difference, -5, 'over-allocating reports a negative difference');
}

// Float drift: 0.1 + 0.2 is 0.30000000000000004. Comparing sums as floats
// rejects this correct split with an error the user cannot act on.
eq(validateSplits(0.3, [part('a', 0.1), part('b', 0.2)]), [], 'float drift does not reject a correct split');
eq(validateSplits(100, [part('a', 33.33), part('b', 33.33), part('c', 33.34)]), [], 'an indivisible three-way split is legal');

// Sign: refunds are negative transactions and must stay splittable.
eq(validateSplits(-50, [part('a', -30), part('b', -20)]), [], 'a refund splits into negative parts');
eq(kinds(validateSplits(145, [part('a', 200), part('b', -55)])), ['wrong-sign'], 'a part opposing the total is rejected even though the sum is right');
eq(validateSplits(145, [part('a', 145), part('b', 0)]), [], 'a zero placeholder row is not yet an error');

// Duplicates
eq(kinds(validateSplits(100, [part('a', 60), part('a', 40)])), ['duplicate-category'], 'the same category twice is rejected');
eq(validateSplits(100, [part(null, 60), part(null, 40)]), [], 'two unassigned rows are not duplicates of each other');

// Several problems at once are all reported, not just the first.
eq(kinds(validateSplits(100, [part('a', 60), part('a', 30)])), ['duplicate-category', 'sum-mismatch'], 'every problem is reported together');

// ── remainderFor ───────────────────────────────────────────────────────────
eq(remainderFor(145, [part('a', 80), part('b', 0)], 1), 65, 'the remainder fills the last row');
eq(remainderFor(145, [part('a', 80), part('b', 65)], 0), 80, 'asking for a row already correct returns what it is');
eq(remainderFor(100, [part('a', 33.33), part('b', 33.33), part('c', 0)], 2), 33.34, 'the remainder absorbs the indivisible cent');
eq(remainderFor(100, [part('a', 120), part('b', 0)], 1), -20, 'an over-allocated split reports a negative remainder rather than clamping');

// ── equalParts ─────────────────────────────────────────────────────────────
eq(equalParts(100, 2), [50, 50], 'an even split is even');
eq(equalParts(10, 3), [3.34, 3.33, 3.33], 'an indivisible split gives the spare cent to the first part');
ok(equalParts(10, 3).reduce((s, v) => s + Math.round(v * 100), 0) === 1000, 'equal parts sum EXACTLY to the total');
eq(equalParts(-10, 3), [-3.34, -3.33, -3.33], 'a negative total splits negative, spare cent included');
ok(equalParts(-10, 3).reduce((s, v) => s + Math.round(v * 100), 0) === -1000, 'negative equal parts sum exactly too');
eq(equalParts(100, 0), [], 'zero parts is empty, not a divide by zero');
eq(validateSplits(10, equalParts(10, 3).map((a) => part(null, a))), [], 'equalParts output always validates');

// ── categoryAmounts ────────────────────────────────────────────────────────
eq(pairs(categoryAmounts({ amount: 50, categoryId: 'a', splits: null })), [['a', 50]], 'no splits falls back to the single category');
eq(pairs(categoryAmounts({ amount: 50, categoryId: 'a', splits: [] })), [['a', 50]], 'an empty split list is not a split');
eq(
  pairs(categoryAmounts({ amount: 145, categoryId: 'a', splits: [part('a', 80), part('b', 65)] })),
  [['a', 80], ['b', 65]],
  'splits are attributed per category'
);
// The double-count trap: a split transaction still has its own categoryId, and
// counting both would add the money twice.
eq(
  pairs(categoryAmounts({ amount: 145, categoryId: 'z', splits: [part('a', 80), part('b', 65)] })),
  [['a', 80], ['b', 65]],
  'splits REPLACE the transaction categoryId rather than adding to it'
);
eq(
  pairs(categoryAmounts({ amount: 145, categoryId: 'z', splits: [part('a', 80), part(null, 65)] })),
  [['a', 80], [null, 65]],
  'an unassigned part stays visible under null instead of vanishing from the books'
);
eq(pairs(categoryAmounts({ amount: 50, categoryId: null, splits: null })), [[null, 50]], 'an uncategorised transaction reports under null');
// Same category twice (legal once saved, e.g. after a category merge) must add.
eq(
  pairs(categoryAmounts({ amount: 100, categoryId: null, splits: [part('a', 60), part('a', 40)] })),
  [['a', 100]], 'repeated categories in stored splits are summed, not overwritten'
);
{
  const total = categoryAmounts({ amount: 100, categoryId: null, splits: [part('a', 33.33), part('b', 33.33), part('c', 33.34)] });
  ok([...total.values()].reduce((s, v) => s + Math.round(v * 100), 0) === 10000, 'attributed amounts sum back to the transaction total');
}

// ── splitId ────────────────────────────────────────────────────────────────
eq(splitId('tx-1', 0), 'split-tx-1-0', 'split ids are derived from the transaction and index');
ok(splitId('tx-1', 0) === splitId('tx-1', 0), 'the same split derives the same id on any device');
ok(splitId('tx-1', 0) !== splitId('tx-1', 1), 'different parts derive different ids');

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
