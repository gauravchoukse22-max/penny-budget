// Run a REAL statement PDF through the exact pipeline the app uses, and print
// what it would import. Nothing is uploaded and nothing is written — this reads
// one local file and prints to the terminal.
//
//   node scripts/check-statement-pdf.mjs ~/Downloads/statement.pdf
//   node scripts/check-statement-pdf.mjs ~/Downloads/statement.pdf --show-amounts
//   node scripts/check-statement-pdf.mjs ~/Downloads/statement.pdf --lines
//
// Amounts and merchant names are MASKED by default so the output can be pasted
// into a bug report without exposing what was bought or for how much; the shape
// of every line is preserved, which is all the parser cares about. Pass
// --show-amounts to see the real values on your own screen.
//
// Why this exists: two "fixed" releases of the PDF importer were verified only
// against synthetic statements, and both imported zero rows from a real one.
// A generated fixture can only ever confirm what its author already believed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const showAmounts = args.includes('--show-amounts');
const showLines = args.includes('--lines');

if (!file) {
  console.error('usage: node scripts/check-statement-pdf.mjs <statement.pdf> [--show-amounts] [--lines]');
  process.exit(1);
}

const linesUrl = await transform(join(root, 'lib/statement-lines.ts'), []);
const layout = await import(await transform(join(root, 'lib/pdf-layout.ts'), [], { './statement-lines': linesUrl }));
const { parseStatementRecords, findStatementYear } = await import(await transform(join(root, 'lib/statement-parse.ts'), []));

const req = createRequire(join(root, 'package.json'));
const ns = await import('file://' + req.resolve('pdfjs-dist/legacy/build/pdf.js').replace(/\\/g, '/'));
const pdfjs = ns.default ?? ns;

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  isEvalSupported: false,
  useSystemFonts: true,
  disableFontFace: true,
}).promise;

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

const fullText = textParts.join('\n');
console.log(`pages: ${doc.numPages}   text runs: ${textParts.length}`);
if (!fullText.trim()) {
  console.log('\nThis PDF has NO TEXT LAYER — it is a scan or a photo. No parser can read it.');
  process.exit(0);
}

// Mask digits and letters but keep punctuation, spacing and length, so the
// SHAPE that the parser matches on survives and the content does not.
const mask = (s) => s.replace(/[0-9]/g, '0').replace(/[A-Za-z]/g, 'x');

if (showLines) {
  console.log('\n── every printed line ─────────────────────────────────');
  for (const runs of pages) {
    for (const line of layout.rowsToLines(layout.clusterRowsFromRuns(runs))) {
      if (line.trim()) console.log('  ' + (showAmounts ? line : mask(line)));
    }
  }
}

const records = layout.documentToRecords(pages);
const year = findStatementYear(fullText);
console.log(`\nstatement year detected: ${year ?? '(none — will fall back to nearest past date)'}`);
console.log(`records built: ${Math.max(0, records.length - 1)} transaction rows`);

if (records.length <= 1) {
  console.log('\nNo line in this statement looked like a transaction.');
  console.log('Re-run with --lines to see what the app actually read.');
  process.exit(1);
}

const result = parseStatementRecords(records, { statementYear: year });
if ('unrecognizedFormat' in result) {
  console.log('\nunrecognizedFormat');
  process.exit(1);
}

console.log(`\nWOULD IMPORT: ${result.rows.length} transactions   (skipped ${result.skipped.length})`);
const skipCounts = {};
for (const s of result.skipped) skipCounts[s.reason] = (skipCounts[s.reason] ?? 0) + 1;
if (result.skipped.length) console.log('skip reasons:', skipCounts);
console.log(`sign flipped: ${result.signFlipped}   date order: ${result.dateOrder}`);

const total = result.rows.reduce((sum, r) => sum + r.amount, 0);
console.log('\n── transactions ───────────────────────────────────────');
for (const r of result.rows) {
  const note = showAmounts ? r.note : mask(r.note);
  const amt = showAmounts ? r.amount.toFixed(2) : '·'.repeat(String(Math.abs(r.amount).toFixed(2)).length) + (r.amount < 0 ? ' (credit)' : '');
  console.log(`  ${r.date}  ${note.slice(0, 52).padEnd(52)}  ${amt}`);
}
console.log(`\nnet total: ${showAmounts ? total.toFixed(2) : '(hidden — pass --show-amounts)'}`);
console.log(`credits: ${result.rows.filter((r) => r.amount < 0).length}   charges: ${result.rows.filter((r) => r.amount > 0).length}`);
