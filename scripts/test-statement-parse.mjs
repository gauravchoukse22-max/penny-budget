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
const { parseStatementRecords, parseStatementAmount, parseStatementDate, detectDateOrder, detectSignConvention, findStatementYear, extractTrailingAmount } = parse;
const linesUrl = await transform(join(root, 'lib/statement-lines.ts'), []);
const statementLines = await import(linesUrl);
const { readStatementLine, linesToRecords, sectionSignFor, hasTrailingBalanceColumn } = statementLines;
const layout = await import(await transform(join(root, 'lib/pdf-layout.ts'), [], { './statement-lines': linesUrl }));
const { clusterRowsFromRuns, pageToRecords, documentToRecords, rowsToLines } = layout;
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
  // pdfjs 3.x legacy is CJS: under ESM `import()` the API lands on `.default`,
  // NOT on the namespace. Reaching for `ns.getDocument` threw
  // "pdfjs.getDocument is not a function" and aborted the whole suite before a
  // single result was printed — which is why the PDF path shipped unverified.
  const pdfjsNs = await import('file://' + req.resolve('pdfjs-dist/legacy/build/pdf.js').replace(/\\/g, '/'));
  const pdfjs = pdfjsNs.default ?? pdfjsNs;
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

// ══ Universal line reader: one fixture per real issuer layout ═════════
// These are the printed LINES of a statement, which is what the app now works
// from. They are modelled on each issuer's published statement layout — column
// positions differ wildly between them, and none of that matters any more,
// because a transaction is recognised by its shape: leading date, trailing
// amount. Every issuer here was previously unreadable unless its table header
// happened to be the first one in the document.
function runLines(name, lines, expected, opts = {}) {
  const records = linesToRecords(lines);
  const result = parseStatementRecords(records, { today: TODAY, ...opts });
  if ('unrecognizedFormat' in result) {
    failed++;
    failures.push(`✗ ${name}: unrecognizedFormat (records: ${JSON.stringify(records.slice(0, 3))})`);
    return;
  }
  eq(result.rows, expected, name);
  return result;
}

// ── THE REGRESSION: Chase, with the payment-information box FIRST ─────
// This is the exact shape that imported 0 of 162 rows, twice. The document has
// three tables; the old reader locked onto the payment box (it contains "date",
// "payment" and "name") and then read every real transaction row through THAT
// table's columns, so all 162 failed with "no date" and the dialog quoted a
// line of legal prose back at the user.
const chaseFull = [
  'CHASE FREEDOM UNLIMITED',
  'Opening/Closing Date 06/09/26 - 07/08/26',
  'Payment Information',
  'New Balance $2,345.67',
  'Minimum Payment Due $35.00',
  'Payment Due Date 08/05/26',
  'Account Number: 1234 5678 9012 3456',
  'Late Payment Warning: If we do not receive your minimum payment by the date listed',
  'above, you may have to pay a late fee of up to $40.00.',
  'The amount of your payment should be at least your minimum payment,',
  'Minimum Payment Warning: If you make only the minimum payment each period, you will',
  'pay more in interest and it will take you longer to pay off your balance.',
  'ACCOUNT ACTIVITY',
  'Date of',
  'Transaction Merchant Name or Transaction Description $ Amount',
  'PAYMENTS AND OTHER CREDITS',
  '06/12 Payment Thank You - Web -1,500.00',
  '06/20 AMAZON.COM RETURN CREDIT AMZN.COM/BILL WA -32.18',
  'PURCHASE',
  '06/14 AMAZON.COM*RT4G61OI3 AMZN.COM/BILL WA 42.19',
  '06/16 STARBUCKS STORE 06253 HUNTSVILLE AL 6.75',
  '06/21 SHELL OIL 57444120108 HUNTSVILLE AL 48.02',
  '07/01 PUBLIX SUPER MAR HUNTSVILLE AL 132.44',
  'INTEREST CHARGED',
  '07/08 PURCHASE INTEREST CHARGE 12.31',
  '2026 Totals Year-to-Date',
  'Total fees charged in 2026 $0.00',
  'Total interest charged in 2026 $84.12',
];
runLines('chase: payment box + legal text + real activity', chaseFull, [
  { date: '2026-06-12', note: 'Payment Thank You - Web', amount: -1500 },
  { date: '2026-06-20', note: 'AMAZON.COM RETURN CREDIT AMZN.COM/BILL WA', amount: -32.18 },
  { date: '2026-06-14', note: 'AMAZON.COM*RT4G61OI3 AMZN.COM/BILL WA', amount: 42.19 },
  { date: '2026-06-16', note: 'STARBUCKS STORE 06253 HUNTSVILLE AL', amount: 6.75 },
  { date: '2026-06-21', note: 'SHELL OIL 57444120108 HUNTSVILLE AL', amount: 48.02 },
  { date: '2026-07-01', note: 'PUBLIX SUPER MAR HUNTSVILLE AL', amount: 132.44 },
  { date: '2026-07-08', note: 'PURCHASE INTEREST CHARGE', amount: 12.31 },
], { statementYear: 2026 });

