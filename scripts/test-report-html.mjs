// Fixture harness for features/report-export.ts — the monthly report's pure
// HTML generator. Same shape as test-recurring-detect.mjs: no test runner,
// just Node importing the REAL source through the type-stripping loader and
// asserting on the produced markup. Run it with:
//
//   node scripts/test-report-html.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// lib/format has no imports and IS exercised (currency/month labels), so it is
// transpiled for real and rewritten into report-export's import graph. The
// native-facing imports (react-native, expo-sharing, db queries, notify,
// files) belong to exportMonthlyReportPdf, which this harness never calls —
// stubbing them out is safe and keeps Node from resolving Expo modules.
const formatUrl = await transform(join(root, 'lib/format.ts'), []);
const { generateMonthlyReportHtml } = await import(
  await transform(
    join(root, 'features/report-export.ts'),
    ['react-native', 'expo-sharing', '../lib/files', '../lib/confirm', '../lib/queries'],
    { '../lib/format': formatUrl }
  )
);
const { formatCurrency } = await import(formatUrl);

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, label, detail = '') {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`✗ ${label}${detail ? `\n    ${detail}` : ''}`);
  }
}

const usd = (n) => formatCurrency(n, 'USD');

// ── Fixtures ────────────────────────────────────────────────────────────────

const cards = [
  { id: 'card-1', name: 'Sapphire', lastFour: '4421', color: '#0A84FF', sortOrder: 0, billDay: null, dueDay: null },
  { id: 'card-2', name: 'Cash', lastFour: '', color: '#34C759', sortOrder: 1000000, billDay: null, dueDay: null },
];

const cat = (id, name, monthlyLimit) => ({ id, name, icon: 'cart', color: '#FF9F0A', monthlyLimit, sortOrder: 0 });

/** Mirror of computeCategorySummariesFrom's row shape, fabricated directly. */
const summaryRow = (category, spend) => {
  const remaining = category.monthlyLimit - spend;
  const percent = category.monthlyLimit > 0 ? (spend / category.monthlyLimit) * 100 : 0;
  return { category, spend, remaining, status: percent > 100 ? 'red' : 'green', percent };
};

let seq = 0;
const tx = (amount, note, categoryId = 'cat-groceries', cardId = 'card-1', date = '2026-07-10') => ({
  id: `t${++seq}`,
  amount,
  date,
  categoryId,
  cardId,
  note,
  source: 'manual',
  createdAt: `${date}T00:00:00.000Z`,
});

const groceries = cat('cat-groceries', 'Groceries', 600);
const dining = cat('cat-dining', 'Dining Out', 200); // will run over
const noLimit = cat('cat-misc', 'Misc & <Odds>', 0); // no budget set

