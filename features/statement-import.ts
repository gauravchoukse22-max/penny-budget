import * as DocumentPicker from 'expo-document-picker';
import { parseCsv } from '../lib/csv';
import { readPickedFileAsText, readPickedFileAsBytes } from '../lib/files';
import { documentToRecords } from '../lib/pdf-layout';
import { listAllTransactions, createTransaction } from '../lib/queries';
import { listRecurringTransactions } from './recurring-transactions';
import { suggestCategory } from './smart-categorizer';
import {
  parseStatementRecords,
  findStatementYear,
  type ParsedStatementRow,
  type StatementParseResult,
} from '../lib/statement-parse';

// Imports a bank / credit-card statement export. The parsing (dates, amount
// signs, section subtotals, header detection) lives in lib/statement-parse.ts,
// which is pure and fixture-tested (scripts/test-statement-parse.mjs). This
// module owns the two things that can't be unit-tested: picking the file and
// writing to the database.
//
// The flow is two-phase so nothing is written blind:
//   1. pickAndParseStatement() reads the file and returns a PREVIEW — every
//      parsed row plus a category guess and a duplicate flag — for the user to
//      review and correct.
//   2. commitStatementRows() writes the rows the user kept.
// The old one-shot importer silently dropped anything it couldn't parse; the
// preview surfaces those instead (result.skipped) so a bad parse is visible,
// not invisible.

export type StatementPreviewRow = ParsedStatementRow & {
  /** Best-guess category (name resolved by the UI from its category list). */
  categoryId: string | null;
  /** Matches an existing transaction (already imported) — default to skipping. */
  duplicate: boolean;
  /** Matches an active recurring bill — already tracked, default to skipping. */
  recurring: boolean;
};

export type StatementPreview = {
  rows: StatementPreviewRow[];
  skipped: StatementParseResult['skipped'];
  signFlipped: boolean;
  dateOrder: StatementParseResult['dateOrder'];
  inferredYear: number | null;
  filename: string;
};

export type StatementPickResult =
  | StatementPreview
  | { unrecognizedFormat: true }
  | { pdfUnsupported: true; reason: string }
  | null;

// Banks serve CSV under a grab-bag of MIME types (text/csv, application/csv,
// vnd.ms-excel, octet-stream, or nothing). Restricting the picker to 'text/csv'
// made real exports unselectable on iOS/Android, so accept broadly and let the
// parser reject anything that isn't a statement.
const PICKER_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/pdf',
  'text/plain',
  'application/octet-stream',
  '*/*',
];

function looksLikePdf(asset: DocumentPicker.DocumentPickerAsset): boolean {
  const name = (asset.name ?? '').toLowerCase();
  const mime = (asset.mimeType ?? '').toLowerCase();
  return name.endsWith('.pdf') || mime === 'application/pdf';
}

/**
 * Prompts for a file and returns a reviewable preview. Returns null if the user
 * cancels, or `{ unrecognizedFormat: true }` if no date/description/amount
 * columns could be identified.
 */
export async function pickAndParseStatement(): Promise<StatementPickResult> {
  const picked = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;

  const asset = picked.assets[0];

  let records: string[][];
  let statementYear: number | null;
  if (looksLikePdf(asset)) {
    // PDF path: positioned text runs -> row/column matrix (lib/pdf-layout),
    // then the SAME interpreter as CSV, so both formats share year inference,
    // sign detection, and section-subtotal exclusion.
    const { extractPdfRuns } = await import('./pdf-extract');
    const extracted = await extractPdfRuns(await readPickedFileAsBytes(asset));
    if ('pdfUnsupported' in extracted) return extracted;
    records = documentToRecords(extracted.pages);
    statementYear = findStatementYear(extracted.fullText);
  } else {
    const content = await readPickedFileAsText(asset);
    records = parseCsv(content);
    statementYear = findStatementYear(content);
  }
  const parsed = parseStatementRecords(records, { statementYear });

  if ('unrecognizedFormat' in parsed) return { unrecognizedFormat: true };

  const [existingTransactions, recurring] = await Promise.all([listAllTransactions(), listRecurringTransactions()]);
  const existingKeys = new Set(
    existingTransactions.map((t) => `${t.date}|${t.amount.toFixed(2)}|${(t.note ?? '').trim().toLowerCase()}`)
  );
  const recurringKeys = new Set(
    recurring.filter((r) => r.active).map((r) => `${r.amount.toFixed(2)}|${r.note.trim().toLowerCase()}`)
  );

  const rows: StatementPreviewRow[] = [];
  for (const row of parsed.rows) {
    const normalizedNote = row.note.trim().toLowerCase();
    const exactKey = `${row.date}|${row.amount.toFixed(2)}|${normalizedNote}`;
    const recurringKey = `${row.amount.toFixed(2)}|${normalizedNote}`;
    const suggestion = await suggestCategory(row.note);
    rows.push({
      ...row,
      categoryId: suggestion?.categoryId ?? null,
      duplicate: existingKeys.has(exactKey),
      recurring: recurringKeys.has(recurringKey),
    });
  }

  return {
    rows,
    skipped: parsed.skipped,
    signFlipped: parsed.signFlipped,
    dateOrder: parsed.dateOrder,
    inferredYear: parsed.inferredYear,
    filename: asset.name ?? 'statement.csv',
  };
}

export type CommitResult = { imported: number; uncategorized: number };

/**
 * Writes the reviewed rows to `cardId`. Only rows the user chose to keep should
 * be passed in. Deduplicates within the batch so an accidental repeat in one
 * file doesn't double-write.
 */
export async function commitStatementRows(cardId: string, rows: StatementPreviewRow[]): Promise<CommitResult> {
  let imported = 0;
  let uncategorized = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.date}|${row.amount.toFixed(2)}|${row.note.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!row.categoryId) uncategorized++;
    await createTransaction({
      amount: row.amount,
      date: row.date,
      categoryId: row.categoryId,
      cardId,
      note: row.note,
      source: 'imported',
    });
    imported++;
  }

  return { imported, uncategorized };
}