// ── American Express: full dates, $ on every amount, credits signed ───
runLines('amex: MM/DD/YY dates, $ amounts, signed credit', [
  'Card Ending 3-71005',
  'New Balance $1,204.88',
  'Minimum Payment Due $40.00',
  'Detail',
  '06/02/26 AplPay COSTCO WHSE #1234 HUNTSVILLE AL $124.56',
  '06/05/26 UBER TRIP HELP.UBER.COM CA $18.40',
  '06/11/26 PAYMENT RECEIVED - THANK YOU -$500.00',
  '06/19/26 DELTA AIR LINES ATLANTA GA $412.60',
], [
  { date: '2026-06-02', note: 'AplPay COSTCO WHSE #1234 HUNTSVILLE AL', amount: 124.56 },
  { date: '2026-06-05', note: 'UBER TRIP HELP.UBER.COM CA', amount: 18.4 },
  { date: '2026-06-11', note: 'PAYMENT RECEIVED - THANK YOU', amount: -500 },
  { date: '2026-06-19', note: 'DELTA AIR LINES ATLANTA GA', amount: 412.6 },
]);

// ── Discover: TWO dates per row, and NO signs anywhere ────────────────
// The only layout where the section banner decides the sign, because the
// issuer never marks a credit. Getting this wrong imports a $1,022 payment as
// $1,022 of spending.
runLines('discover: trans+post dates, unsigned amounts, banner sets sign', [
  'PAYMENTS AND CREDITS',
  '06/04 06/04 DIRECTPAY FULL BALANCE 1,022.15',
  'PURCHASES',
  '06/06 06/07 WAL-MART #1234 HUNTSVILLE AL 87.33',
  '06/09 06/10 NETFLIX.COM LOS GATOS CA 15.49',
  '06/22 06/23 KROGER FUEL #0442 HUNTSVILLE AL 41.08',
], [
  { date: '2026-06-04', note: 'DIRECTPAY FULL BALANCE', amount: -1022.15 },
  { date: '2026-06-06', note: 'WAL-MART #1234 HUNTSVILLE AL', amount: 87.33 },
  { date: '2026-06-09', note: 'NETFLIX.COM LOS GATOS CA', amount: 15.49 },
  { date: '2026-06-22', note: 'KROGER FUEL #0442 HUNTSVILLE AL', amount: 41.08 },
]);

// ── Capital One: month-name dates and a TRAILING minus ────────────────
runLines('capital one: "Jun 3" dates, trailing-minus credit', [
  'Transactions',
  'Jun 3 CAPITAL ONE MOBILE PYMT AUTHDATE 03-JUN $ 350.00 -',
  'Jun 7 TARGET.COM * HUNTSVILLE AL $ 63.21',
  'Jun 18 SPOTIFY USA NEW YORK NY $ 11.99',
], [
  { date: '2026-06-03', note: 'CAPITAL ONE MOBILE PYMT AUTHDATE 03-JUN', amount: -350 },
  { date: '2026-06-07', note: 'TARGET.COM * HUNTSVILLE AL', amount: 63.21 },
  { date: '2026-06-18', note: 'SPOTIFY USA NEW YORK NY', amount: 11.99 },
]);

// ── Citi: parenthesised credit ────────────────────────────────────────
runLines('citi: parentheses mean credit', [
  'Standard Purchases',
  '06/05 COSTCO GAS #0812 MADISON AL 52.10',
  '06/09 ONLINE PAYMENT, THANK YOU (825.00)',
  '06/14 HOME DEPOT #0917 HUNTSVILLE AL 214.77',
], [
  { date: '2026-06-05', note: 'COSTCO GAS #0812 MADISON AL', amount: 52.1 },
  { date: '2026-06-09', note: 'ONLINE PAYMENT, THANK YOU', amount: -825 },
  { date: '2026-06-14', note: 'HOME DEPOT #0917 HUNTSVILLE AL', amount: 214.77 },
]);