// ── A full, ordinary month ──────────────────────────────────────────────────
{
  const transactions = [
    tx(450.25, 'Kroger run'),
    tx(260.5, 'Anniversary dinner', 'cat-dining'),
    tx(42, 'Batteries & bulbs', 'cat-misc', 'card-2'),
    tx(-20, 'Refund: returned lamp', 'cat-misc'),
    tx(12.75, null, null), // uncategorized, no note
  ];
  const html = generateMonthlyReportHtml('2026-07', {
    currency: 'USD',
    summary: { salary: 5000, spend: 745.5, savings: 300, surplus: 3954.5 },
    categories: [summaryRow(dining, 260.5), summaryRow(groceries, 450.25), summaryRow(noLimit, 22)],
    cards,
    cardTotals: new Map([
      ['card-1', 723.5],
      ['card-2', 42],
    ]),
    transactions,
    generatedAt: new Date(2026, 7, 3),
  });

  check(html.includes('July 2026'), 'title: month label rendered');
  check(html.includes(usd(5000)), 'summary: income');
  check(html.includes(usd(745.5)), 'summary: spent');
  check(html.includes(usd(300)), 'summary: saved');
  check(html.includes(usd(3954.5)), 'summary: left over');

  check(html.includes('Groceries'), 'categories: row present');
  check(html.includes(usd(600)), 'categories: budget column');
  check(html.includes(`${usd(149.75)} left`), 'categories: under-budget remaining');
  check(html.includes(`class="num over">${usd(60.5)} over`), 'categories: over-budget row carries the over class');
  check(!html.includes(`class="num over">${usd(149.75)}`), 'categories: under-budget row does NOT carry the over class');
  check(html.includes('Misc &amp; &lt;Odds&gt;'), 'categories: user text is HTML-escaped');

  check(html.includes('Sapphire'), 'cards: named row present');
  check(html.includes(usd(723.5)), 'cards: total rendered');
  check(html.includes(usd(42)), 'cards: second card total rendered');

  const txSection = html.slice(html.indexOf('Largest transactions'));
  check(txSection.includes('Kroger run'), 'transactions: note rendered');
  check(
    txSection.indexOf('Kroger run') < txSection.indexOf('Anniversary dinner'),
    'transactions: sorted largest first (450.25 before 260.50)'
  );
  check(!txSection.includes('Refund: returned lamp'), 'transactions: refunds excluded from largest spends');
  check(txSection.includes('(no note)'), 'transactions: null note gets a placeholder');
  check(txSection.includes('Uncategorized'), 'transactions: null category labeled');

  check(html.includes('Generated by Penny Budget'), 'footer present');
  check(!html.includes('undefined'), 'no "undefined" leaks into the page');
  check(!html.includes('NaN'), 'no "NaN" leaks into the page');
}

// ── Edge: zero salary ───────────────────────────────────────────────────────
{
  const html = generateMonthlyReportHtml('2026-07', {
    currency: 'USD',
    summary: { salary: 0, spend: 100, savings: 0, surplus: -100 },
    categories: [summaryRow(groceries, 100)],
    cards,
    cardTotals: new Map([['card-1', 100]]),
    transactions: [tx(100, 'Groceries')],
    generatedAt: new Date(2026, 7, 3),
  });
  check(html.includes(usd(0)), 'zero salary: $0.00 income rendered');
  check(html.includes(`negative">${usd(-100)}`), 'zero salary: negative surplus gets the negative class');
  check(!html.includes('undefined') && !html.includes('NaN'), 'zero salary: no undefined/NaN');
}

// ── Edge: completely empty month ────────────────────────────────────────────
{
  const html = generateMonthlyReportHtml('2026-02', {
    currency: 'USD',
    summary: { salary: 0, spend: 0, savings: 0, surplus: 0 },
    categories: [],
    cards: [],
    cardTotals: new Map(),
    transactions: [],
    generatedAt: new Date(2026, 7, 3),
  });
  check(html.includes('February 2026'), 'empty month: title still renders');
  check(html.includes('No category activity this month.'), 'empty month: category empty state');
  check(html.includes('No card activity this month.'), 'empty month: card empty state');
  check(html.includes('No transactions this month.'), 'empty month: transaction empty state');
  check(!html.includes('undefined') && !html.includes('NaN'), 'empty month: no undefined/NaN');
}

// ── Edge: category with no limit ────────────────────────────────────────────
{
  const html = generateMonthlyReportHtml('2026-07', {
    currency: 'USD',
    summary: { salary: 1000, spend: 50, savings: 0, surplus: 950 },
    categories: [summaryRow(noLimit, 50)],
    cards,
    cardTotals: new Map([['card-1', 50]]),
    transactions: [tx(50, 'Odds and ends', 'cat-misc')],
    generatedAt: new Date(2026, 7, 3),
  });
  check(html.includes('&mdash;'), 'no-limit category: budget/remaining show a dash');
  check(!html.includes('class="num over"'), 'no-limit category: never marked over-budget');
  check(html.includes(usd(50)), 'no-limit category: spend still rendered');
  check(!html.includes('undefined') && !html.includes('NaN'), 'no-limit category: no undefined/NaN');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
