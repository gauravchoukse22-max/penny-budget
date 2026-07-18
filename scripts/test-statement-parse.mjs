// Fixture harness for the statement parser. This repo has no test runner, so
// this is a standalone Node script that imports the REAL parsing functions and
// asserts exact expected transactions against realistic statement exports.
// It's the evidence behind any "spot on accurate" claim — run it with:
//
//   node scripts/test-statement-parse.mjs
//
// The parser is pure TypeScript with no expo/native imports, so we strip the
// type annotations on the fly (see loadModule) rather than dragging in a
// TS build step. If that ever gets fragile, replace with tsx/esbuild.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const { parseCsv } = await import(await transform(join(root, 'lib/csv.ts'), ['expo-document-picker', './queries', './particulars', './files', './models']));
const parse = await import(await transform(join(root, 'lib/statement-parse.ts'), []));
const { parseStatementRecords, parseStatementAmount, parseStatementDate, detectDateOrder, detectSignConvention } = parse;

// Deterministic "now" so year inference doesn't drift with the calendar.
const TODAY = new Date(2026, 6, 18); // 2026-07-18

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

function run(name, csv, expectedRows, opts = {}) {
  const records = parseCsv(csv);
  const result = parseStatementRecords(records, { today: TODAY, ...opts });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push(`✗ ${name}: unrecognizedFormat (inspected: ${result.inspectedLines.join(' | ')})`);
    return;
  }
  eq(result.rows, expectedRows, name);
  return result;
}

// ── Unit: amount parsing ─────────────────────────────────────────────
eq(parseStatementAmount('$1,234.56'), 1234.56, 'amount: $1,234.56');
eq(parseStatementAmount('-$489.44'), -489.44, 'amount: -$489.44 (Synchrony payment)');
eq(parseStatementAmount('(12.34)'), -12.34, 'amount: (12.34) parens negative');
eq(parseStatementAmount('-212.30'), -212.3, 'amount: -212.30');
eq(parseStatementAmount('+5'), 5, 'amount: +5');
eq(parseStatementAmount('  '), null, 'amount: blank -> null');
eq(parseStatementAmount('N/A'), null, 'amount: N/A -> null');
eq(parseStatementAmount('1.234.56'), null, 'amount: malformed -> null');

// ── Unit: date parsing ───────────────────────────────────────────────
eq(parseStatementDate('06/28', 'month-first', 2026, TODAY), '2026-06-28', 'date: 06/28 with year');
eq(parseStatementDate('06/28', 'month-first', null, TODAY), '2026-06-28', 'date: 06/28 inferred (past this year)');
eq(parseStatementDate('12/15', 'month-first', null, TODAY), '2025-12-15', 'date: 12/15 inferred (rolls to last year)');
eq(parseStatementDate('2026-06-28', 'month-first', null, TODAY), '2026-06-28', 'date: ISO');
eq(parseStatementDate('Jun 28, 2026', 'month-first', null, TODAY), '2026-06-28', 'date: month name');
eq(parseStatementDate('28/06/2026', 'day-first', null, TODAY), '2026-06-28', 'date: day-first');
eq(parseStatementDate('02/31', 'month-first', 2026, TODAY), null, 'date: impossible 02/31 -> null');
eq(detectDateOrder(['06/28', '13/01']), 'day-first', 'order: 13 forces day-first');
eq(detectDateOrder(['06/28', '07/03']), 'month-first', 'order: ambiguous -> month-first');
eq(detectSignConvention([-5, -48.2, -132.99, 250]), true, 'sign: mostly negative -> flip');
eq(detectSignConvention([5, 48.2, -250]), false, 'sign: mostly positive -> keep');

// ── Fixture 1: Synchrony-style (payments negative, purchases positive, year-less) ─
// This is the format from the user's screenshot: Date | Reference # |
// Description | Amount, with "Payments" and "Other Credits" section subtotals.
const synchrony = `Transaction Detail
Date,Reference #,Description,Amount
Payments,,,-$489.44
06/28,8521333J400XS6H17,ONLINE PAYMENT THANK YOU,-$489.44
Other Credits,,,-$251.03
06/15,3521999HR21BN16NM,SAMS CLUB 6647 HUNTSVILLE AL,-$251.03
Purchases,,,$302.16
06/03,55432110098812340,STARBUCKS STORE 4412,5.75
06/07,55432110098812341,SHELL OIL 574123,48.20
06/12,55432110098812342,"KROGER 221, HUNTSVILLE AL",86.43
06/20,55432110098812343,NETFLIX.COM,15.49`;

