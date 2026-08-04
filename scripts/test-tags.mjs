// Fixture harness for tags, refund claims and receipt paths. Same shape as
// test-transaction-splits.mjs: no test runner in this repo, just Node importing
// the REAL source through the type-stripping loader. Run it with:
//
//   node scripts/test-tags.mjs
//
// Three things here are worth testing and nothing else is:
//
//   • Derived ids. Two phones in a household must compute the SAME id for the
//     same logical thing (AGENTS.md rule 2). Every id below is checked for
//     stability, for insensitivity to the things that should not matter
//     (capitalisation, stray whitespace, a leading #), and for staying
//     DIFFERENT when the names genuinely differ — including names that share a
//     slug, which is the collision that would silently merge two totals.
//   • Money. Tag totals and the outstanding refund total are sums over
//     arbitrarily many rows; as floats they drift, and a trip total ending in
//     a fraction of a cent is a number the user cannot reconcile.
//   • Receipt paths, because the stored value has to survive a reinstall — an
//     absolute container path does not.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// lib/tags.ts imports nothing — nothing to stub.
const {
  normalizeTagName,
  tagNameKey,
  validateTagName,
  tagId,
  tagJoinId,
  tagColorFor,
  tagTotals,
  dedupeTagIds,
  TAG_PALETTE,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_TRANSACTION,
} = await import(await transform(join(root, 'lib/tags.ts'), []));

// The db handle, the sync journal and lib/queries are stubbed: the exports
// exercised here are pure, and the CRUD + journaling paths need a real device.
const { refundClaimId, outstandingTotal } = await import(
  await transform(join(root, 'features/refunds.ts'), ['../lib/db', '../lib/queries', './cloudkit-sync'])
);

