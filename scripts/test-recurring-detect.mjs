// Fixture harness for lib/recurring-detect.ts — the Insights "Recurring Watch"
// detector. Same shape as test-statement-parse.mjs: no test runner, just Node
// importing the REAL source through the type-stripping loader and asserting
// exact outputs. Run it with:
//
//   node scripts/test-recurring-detect.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// recurring-detect's only import is `import type { Transaction }`, which the
// transpile erases — nothing to stub.
const { detectRecurringCharges, normalizeRecurringNote } = await import(
  await transform(join(root, 'lib/recurring-detect.ts'), [])
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

/** Minimal Transaction literal — only the fields the detector reads matter,
 * but the full shape is kept so the fixture stays honest to lib/models.ts. */
let seq = 0;
function tx(date, amount, note) {
  seq++;
  return {
    id: `t${seq}`,
    amount,
    date,
    categoryId: null,
    cardId: 'card-1',
    note,
    source: 'imported',
    createdAt: `${date}T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  };
}

// ── Normalization ────────────────────────────────────────────────────────────
eq(normalizeRecurringNote('SPOTIFY *38291'), 'spotify', 'normalize: strips ref ids and punctuation');
eq(normalizeRecurringNote('Netflix.com 866123'), 'netflix com', 'normalize: long digit runs dropped, words kept');
eq(normalizeRecurringNote('  Gym   Membership '), 'gym membership', 'normalize: whitespace collapsed');
eq(normalizeRecurringNote('Channel 4'), 'channel 4', 'normalize: short numbers survive (not a ref id)');

// ── Detection: the happy path ───────────────────────────────────────────────
{
  const [c] = detectRecurringCharges([
    tx('2026-04-12', 15.49, 'NETFLIX.COM 111222'),
    tx('2026-05-12', 15.49, 'NETFLIX.COM 333444'),
    tx('2026-06-13', 15.49, 'NETFLIX.COM 555666'),
    tx('2026-07-12', 15.49, 'NETFLIX.COM 777888'),
  ]);
  eq(c?.normalizedNote, 'netflix com', 'detect: 4 steady months found, ref ids grouped');
  eq(c?.typicalAmount, 15.49, 'detect: typical amount is the median');
  eq(c?.monthsSeen, 4, 'detect: months counted');
  eq([c?.firstMonth, c?.lastMonth], ['2026-04', '2026-07'], 'detect: first/last month');
  eq(c?.priceWentUp, false, 'detect: flat price not flagged');
  eq(c?.name, 'NETFLIX.COM 777888', 'detect: display name is the latest original note');
}

// ── Price rise: latest > 5% over median, still inside the 10% band ──────────
{
  const [c] = detectRecurringCharges([
    tx('2026-05-01', 15.99, 'Hulu'),
    tx('2026-06-01', 15.99, 'Hulu'),
    tx('2026-07-01', 16.99, 'Hulu'),
  ]);
  eq(c?.priceWentUp, true, 'price: +6.3% latest flags "price went up"');
  eq(c?.latestAmount, 16.99, 'price: latest amount reported');
  eq(c?.typicalAmount, 15.99, 'price: typical stays the median, not the new price');
}

// A rise inside the 5% tolerance is not a flag.
{
  const [c] = detectRecurringCharges([
    tx('2026-05-03', 10.0, 'iCloud'),
    tx('2026-06-03', 10.0, 'iCloud'),
    tx('2026-07-03', 10.4, 'iCloud'),
  ]);
  eq(c?.priceWentUp, false, 'price: +4% stays unflagged');
}

// ── Rejections ──────────────────────────────────────────────────────────────
eq(
  detectRecurringCharges([tx('2026-06-01', 9.99, 'Disney+'), tx('2026-07-01', 9.99, 'Disney+')]).length,
  0,
  'reject: only 2 distinct months'
);

// Three charges but two land in the same month — months are DISTINCT months.
eq(
  detectRecurringCharges([
    tx('2026-06-01', 9.99, 'Paramount'),
    tx('2026-06-28', 9.99, 'Paramount'),
    tx('2026-07-01', 9.99, 'Paramount'),
  ]).length,
  0,
  'reject: 3 charges across only 2 distinct months'
);

// A merchant you merely visit monthly: amounts spread far beyond 10%.
eq(
  detectRecurringCharges([
    tx('2026-05-08', 45.12, 'Kroger'),
    tx('2026-06-11', 92.4, 'Kroger'),
    tx('2026-07-09', 61.77, 'Kroger'),
  ]).length,
  0,
  'reject: variable amounts (grocery store) are not a subscription'
);

// Refunds/credits never form a recurring CHARGE.
eq(
  detectRecurringCharges([
    tx('2026-05-01', -12.0, 'Rebate'),
    tx('2026-06-01', -12.0, 'Rebate'),
    tx('2026-07-01', -12.0, 'Rebate'),
  ]).length,
  0,
  'reject: negative amounts ignored'
);

// Blank notes have no identity to group on.
eq(
  detectRecurringCharges([tx('2026-05-01', 5, ''), tx('2026-06-01', 5, ''), tx('2026-07-01', 5, '')]).length,
  0,
  'reject: empty notes'
);

// ── Exclusion of already-tracked rules ──────────────────────────────────────
{
  const history = [
    tx('2026-05-12', 15.49, 'Netflix'),
    tx('2026-06-12', 15.49, 'Netflix'),
    tx('2026-07-12', 15.49, 'Netflix'),
    tx('2026-05-03', 11.99, 'SPOTIFY *111'),
    tx('2026-06-03', 11.99, 'SPOTIFY *222'),
    tx('2026-07-03', 11.99, 'SPOTIFY *333'),
  ];
  const out = detectRecurringCharges(history, { excludeNotes: ['netflix'] });
  eq(out.length, 1, 'exclude: tracked rule removed');
  eq(out[0]?.normalizedNote, 'spotify', 'exclude: untracked one survives');
  // Exclusion matches on the NORMALIZED note, so a rule saved with different
  // casing/ref noise still covers its statement lines.
  eq(
    detectRecurringCharges(history, { excludeNotes: ['NETFLIX 998', 'Spotify'] }).length,
    0,
    'exclude: rule notes normalized before matching'
  );
}

// ── Ordering: biggest typical amount first ──────────────────────────────────
{
  const out = detectRecurringCharges([
    tx('2026-05-01', 3.99, 'iCloud'),
    tx('2026-06-01', 3.99, 'iCloud'),
    tx('2026-07-01', 3.99, 'iCloud'),
    tx('2026-05-05', 59.0, 'Gym Membership'),
    tx('2026-06-05', 59.0, 'Gym Membership'),
    tx('2026-07-05', 59.0, 'Gym Membership'),
  ]);
  eq(
    out.map((c) => c.normalizedNote),
    ['gym membership', 'icloud'],
    'order: sorted by typical amount, descending'
  );
}

// ── Even-count median (4 samples) ───────────────────────────────────────────
{
  const [c] = detectRecurringCharges([
    tx('2026-04-01', 10.0, 'Max'),
    tx('2026-05-01', 10.0, 'Max'),
    tx('2026-06-01', 10.5, 'Max'),
    tx('2026-07-01', 10.5, 'Max'),
  ]);
  eq(c?.typicalAmount, 10.25, 'median: even count averages the middle two');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
