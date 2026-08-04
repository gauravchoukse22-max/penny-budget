// Fixture harness for Net Worth. Same pattern as test-statement-parse.mjs:
// no test runner in this repo, so this is a standalone Node script that
// imports the REAL source (types stripped on the fly) and asserts exact
// values. Run with:
//
//   node scripts/test-net-worth.mjs
//
// Covers the two pure surfaces of the feature:
//   • computeNetWorth — the headline math and the "as of" stamp.
//   • backup-restore — that a v4 backup carries assets/liabilities, and that
//     restoring an OLDER file may not wipe them (the truncated-backup trap).
// The CRUD + journaling paths need a database and a device; they are covered
// by tsc and stay on TODO.md's unverified list until run on a simulator.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Stub everything the pure functions never touch: the db handle, uuid, the
// sync journal and the snapshot helpers (net-worth), and expo modules
// (backup-restore). lib/net-worth-history is reached only from
// captureNetWorthSnapshot, which needs a database; its own pure surface is
// covered by scripts/test-net-worth-history.mjs.
const netWorth = await import(
  await transform(join(root, 'features/net-worth.ts'), [
    '../lib/db',
    '../lib/uuid',
    '../lib/net-worth-history',
    './cloudkit-sync',
  ])
);
const { computeNetWorth, typeLabel, ASSET_TYPES, LIABILITY_TYPES } = netWorth;

const backup = await import(
  await transform(join(root, 'features/backup-restore.ts'), ['expo-document-picker', '../lib/db', '../lib/files'])
);
const { BACKUP_VERSION, BACKUP_TABLES, restorableTables, validateBackup, restoreCompletionMessage } = backup;

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

// ── computeNetWorth ──────────────────────────────────────────────────────────

const A = (balance, lastUpdated = '2026-08-01T00:00:00.000Z') => ({ balance, lastUpdated });

eq(computeNetWorth([], []), { assetTotal: 0, liabilityTotal: 0, netWorth: 0, asOf: null }, 'empty lists → all zero, no asOf');

eq(
  computeNetWorth([A(1000), A(250.5)], [A(300)]),
  { assetTotal: 1250.5, liabilityTotal: 300, netWorth: 950.5, asOf: '2026-08-01T00:00:00.000Z' },
  'basic assets minus liabilities'
);

eq(
  computeNetWorth([A(100)], [A(2500)]).netWorth,
  -2400,
  'net worth can be negative'
);

// Float dust: 0.1 + 0.2 style sums must land on exact cents.
eq(
  computeNetWorth([A(0.1), A(0.2)], []).assetTotal,
  0.3,
  'sums in cents, no float dust'
);
eq(
  computeNetWorth([A(124732.33), A(0.66)], [A(0.99)]).netWorth,
  124732,
  'large sum stays exact'
);

// A negative balance that slipped into storage counts by magnitude — it must
// not flip a liability into an asset.
eq(
  computeNetWorth([A(100)], [A(-50)]).netWorth,
  50,
  'negative stored liability counts as owed, not owned'
);

// asOf is the newest lastUpdated across BOTH lists.
eq(
  computeNetWorth(
    [A(1, '2026-01-15T10:00:00.000Z')],
    [A(2, '2026-07-04T09:00:00.000Z'), A(3, '2026-03-01T00:00:00.000Z')]
  ).asOf,
  '2026-07-04T09:00:00.000Z',
  'asOf is newest across both lists'
);

// ── type presets ─────────────────────────────────────────────────────────────

eq(ASSET_TYPES.map((t) => t.value), ['cash', 'investment', 'property', 'vehicle', 'other'], 'asset preset list');
eq(
  LIABILITY_TYPES.map((t) => t.value),
  ['credit_card', 'auto_loan', 'mortgage', 'student_loan', 'other'],
  'liability preset list'
);
eq(typeLabel('asset', 'cash'), 'Cash / Savings', 'asset type label');
eq(typeLabel('liability', 'credit_card'), 'Credit Card', 'liability type label');
eq(typeLabel('liability', 'from-a-newer-build'), 'Other', 'unknown synced type still gets a label');

// ── backup format ────────────────────────────────────────────────────────────

eq(BACKUP_VERSION, 5, 'backup format bumped to 5');
eq(BACKUP_TABLES.includes('assets'), true, 'backup carries assets');
eq(BACKUP_TABLES.includes('liabilities'), true, 'backup carries liabilities');

// The trap this guards: restoring a file written BEFORE these tables existed
// must leave the current rows alone, not clear them.
const v4 = restorableTables(4);
eq(v4.includes('assets') && v4.includes('liabilities'), true, 'v4 restore may touch net worth');
const v3 = restorableTables(3);
eq(v3.includes('assets') || v3.includes('liabilities'), false, 'v3 restore leaves net worth alone');
eq(v3.includes('funds'), true, 'v3 restore still covers the Funds grid');
const v2 = restorableTables(2);
eq(v2.includes('assets') || v2.includes('funds'), false, 'v2 restore leaves funds AND net worth alone');
eq(v2.includes('transactions'), true, 'v2 restore still covers core tables');

// Ordering is dependency order — filtering must preserve it.
eq(
  v3,
  // v3 predates net worth (v4) AND splits (v5), so a v3 file must leave all
  // three tables alone rather than wiping them.
  BACKUP_TABLES.filter(
    (t) => t !== 'assets' && t !== 'liabilities' && t !== 'transaction_splits' && t !== 'net_worth_snapshots'
  ),
  'v3 filter preserves table order'
);

// A current-version file round-trips validation; anything newer is refused.
eq(validateBackup({ version: 4, timestamp: 't', tables: {} }).valid, true, 'an older v4 file still validates');
eq(validateBackup({ version: 5, timestamp: 't', tables: {} }).valid, true, 'v5 file validates');
eq(validateBackup({ version: 6, timestamp: 't', tables: {} }).valid, false, 'newer file refused');
eq(validateBackup({ version: 'x', tables: {} }).valid, false, 'junk version refused');

// The completion message tells the user what an old file did NOT replace.
eq(restoreCompletionMessage(4), 'Data restored. Please close and reopen the app.', 'v4 message is plain');
eq(restoreCompletionMessage(3).includes('Net Worth'), true, 'v3 message names net worth as untouched');
eq(restoreCompletionMessage(2).includes('Funds'), true, 'v2 message names funds');
eq(restoreCompletionMessage(2).includes('Net Worth'), true, 'v2 message names net worth too');

// ── report ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
