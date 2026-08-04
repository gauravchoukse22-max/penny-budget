// Fixture harness for features/shared-settings.ts — the shared-budget settings
// record, and the currency rule built on it. Same shape as
// test-over-assign.mjs: no test runner, just Node importing the REAL source
// through the type-stripping loader. Run it with:
//
//   node scripts/test-shared-settings.mjs
//
// What matters here is not arithmetic but PRECEDENCE, and the three ways it can
// go wrong: a solo user being changed at all, a household member being left on
// their own currency while the other is on the shared one, and a joiner having
// their money silently restated in a symbol nobody told them about. The last one
// is a string, so the string is asserted too — it is the entire safety net.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Stub the database handle and the sync journal: every function under test here
// is pure. The storage half (upsert + queueSyncMutation) needs a device and is
// covered by tsc only — it stays on TODO.md's unverified list.
const { sharedSettingId, normalizeCurrency, resolveCurrency, buildCurrencyState, describeSharedCurrency } =
  await import(await transform(join(root, 'features/shared-settings.ts'), ['../lib/db', './cloudkit-sync']));

// The backup format gate: adding a table means an older file must not wipe it.
const backup = await import(
  await transform(join(root, 'features/backup-restore.ts'), ['expo-document-picker', '../lib/db', '../lib/files'])
);
const { BACKUP_VERSION, BACKUP_TABLES, restorableTables } = backup;

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

// ── the derived id ─────────────────────────────────────────────────────────
// AGENTS.md rule 2. If this is ever a uuid, two phones write two rows for the
// same setting and the one you see is whichever pushed last.
eq(sharedSettingId('hh-1', 'currency'), 'shs-hh-1-currency', 'the id is derived from household + key');
eq(
  sharedSettingId('hh-1', 'currency'),
  sharedSettingId('hh-1', 'currency'),
  'the id is stable across calls — this is the whole point'
);
ok(sharedSettingId('hh-1', 'currency') !== sharedSettingId('hh-2', 'currency'), 'two households never collide');

// ── normalizeCurrency ──────────────────────────────────────────────────────
eq(normalizeCurrency('gbp'), 'GBP', 'a lowercase code is accepted and upcased');
eq(normalizeCurrency('  usd  '), 'USD', 'surrounding whitespace is tolerated');
// Deliberately NOT restricted to the seven in the picker: a member on a later
// build that adds CHF must not be silently ignored back into divergence.
eq(normalizeCurrency('CHF'), 'CHF', 'a code this build does not offer is still honoured');
eq(normalizeCurrency(''), null, 'an empty string is not a currency');
eq(normalizeCurrency('US'), null, 'a two-letter code is refused');
eq(normalizeCurrency('DOLLAR'), null, 'a word is refused');
eq(normalizeCurrency(840), null, 'a number that arrived through an untyped payload is refused');
eq(normalizeCurrency(null), null, 'null is refused');
eq(normalizeCurrency(undefined), null, 'undefined is refused');

// ── the resolution rule ────────────────────────────────────────────────────

// Solo users must be COMPLETELY unaffected — no household means the local value,
// whatever happens to be sitting in the shared table from a household they left.
eq(resolveCurrency('USD', null, null), { currency: 'USD', source: 'local' }, 'no household → local value');
eq(
  resolveCurrency('USD', null, 'GBP'),
  { currency: 'USD', source: 'local' },
  'no household → a stale shared row from a household we left is ignored'
);

// With a household, the shared record wins. This is the bug: without it Gary
// sees $6,000 and Disha sees £6,000 for the same budget.
eq(resolveCurrency('USD', 'hh-1', 'GBP'), { currency: 'GBP', source: 'shared' }, 'household active → shared wins');
eq(
  resolveCurrency('GBP', 'hh-1', 'GBP'),
  { currency: 'GBP', source: 'shared' },
  'agreeing values still resolve as shared, not as a coincidence'
);