run('Synchrony: 4 charges + 2 credits, subtotals excluded', synchrony, [
  { date: '2026-06-28', note: 'ONLINE PAYMENT THANK YOU', amount: -489.44 },
  { date: '2026-06-15', note: 'SAMS CLUB 6647 HUNTSVILLE AL', amount: -251.03 },
  { date: '2026-06-03', note: 'STARBUCKS STORE 4412', amount: 5.75 },
  { date: '2026-06-07', note: 'SHELL OIL 574123', amount: 48.2 },
  { date: '2026-06-12', note: 'KROGER 221, HUNTSVILLE AL', amount: 86.43 },
  { date: '2026-06-20', note: 'NETFLIX.COM', amount: 15.49 },
]);

// ── Fixture 2: Chase's real CSV download (purchases NEGATIVE, payments POSITIVE) ─
// chase.com "Download activity" exports this shape: a Transaction Date + Post
// Date, a Type column, and an Amount where purchases are negative and
// payments/credits are positive — the OPPOSITE of what the app wants. Purchases
// dominate, so the parser flips the whole file: purchases become positive
// (spend) and the payment/refund become negative (credit). That's the correct
// result, and it's why sign detection looks at the whole file, not one row.
const chase = `Transaction Date,Post Date,Description,Category,Type,Amount
06/03/2026,06/04/2026,AMAZON.COM AMZN.COM/BILL WA,Shopping,Sale,-14.17
06/07/2026,06/08/2026,SHELL OIL 574123,Gas,Sale,-48.20
06/08/2026,06/08/2026,Payment Thank You-Mobile,,Payment,212.30
06/11/2026,06/12/2026,CHIPOTLE 1842,Food & Drink,Sale,-14.28
06/14/2026,06/15/2026,DELTA AIR LINES,Travel,Sale,-412.60
06/20/2026,06/21/2026,AMAZON REFUND,Shopping,Return,20.00`;

run('Chase real CSV: purchases positive after flip, payment/refund negative', chase, [
  { date: '2026-06-03', note: 'AMAZON.COM AMZN.COM/BILL WA', amount: 14.17 },
  { date: '2026-06-07', note: 'SHELL OIL 574123', amount: 48.2 },
  { date: '2026-06-08', note: 'Payment Thank You-Mobile', amount: -212.3 },
  { date: '2026-06-11', note: 'CHIPOTLE 1842', amount: 14.28 },
  { date: '2026-06-14', note: 'DELTA AIR LINES', amount: 412.6 },
  { date: '2026-06-20', note: 'AMAZON REFUND', amount: -20 },
]);

// ── Fixture 3: Bank export with preamble + separate Debit/Credit columns ─
const bankDebitCredit = `"Account: Checking ****1234"
"Statement Period: 06/01/2026 - 06/30/2026"
Date,Description,Debit,Credit
06/02/2026,PAYROLL DEPOSIT,,2500.00
06/05/2026,WHOLE FOODS,72.19,
06/09/2026,ELECTRIC CO,143.55,
06/15/2026,REFUND ADjust,,20.00`;

run('Bank: preamble skipped, debit=spend / credit=negative', bankDebitCredit, [
  { date: '2026-06-02', note: 'PAYROLL DEPOSIT', amount: -2500 },
  { date: '2026-06-05', note: 'WHOLE FOODS', amount: 72.19 },
  { date: '2026-06-09', note: 'ELECTRIC CO', amount: 143.55 },
  { date: '2026-06-15', note: 'REFUND ADjust', amount: -20 },
]);

// ── Fixture 4: mixed-sign purchases-positive export, no flip ─
const amex = `Date,Description,Amount
07/01/2026,UBER TRIP,23.40
07/02/2026,PANERA BREAD,11.82
07/05/2026,STATEMENT CREDIT,-50.00`;

run('Amex: purchases positive, one credit, no flip', amex, [
  { date: '2026-07-01', note: 'UBER TRIP', amount: 23.4 },
  { date: '2026-07-02', note: 'PANERA BREAD', amount: 11.82 },
  { date: '2026-07-05', note: 'STATEMENT CREDIT', amount: -50 },
]);

// ── Fixture 5: quoted note with embedded newline must not split the row ─
const embeddedNewline = `Date,Description,Amount
07/01/2026,"COFFEE SHOP
DOWNTOWN",6.25
07/02/2026,LUNCH,14.00`;

run('Embedded newline in quoted note stays one row', embeddedNewline, [
  { date: '2026-07-01', note: 'COFFEE SHOP\nDOWNTOWN', amount: 6.25 },
  { date: '2026-07-02', note: 'LUNCH', amount: 14 },
]);

// ── Report ───────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
  console.log(failures.join('\n\n'));
  console.log('');
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
