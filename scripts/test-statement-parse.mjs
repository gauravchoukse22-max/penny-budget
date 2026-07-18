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

const { parseCsv } = await import(await transform(join(root, 'lib/csv.ts'), ['expo-document-picker', './queries', './particulars', './files', './models', './parse-number']));
const parse = await import(await transform(join(root, 'lib/statement-parse.ts'), []));
const { parseStatementRecords, parseStatementAmount, parseStatementDate, detectDateOrder, detectSignConvention, findStatementYear } = parse;
const layout = await import(await transform(join(root, 'lib/pdf-layout.ts'), []));
const { clusterRowsFromRuns, pageToRecords, documentToRecords } = layout;
const { parseMoneyInput } = await import(await transform(join(root, 'lib/parse-number.ts'), []));

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

// ── Unit: parseMoneyInput (the app-wide typed-money gate) ────────────
eq(parseMoneyInput('1,000'), 1000, 'money: "1,000" is 1000, not 1');
eq(parseMoneyInput('1,500'), 1500, 'money: "1,500" is 1500');
eq(parseMoneyInput('12,345.67'), 12345.67, 'money: "12,345.67"');
eq(parseMoneyInput('$25.50'), 25.5, 'money: currency symbol tolerated');
eq(parseMoneyInput('abc'), null, 'money: "abc" rejected');
eq(parseMoneyInput('12abc'), null, 'money: "12abc" rejected, no partial parse');
eq(parseMoneyInput('1e9'), null, 'money: scientific notation rejected');
eq(parseMoneyInput('1.2.3'), null, 'money: double dot rejected');
eq(parseMoneyInput(''), null, 'money: empty rejected');
eq(parseMoneyInput('-500'), null, 'money: negative rejected by default');
eq(parseMoneyInput('-500', { allowNegative: true }), -500, 'money: negative allowed when opted in');
eq(parseMoneyInput('(12.34)', { allowNegative: true }), -12.34, 'money: parens negative');
eq(parseMoneyInput('9999999999999999'), null, 'money: absurd magnitude rejected');
eq(parseMoneyInput('.5'), 0.5, 'money: ".5" is 50 cents');

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

// ── PDF layout: synthetic Synchrony page (positioned runs -> records) ─
// Mirrors the user's screenshot: Date | Reference # | Description | Amount,
// section rows with subtotals, right-aligned amounts, year only in the period
// header line.
const synchronyRuns = [
  { str: 'Statement Period 06/01/26 - 06/30/26', x: 50, y: 720, width: 180 },
  { str: 'Transaction Detail', x: 50, y: 700, width: 96 },
  { str: 'Date', x: 50, y: 680, width: 21 },
  { str: 'Reference #', x: 110, y: 680, width: 54 },
  { str: 'Description', x: 250, y: 680, width: 50 },
  { str: 'Amount', x: 520, y: 680, width: 34 },
  { str: 'Payments', x: 50, y: 660, width: 44 },
  { str: '-$489.44', x: 500, y: 660, width: 40 },
  { str: '06/28', x: 50, y: 640, width: 25 },
  { str: '8521333J400XS6H17', x: 110, y: 640, width: 98 },
  { str: 'ONLINE PAYMENT THANK YOU', x: 250, y: 640, width: 150 },
  { str: '-$489.44', x: 500, y: 640, width: 40 },
  { str: 'Other Credits', x: 50, y: 622, width: 60 },
  { str: '-$251.03', x: 500, y: 622, width: 40 },
  { str: '06/15', x: 50, y: 604, width: 25 },
  { str: '3521999HR21BN16NM', x: 110, y: 604, width: 105 },
  { str: 'SAMS CLUB 6647 HUNTSVILLE AL', x: 250, y: 604, width: 162 },
  { str: '-$251.03', x: 500, y: 604, width: 40 },
  { str: 'Purchases', x: 50, y: 586, width: 48 },
  { str: '$63.95', x: 505, y: 586, width: 35 },
  { str: '06/03', x: 50, y: 568, width: 25 },
  { str: '55432110098812340', x: 110, y: 568, width: 98 },
  { str: 'STARBUCKS STORE 4412', x: 250, y: 568, width: 120 },
  { str: '5.75', x: 515, y: 568, width: 25 },
  { str: '06/07', x: 50, y: 550, width: 25 },
  { str: '55432110098812341', x: 110, y: 550, width: 98 },
  { str: 'SHELL OIL 574123', x: 250, y: 550, width: 90 },
  { str: '48.20', x: 510, y: 550, width: 30 },
];
{
  const records = documentToRecords([synchronyRuns]);
  const year = findStatementYear('Statement Period 06/01/26 - 06/30/26');
  eq(year, 2026, 'pdf: statement year from period line');
  const result = parseStatementRecords(records, { statementYear: year, today: TODAY });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push('✗ pdf synchrony: unrecognizedFormat');
  } else {
    eq(result.rows, [
      { date: '2026-06-28', note: 'ONLINE PAYMENT THANK YOU', amount: -489.44 },
      { date: '2026-06-15', note: 'SAMS CLUB 6647 HUNTSVILLE AL', amount: -251.03 },
      { date: '2026-06-03', note: 'STARBUCKS STORE 4412', amount: 5.75 },
      { date: '2026-06-07', note: 'SHELL OIL 574123', amount: 48.2 },
    ], 'pdf synchrony: 4 txns, section subtotals excluded, year applied');
  }
}