// A household that has never set one (every member on an older build) falls
// back to local rather than to a hardcoded USD, which would change what a real
// user's money is displayed in the moment they turn sharing on.
eq(
  resolveCurrency('INR', 'hh-1', null),
  { currency: 'INR', source: 'local' },
  'household with no shared value → local, not a hardcoded default'
);
eq(
  resolveCurrency('INR', 'hh-1', 'nonsense'),
  { currency: 'INR', source: 'local' },
  'a junk shared value falls back to local instead of blanking the symbol'
);
eq(resolveCurrency('', 'hh-1', null), { currency: 'USD', source: 'local' }, 'a blank local value still yields a currency');

// ── the state a screen renders ─────────────────────────────────────────────
{
  const joiner = buildCurrencyState('USD', 'hh-1', 'GBP');
  eq(joiner.currency, 'GBP', 'the joiner sees the household currency');
  eq(joiner.local, 'USD', "the joiner's own setting is NOT overwritten — it is what they get back on leaving");
  eq(joiner.differs, true, 'a difference is reported so the screen can say so');
  eq(joiner.source, 'shared', 'and the source says where the value came from');
}
{
  const agreed = buildCurrencyState('GBP', 'hh-1', 'GBP');
  eq(agreed.differs, false, 'no difference when both agree');
}
{
  const solo = buildCurrencyState('USD', null, 'GBP');
  eq(solo.differs, false, 'a solo user never has a difference to report');
  eq(solo.currency, 'USD', 'a solo user keeps their own currency');
}

// ── what the user is actually told ─────────────────────────────────────────
// The join rule is "the household's currency wins and the joiner is TOLD".
// If this sentence stops naming both currencies, the second half is gone.
{
  const joiner = buildCurrencyState('USD', 'hh-1', 'GBP');
  const msg = describeSharedCurrency(joiner);
  ok(msg.includes('GBP'), 'the notice names the currency now in force');
  ok(msg.includes('USD'), "the notice names this device's own setting too");
  ok(msg.includes('kept'), 'the notice says the local preference survives');
  ok(/not converted|Nothing was converted/i.test(msg), 'the notice says no money was converted');
}
{
  const unset = buildCurrencyState('USD', 'hh-1', null);
  ok(
    describeSharedCurrency(unset).includes('no currency set yet'),
    'a household with no shared currency says so rather than implying one'
  );
}
{
  const solo = buildCurrencyState('EUR', null, null);
  const msg = describeSharedCurrency(solo);
  ok(msg.includes('EUR'), 'the solo sentence still names the currency');
  ok(!/shared budget/i.test(msg), 'the solo sentence never mentions sharing');
}

// ── backup format ──────────────────────────────────────────────────────────
// Deliberately NOT pinned to an exact number here — shared_settings arrived at
// 6 and the format keeps growing. scripts/test-net-worth.mjs owns the exact
// assertion; this one only cares that the table is carried and correctly gated,
// so a later feature bumping the version does not fail a currency test.
ok(BACKUP_VERSION >= 6, 'the backup format is at least 6, where the shared settings arrived');
eq(BACKUP_TABLES.includes('shared_settings'), true, 'backup carries the shared settings');

// The trap: a v5 file predates the table. Wiping on it would leave the
// household with NO shared currency and drop both phones back to their own —
// the exact mismatch this table exists to end.
eq(restorableTables(6).includes('shared_settings'), true, 'a v6 restore may replace the shared settings');
eq(restorableTables(5).includes('shared_settings'), false, 'a v5 restore leaves the shared settings alone');
eq(restorableTables(5).includes('transaction_splits'), true, 'a v5 restore still covers splits');
eq(restorableTables(BACKUP_VERSION).includes('shared_settings'), true, 'a current-version restore covers it');

// Filtering must preserve dependency order, whatever else the filter drops.
const v5 = restorableTables(5);
eq(v5, BACKUP_TABLES.filter((t) => v5.includes(t)), 'the v5 filter preserves table order');

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