// ── Wells Fargo checking: a RUNNING BALANCE column after the amount ───
// Taking the last number on the line would import the balance as the charge —
// $1,918.42 of groceries instead of $82.14.
runLines('wells fargo: running-balance column is dropped, not imported', [
  'Date Description Amount Ending daily balance',
  '06/03 PURCHASE AUTHORIZED ON 06/01 KROGER #123 HUNTSVILLE AL 82.14 1,918.42',
  '06/05 ONLINE TRANSFER TO SAVINGS 200.00 1,718.42',
  '06/08 RECURRING PAYMENT AUTHORIZED ON 06/07 SPOTIFY 11.99 1,706.43',
  '06/12 PURCHASE AUTHORIZED ON 06/11 PUBLIX #1234 45.90 1,660.53',
], [
  { date: '2026-06-03', note: 'PURCHASE AUTHORIZED ON 06/01 KROGER #123 HUNTSVILLE AL', amount: 82.14 },
  { date: '2026-06-05', note: 'ONLINE TRANSFER TO SAVINGS', amount: 200 },
  { date: '2026-06-08', note: 'RECURRING PAYMENT AUTHORIZED ON 06/07 SPOTIFY', amount: 11.99 },
  { date: '2026-06-12', note: 'PURCHASE AUTHORIZED ON 06/11 PUBLIX #1234', amount: 45.9 },
]);

// ── Bank of America / USAA / Apple Card: plain one-line rows ──────────
runLines('bofa: CHECKCARD rows', [
  'Purchases and Adjustments',
  '06/12/26 CHECKCARD 0611 PUBLIX #1234 HUNTSVILLE AL 45.90',
  '06/15/26 CHECKCARD 0614 CHICK-FIL-A #0284 45.12',
], [
  { date: '2026-06-12', note: 'CHECKCARD 0611 PUBLIX #1234 HUNTSVILLE AL', amount: 45.9 },
  { date: '2026-06-15', note: 'CHECKCARD 0614 CHICK-FIL-A #0284', amount: 45.12 },
]);

runLines('apple card: four-digit year, $ amounts', [
  'Transactions',
  '06/14/2026 Apple Store $999.00',
  '06/18/2026 Trader Joes Huntsville $76.42',
], [
  { date: '2026-06-14', note: 'Apple Store', amount: 999 },
  { date: '2026-06-18', note: 'Trader Joes Huntsville', amount: 76.42 },
]);

// ── Wrapped merchant names across two printed lines ───────────────────
runLines('wrapped description continues onto the next printed line', [
  'PURCHASE',
  '06/11 SQ *THE VERY LONG COFFEE SHOP NAME 14.28',
  'HUNTSVILLE AL',
  '06/14 DELTA AIR LINES 412.60',
], [
  { date: '2026-06-11', note: 'SQ *THE VERY LONG COFFEE SHOP NAME HUNTSVILLE AL', amount: 14.28 },
  { date: '2026-06-14', note: 'DELTA AIR LINES', amount: 412.6 },
]);

// ── Nothing in a page of legal prose may become a transaction ─────────
{
  const prose = linesToRecords([
    'The amount of your payment should be at least your minimum payment,',
    'and must reach us by 08/05/26 to avoid a late fee of up to $40.00.',
    'Balance Subject to Interest Rate $1,204.88',
    'Annual Percentage Rate (APR) 24.99%',
    'How to Avoid Paying Interest on Purchases: Your due date is at least 25 days',
    'after the close of each billing cycle.',
    'Page 3 of 6',
    'Previous Balance $980.14',
    'New Balance $2,345.67',
  ]);
  eq(prose.length, 1, 'legal prose page yields zero transactions (header row only)');
}

// ── Dates with no year take the statement's year, not today's ─────────
runLines('year comes from the statement period, across a year boundary', [
  'PURCHASE',
  '12/28 AMAZON.COM AMZN.COM/BILL WA 61.20',
  '01/03 KROGER #0442 HUNTSVILLE AL 84.55',
], [
  { date: '2025-12-28', note: 'AMAZON.COM AMZN.COM/BILL WA', amount: 61.2 },
  { date: '2025-01-03', note: 'KROGER #0442 HUNTSVILLE AL', amount: 84.55 },
], { statementYear: 2025 });

// ── Unit: the line reader itself ──────────────────────────────────────
eq(readStatementLine('06/16 STARBUCKS STORE 06253 HUNTSVILLE AL 6.75'),
  { date: '06/16', note: 'STARBUCKS STORE 06253 HUNTSVILLE AL', amount: '6.75' },
  'line: date + merchant + amount');
eq(readStatementLine('Payment Due Date 08/05/26'), null, 'line: summary row with no amount is not a transaction');
eq(readStatementLine('Minimum Payment Due $35.00'), null, 'line: no leading date is not a transaction');
eq(readStatementLine('The amount of your payment should be at least your minimum payment,'), null,
  'line: legal prose is not a transaction');