// ── PDF layout: synthetic Chase page (two-line header, all-negative sales) ─
// Mirrors the user's screenshot: "Date of / Transaction" stacked header,
// "Merchant Name or Transaction Description", "$ Amount"; purchases negative.
const chaseRuns = [
  { str: 'Opening/Closing Date 06/01/26 - 06/30/26', x: 60, y: 730, width: 200 },
  { str: 'Date of', x: 76, y: 710, width: 36 },
  { str: 'Transaction', x: 76, y: 698, width: 55 },
  { str: 'Merchant Name or Transaction Description', x: 250, y: 698, width: 200 },
  { str: '$ Amount', x: 520, y: 698, width: 45 },
  { str: 'PAYMENTS AND OTHER CREDITS', x: 76, y: 678, width: 170 },
  { str: '06/03', x: 76, y: 660, width: 26 },
  { str: 'Amazon.com Amzn.com/bill WA', x: 250, y: 660, width: 150 },
  { str: '-14.17', x: 530, y: 660, width: 33 },
  { str: '06/08', x: 76, y: 642, width: 26 },
  { str: 'Payment Thank You-Mobile', x: 250, y: 642, width: 130 },
  { str: '-212.30', x: 526, y: 642, width: 38 },
  { str: 'PURCHASE', x: 76, y: 622, width: 60 },
  { str: '06/11', x: 76, y: 604, width: 26 },
  { str: 'CHIPOTLE 1842', x: 250, y: 604, width: 80 },
  { str: '14.28', x: 532, y: 604, width: 30 },
  { str: '06/14', x: 76, y: 586, width: 26 },
  { str: 'DELTA AIR LINES', x: 250, y: 586, width: 90 },
  { str: '412.60', x: 528, y: 586, width: 35 },
];
{
  const records = documentToRecords([chaseRuns]);
  const year = findStatementYear('Opening/Closing Date 06/01/26 - 06/30/26');
  const result = parseStatementRecords(records, { statementYear: year, today: TODAY });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push('✗ pdf chase: unrecognizedFormat (records: ' + JSON.stringify(records.slice(0, 3)) + ')');
  } else {
    eq(result.rows, [
      { date: '2026-06-03', note: 'Amazon.com Amzn.com/bill WA', amount: -14.17 },
      { date: '2026-06-08', note: 'Payment Thank You-Mobile', amount: -212.3 },
      { date: '2026-06-11', note: 'CHIPOTLE 1842', amount: 14.28 },
      { date: '2026-06-14', note: 'DELTA AIR LINES', amount: 412.6 },
    ], 'pdf chase: stacked header parsed, credits negative, purchases positive');
  }
}