// Same treatment for receipts, plus the expo modules it would otherwise pull in.
const { receiptExtension, receiptRelativePath, isAbsoluteReceiptUri } = await import(
  await transform(join(root, 'features/receipts.ts'), [
    'react-native',
    'expo-document-picker',
    'expo-file-system/legacy',
    '../lib/db',
    '../lib/queries',
  ])
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
/** Map -> sorted pairs, so key order never makes a passing test fail. */
const pairs = (map) => [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

// ── normalizeTagName / tagNameKey ──────────────────────────────────────────
eq(normalizeTagName('  vacation  '), 'vacation', 'surrounding whitespace is trimmed');
eq(normalizeTagName('work   trip'), 'work trip', 'internal whitespace collapses to one space');
eq(normalizeTagName('#vacation'), 'vacation', 'a leading hash is dropped — users type it out of habit');
eq(normalizeTagName('##vacation'), 'vacation', 'several hashes are dropped too');
eq(normalizeTagName('Portugal'), 'Portugal', 'the display form KEEPS the capitalisation the user chose');
eq(normalizeTagName('mid#word'), 'mid#word', 'a hash that is not leading is part of the name');
eq(normalizeTagName('\tvacation\n'), 'vacation', 'tabs and newlines count as whitespace');
eq(tagNameKey('Vacation'), 'vacation', 'the match key is lowercased');
eq(tagNameKey(' #Work  Trip '), 'work trip', 'the match key applies every normalisation first');

// ── validateTagName ────────────────────────────────────────────────────────
eq(validateTagName('vacation'), null, 'an ordinary name is valid');
eq(validateTagName('   '), 'empty', 'whitespace only is empty');
eq(validateTagName('#'), 'empty', 'a bare hash is empty once stripped');
eq(validateTagName(''), 'empty', 'the empty string is empty');
eq(MAX_TAG_NAME_LENGTH, 32, 'the name cap is 32');
eq(validateTagName('a'.repeat(32)), null, 'exactly the cap is allowed');
eq(validateTagName('a'.repeat(33)), 'too-long', 'one over the cap is rejected');
// Length is measured AFTER normalising, so padding is not what makes it fail.
eq(validateTagName(`  ${'a'.repeat(32)}  `), null, 'padding does not push a legal name over the cap');
eq(MAX_TAGS_PER_TRANSACTION, 5, 'a transaction carries at most five tags');

// ── tagId: the sync-critical one ───────────────────────────────────────────
ok(tagId('vacation') === tagId('vacation'), 'the same name derives the same id on any device');
ok(tagId('vacation') === tagId('Vacation'), 'capitalisation does not make a second tag');
ok(tagId('vacation') === tagId('  #vacation '), 'a stray hash or padding does not make a second tag');
ok(tagId('vacation') !== tagId('vacations'), 'different names derive different ids');
ok(/^tag-[a-z0-9-]*-[0-9a-f]{8}$/.test(tagId('vacation')), 'the id is ASCII-safe for a CloudKit record name');
eq(tagId('Work Trip').startsWith('tag-work-trip-'), true, 'the readable slug survives into the id');

// The collision the hash exists to stop: names with no Latin characters all
// slug to the empty string, and a slug-only id would merge them into one tag.
ok(tagId('休暇') !== tagId('🏖'), 'two names that slug to nothing are still different tags');
ok(/^tag--[0-9a-f]{8}$/.test(tagId('休暇')), 'a name with no Latin characters still yields a legal id');
ok(tagId('休暇') === tagId('休暇'), 'a non-Latin name is still stable across devices');
// Punctuation-only differences slug identically; only the hash separates them.
ok(tagId('a-b') !== tagId('a_b'), 'names sharing a slug are kept apart by the hash');
// Long names must not blow past a record-name limit.
ok(tagId('a'.repeat(32)).length < 64, 'even a max-length name gives a short id');

// ── tagJoinId ──────────────────────────────────────────────────────────────
eq(tagJoinId('tx-1', 'tag-vacation-0000abcd'), 'txtag-tx-1-tag-vacation-0000abcd', 'join ids name both sides');
ok(tagJoinId('tx-1', 'tag-a') === tagJoinId('tx-1', 'tag-a'), 'both phones tagging one purchase derive ONE join row');
ok(tagJoinId('tx-1', 'tag-a') !== tagJoinId('tx-2', 'tag-a'), 'the same tag on another transaction is another row');
ok(tagJoinId('tx-1', 'tag-a') !== tagJoinId('tx-1', 'tag-b'), 'another tag on the same transaction is another row');

// ── tagColorFor ────────────────────────────────────────────────────────────
ok(tagColorFor('vacation') === tagColorFor('Vacation'), 'both phones derive the SAME colour, so sync cannot flip it');
ok(TAG_PALETTE.includes(tagColorFor('vacation')), 'the derived colour is from the palette');
ok(TAG_PALETTE.includes(tagColorFor('🏖')), 'a non-Latin name still gets a real colour');

// ── dedupeTagIds ───────────────────────────────────────────────────────────
eq(dedupeTagIds(['a', 'b', 'a']), ['a', 'b'], 'duplicates are dropped, first position wins');
eq(dedupeTagIds([]), [], 'an empty list stays empty');
eq(dedupeTagIds(['a', 'b', 'c']), ['a', 'b', 'c'], 'an already-unique list is unchanged');

// ── tagTotals: the money ───────────────────────────────────────────────────
const tagged = (tagId, amount) => ({ tagId, amount });
eq(pairs(tagTotals([tagged('a', 10), tagged('a', 5)])), [['a', 15]], 'amounts on one tag add up');
eq(
  pairs(tagTotals([tagged('a', 10), tagged('b', 5)])),
  [['a', 10], ['b', 5]],
  'each tag totals separately'
);
eq(pairs(tagTotals([])), [], 'no rows is no totals, not a zero row');
// Float drift: 0.1 + 0.2 is 0.30000000000000004. A trip total is a long sum.
eq(pairs(tagTotals([tagged('a', 0.1), tagged('a', 0.2)])), [['a', 0.3]], 'float drift does not leak into a tag total');
{
  const rows = Array.from({ length: 100 }, () => tagged('a', 0.07));
  eq(pairs(tagTotals(rows)), [['a', 7]], 'a hundred awkward amounts still sum exactly');
}
// A refund on a tagged purchase must pull the total DOWN, not be ignored.
eq(pairs(tagTotals([tagged('a', 100), tagged('a', -30)])), [['a', 70]], 'a refund reduces the tag total');
eq(pairs(tagTotals([tagged('a', 20), tagged('a', -50)])), [['a', -30]], 'a tag whose refunds exceed its spend goes negative');
// The double-count that is DELIBERATE: one transaction under two tags counts in
// full under each, so tag totals never sum to a budget.
eq(
  pairs(tagTotals([tagged('a', 100), tagged('b', 100)])),
  [['a', 100], ['b', 100]],
  'one transaction under two tags counts fully under each'
);

// ── refundClaimId ──────────────────────────────────────────────────────────
eq(refundClaimId('tx-1'), 'refund-tx-1', 'a claim id is derived from its transaction');
ok(refundClaimId('tx-1') === refundClaimId('tx-1'), 'both phones marking one purchase derive ONE claim');
ok(refundClaimId('tx-1') !== refundClaimId('tx-2'), 'different transactions get different claims');

// ── outstandingTotal ───────────────────────────────────────────────────────
const claim = (expectedAmount, status = 'awaiting') => ({ expectedAmount, status });
eq(outstandingTotal([]), 0, 'nothing outstanding is zero');
eq(outstandingTotal([claim(60), claim(15)]), 75, 'awaiting claims add up');
eq(outstandingTotal([claim(60), claim(15, 'received')]), 60, 'a received claim stops counting');
eq(outstandingTotal([claim(60, 'received')]), 0, 'all received is zero outstanding');
// The reason the total is summed in cents rather than with SQL's SUM().
eq(outstandingTotal([claim(0.1), claim(0.2)]), 0.3, 'float drift does not leak into the outstanding total');
{
  const claims = Array.from({ length: 50 }, () => claim(1.01));
  eq(outstandingTotal(claims), 50.5, 'fifty awkward claims sum exactly');
}
// A partial refund is the normal case — the claim is NOT the transaction total.
eq(outstandingTotal([claim(60)]), 60, 'a partial claim reports only what is expected back');

// ── receipt paths ──────────────────────────────────────────────────────────
eq(receiptExtension('image/jpeg', 'x.jpg'), 'jpg', 'mime type decides the extension');
eq(receiptExtension('image/jpeg; charset=binary', null), 'jpg', 'a parameterised mime type still resolves');
eq(receiptExtension('IMAGE/PNG', null), 'png', 'mime matching is case-insensitive');
eq(receiptExtension('image/heic', null), 'heic', 'iPhone photos are heic');
eq(receiptExtension('image/heif', null), 'heic', 'heif is stored as heic');
eq(receiptExtension('application/pdf', null), 'pdf', 'an emailed PDF receipt is a receipt');
// Android content:// picks often report no mime and a name with no extension.
eq(receiptExtension(null, 'scan.PNG'), 'png', 'the filename is the fallback and is case-insensitive');
eq(receiptExtension(null, 'photo.jpeg'), 'jpg', 'jpeg normalises to jpg so one transaction cannot hold both');
eq(receiptExtension(null, null), 'bin', 'an unknown file is stored, not rejected');
eq(receiptExtension(null, 'receipt'), 'bin', 'a name with no extension falls back too');
eq(receiptExtension('application/x-evil', 'run.sh'), 'bin', 'an extension outside the whitelist is not passed through');

eq(receiptRelativePath('tx-1', 'jpg'), 'receipts/tx-1.jpg', 'the path is named after the transaction, not the file');
ok(
  receiptRelativePath('tx-1', 'jpg') === receiptRelativePath('tx-1', 'jpg'),
  're-attaching overwrites rather than leaving an unreferenced file behind'
);
// The reinstall trap: an absolute container path is dead after a restore, so
// stored values must be relative — and a value that IS absolute (synced from
// another build) has to be recognised rather than resolved as relative.
ok(!receiptRelativePath('tx-1', 'jpg').startsWith('/'), 'stored paths are relative, so they survive a reinstall');
eq(isAbsoluteReceiptUri('receipts/tx-1.jpg'), false, 'our own stored value is relative');
eq(isAbsoluteReceiptUri('file:///var/mobile/Containers/x.jpg'), true, 'a file:// uri is absolute');
eq(isAbsoluteReceiptUri('/var/mobile/x.jpg'), true, 'a bare posix path is absolute');
eq(isAbsoluteReceiptUri('content://media/1'), true, 'an Android content uri is absolute');

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