eq(readStatementLine('06/12 New Balance 2,345.67'), null, 'line: dated summary row is rejected by name');
eq(readStatementLine('06/28 8521333J400XS6H17 ONLINE PAYMENT THANK YOU -$489.44'),
  { date: '06/28', note: 'ONLINE PAYMENT THANK YOU', amount: '-$489.44' },
  'line: reference id stripped from the note');
eq(readStatementLine('06/07 SHELL OIL 574123 48.20'),
  { date: '06/07', note: 'SHELL OIL 574123', amount: '48.20' },
  'line: a short store number is NOT mistaken for a reference id');
eq(readStatementLine('06/03 SHELL OIL 5744221'), null, 'line: bare store number is not an amount');
eq(sectionSignFor('PAYMENTS AND OTHER CREDITS'), 'credit', 'section: credits banner');
eq(sectionSignFor('PURCHASE'), 'debit', 'section: purchases banner');
eq(sectionSignFor('06/11 CHIPOTLE 1842 14.28'), null, 'section: a transaction line is not a banner');
eq(hasTrailingBalanceColumn([
  '06/03 KROGER 82.14 1,918.42',
  '06/05 TRANSFER 200.00 1,718.42',
  '06/08 SPOTIFY 11.99 1,706.43',
]), true, 'balance column detected');
eq(hasTrailingBalanceColumn([
  '06/03 KROGER 82.14',
  '06/05 TRANSFER 200.00',
  '06/08 SPOTIFY 11.99',
]), false, 'no balance column on a normal card statement');

// ── Amount glued to the description ──────────────────────────────────
// A real Chase PDF imported ZERO of 162 rows because its amount column never
// separated: every amount ended up on the end of the description, so each row
// failed with "no amount". These lock in the salvage AND, just as importantly,
// that it cannot eat a merchant's store number.
eq(extractTrailingAmount('STARBUCKS STORE 12345 HUNTSVILLE AL 6.75'),
  { amount: 6.75, note: 'STARBUCKS STORE 12345 HUNTSVILLE AL' }, 'trailing amount: plain');
eq(extractTrailingAmount('AUTOMATIC PAYMENT - THANK YOU -445.94'),
  { amount: -445.94, note: 'AUTOMATIC PAYMENT - THANK YOU' }, 'trailing amount: negative');
eq(extractTrailingAmount('BIG PURCHASE $1,234.56'),
  { amount: 1234.56, note: 'BIG PURCHASE' }, 'trailing amount: thousands + currency');
eq(extractTrailingAmount('REFUND (25.00)'),
  { amount: -25, note: 'REFUND' }, 'trailing amount: parenthesised negative');
eq(extractTrailingAmount('CREDIT 445.94-'),
  { amount: -445.94, note: 'CREDIT' }, 'trailing amount: trailing minus');
// The guard: bare integers are NOT amounts, or every store number becomes one.
eq(extractTrailingAmount('STARBUCKS STORE 12345'), null, 'trailing amount: bare integer is not an amount');
eq(extractTrailingAmount('SHELL OIL 5744221'), null, 'trailing amount: long store number ignored');
eq(extractTrailingAmount('NETFLIX.COM'), null, 'trailing amount: no number at all');
eq(extractTrailingAmount(''), null, 'trailing amount: empty');

{
  // End to end through the real parser, with an EMPTY amount column.
  const records = [
    ['Date of Transaction', 'Merchant Name or Transaction Description', '$ Amount'],
    ['PAYMENTS AND OTHER CREDITS', '', ''],
    ['06/28', 'AUTOMATIC PAYMENT - THANK YOU -445.94', ''],
    ['PURCHASE', '', ''],
    ['07/02', 'STARBUCKS STORE 12345 HUNTSVILLE AL 6.75', ''],
    ['07/04', 'TARGET 00012345 MADISON AL 54.10', ''],
  ];
  const result = parseStatementRecords(records, { statementYear: 2026 });
  if ('unrecognizedFormat' in result) {
    failures.push('✗ glued-amount e2e: unrecognizedFormat');
    failed++;
  } else {
    eq(result.rows, [
      { date: '2026-06-28', note: 'AUTOMATIC PAYMENT - THANK YOU', amount: -445.94 },
      { date: '2026-07-02', note: 'STARBUCKS STORE 12345 HUNTSVILLE AL', amount: 6.75 },
      { date: '2026-07-04', note: 'TARGET 00012345 MADISON AL', amount: 54.1 },
    ], 'glued-amount e2e: recovers every row and strips the amount from the note');
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