// ── PDF layout: wrapped description joins its row ─
const wrapRuns = [
  { str: 'Date', x: 50, y: 700, width: 21 },
  { str: 'Description', x: 150, y: 700, width: 50 },
  { str: 'Amount', x: 500, y: 700, width: 34 },
  { str: '06/10/2026', x: 50, y: 680, width: 48 },
  { str: 'A Very Long Merchant Name That', x: 150, y: 680, width: 160 },
  { str: '12.00', x: 505, y: 680, width: 28 },
  { str: 'wraps onto a second line', x: 150, y: 668, width: 120 },
];
{
  const records = documentToRecords([wrapRuns]);
  const result = parseStatementRecords(records, { today: TODAY });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push('✗ pdf wrap: unrecognizedFormat');
  } else {
    eq(result.rows, [
      { date: '2026-06-10', note: 'A Very Long Merchant Name That wraps onto a second line', amount: 12 },
    ], 'pdf wrap: continuation line appended to description');
  }
}

// ── PDF end-to-end: real pdfjs extraction through the whole pipeline ─
// Builds an actual PDF file in memory, extracts it with the same pdfjs build
// the app uses, and runs the result through layout + interpretation.
{
  const lines = [
    'BT /F1 12 Tf 50 720 Td (Statement Period 06/01/26 - 06/30/26) Tj ET',
    'BT /F1 10 Tf 50 680 Td (Date) Tj ET',
    'BT /F1 10 Tf 110 680 Td (Reference #) Tj ET',
    'BT /F1 10 Tf 250 680 Td (Description) Tj ET',
    'BT /F1 10 Tf 520 680 Td (Amount) Tj ET',
    'BT /F1 10 Tf 50 660 Td (Payments) Tj ET',
    'BT /F1 10 Tf 500 660 Td (-$489.44) Tj ET',
    'BT /F1 10 Tf 50 640 Td (06/28) Tj ET',
    'BT /F1 10 Tf 110 640 Td (8521333J400XS6H17) Tj ET',
    'BT /F1 10 Tf 250 640 Td (ONLINE PAYMENT THANK YOU) Tj ET',
    'BT /F1 10 Tf 500 640 Td (-$489.44) Tj ET',
    'BT /F1 10 Tf 50 620 Td (06/15) Tj ET',
    'BT /F1 10 Tf 250 620 Td (SAMS CLUB 6647 HUNTSVILLE AL) Tj ET',
    'BT /F1 10 Tf 500 620 Td (-$251.03) Tj ET',
    'BT /F1 10 Tf 50 600 Td (06/03) Tj ET',
    'BT /F1 10 Tf 250 600 Td (STARBUCKS STORE 4412) Tj ET',
    'BT /F1 10 Tf 515 600 Td (5.75) Tj ET',
    'BT /F1 10 Tf 50 580 Td (06/07) Tj ET',
    'BT /F1 10 Tf 250 580 Td (SHELL OIL 574123) Tj ET',
    'BT /F1 10 Tf 510 580 Td (48.20) Tj ET',
    'BT /F1 10 Tf 50 560 Td (06/12) Tj ET',
    'BT /F1 10 Tf 250 560 Td (NETFLIX.COM) Tj ET',
    'BT /F1 10 Tf 510 560 Td (15.49) Tj ET',
  ];
  const stream = lines.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  const { createRequire } = await import('node:module');
  const req = createRequire(join(root, 'package.json'));
  const pdfjs = await import('file://' + req.resolve('pdfjs-dist/legacy/build/pdf.js').replace(/\\/g, '/'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(pdf, 'latin1')), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  const textParts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const runs = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.transform) continue;
      runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width ?? 0 });
      if (item.str.trim()) textParts.push(item.str);
    }
    pages.push(runs);
  }
  await doc.destroy();

  const records = documentToRecords(pages);
  const year = findStatementYear(textParts.join('\n'));
  const result = parseStatementRecords(records, { statementYear: year, today: TODAY });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push('✗ pdf e2e: unrecognizedFormat');
  } else {
    eq(result.rows, [
      { date: '2026-06-28', note: 'ONLINE PAYMENT THANK YOU', amount: -489.44 },
      { date: '2026-06-15', note: 'SAMS CLUB 6647 HUNTSVILLE AL', amount: -251.03 },
      { date: '2026-06-03', note: 'STARBUCKS STORE 4412', amount: 5.75 },
      { date: '2026-06-07', note: 'SHELL OIL 574123', amount: 48.2 },
      { date: '2026-06-12', note: 'NETFLIX.COM', amount: 15.49 },
    ], 'pdf e2e: bytes -> pdfjs -> layout -> transactions');
  }
}

// ── Report ───────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
  console.log(failures.join('\n\n'));
  console.log('');
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
