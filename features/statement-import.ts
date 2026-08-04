import * as DocumentPicker from 'expo-document-picker';
import { parseCsv } from '../lib/csv';
import { readPickedFileAsText, readPickedFileAsBytes } from '../lib/files';
import { documentToRecords } from '../lib/pdf-layout';
import { listAllTransactions, createTransaction, listCategories } from '../lib/queries';
import { matchStatementCategory } from '../lib/statement-categories';
import { listRecurringTransactions } from './recurring-transactions';
import { suggestCategory, upsertCategoryRule } from './smart-categorizer';
import { merchantToken } from '../lib/merchant-token';
import {
  parseStatementRecords,
  findStatementYear,
  findStatementEndDate,
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

/**
 * Where a preview row's category came from. `'user'` is the only one the person
 * chose themselves; the rest are the app's work, and only `'history'` and
 * `'naive_bayes'` are actually GUESSES — a keyword rule and the issuer's own
 * category column are both facts, not predictions.
 */
export type CategoryOrigin = 'statement' | 'rule' | 'history' | 'naive_bayes' | 'user';

export type StatementPreviewRow = ParsedStatementRow & {
  /** Best-guess category (name resolved by the UI from its category list). */
  categoryId: string | null;
  /** How `categoryId` was arrived at; null while there is no category. */
  categoryOrigin: CategoryOrigin | null;
  /**
   * True while `categoryId` is an UNCONFIRMED guess. The preview screen used to
   * render a guess and a deliberate choice identically, so the only way to know
   * whether a category had been reviewed was to remember doing it — and the
   * import wrote both without distinction.
   */
  suggested: boolean;
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
  // `diagnostic` replaces the generic "no columns" wording when we know
  // something more specific — most usefully that the PDF is a scan with no text
  // in it at all, which no parser can ever read and which otherwise looks
  // identical to a parsing failure.
  | { unrecognizedFormat: true; diagnostic?: string }
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
  // The statement's closing date: what decides the year of every row that
  // doesn't carry one, and what keeps a December charge on a January statement
  // in December.
  let statementEndDate: string | null = null;
  if (looksLikePdf(asset)) {
    // PDF path: positioned text runs -> row/column matrix (lib/pdf-layout),
    // then the SAME interpreter as CSV, so both formats share year inference,
    // sign detection, and section-subtotal exclusion.
    const { extractPdfRuns } = await import('./pdf-extract');
    const extracted = await extractPdfRuns(await readPickedFileAsBytes(asset));
    if ('pdfUnsupported' in extracted) return extracted;
    records = documentToRecords(extracted.pages);
    statementYear = findStatementYear(extracted.fullText);
    statementEndDate = findStatementEndDate(extracted.fullText);
    if (records.length <= 1) {
      // Nothing in the document looked like a transaction. The user needs to
      // know which of the two very different causes it was, because only one of
      // them is fixable by picking a different file.
      return {
        unrecognizedFormat: true,
        diagnostic: extracted.fullText.trim()
          ? 'That PDF was read, but no line in it looked like a transaction — a date, a description and an amount together on one line. If you picked a summary or rewards page, try the full statement. Otherwise a CSV export from your bank will import cleanly.'
          : 'That PDF has no text in it — it’s a scan or a photo, so there is nothing to read. Download the statement PDF from your bank’s website or app rather than scanning it, or export a CSV.',
      };
    }
  } else {
    const content = await readPickedFileAsText(asset);
    records = parseCsv(content);
    statementYear = findStatementYear(content);
    statementEndDate = findStatementEndDate(content);
  }
  const parsed = parseStatementRecords(records, { statementYear, statementEndDate });

  if ('unrecognizedFormat' in parsed) return { unrecognizedFormat: true };

  const [existingTransactions, recurring, categories] = await Promise.all([
    listAllTransactions(),
    listRecurringTransactions(),
    listCategories(),
  ]);
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
    // The statement's own category wins when it maps onto the user's list: the
    // issuer classified the merchant from its MCC code, which beats guessing
    // from the name. The guesser fills in when there is no category column or
    // the issuer's term matches nothing the user has.
    const fromStatement = row.category ? matchStatementCategory(row.category, categories) : null;
    const suggestion = fromStatement ? null : await suggestCategory(row.note);
    const origin: CategoryOrigin | null = fromStatement ? 'statement' : (suggestion?.source ?? null);
    rows.push({
      ...row,
      categoryId: fromStatement ?? suggestion?.categoryId ?? null,
      categoryOrigin: origin,
      // A rule and the issuer's category column don't need confirming: one is
      // a decision the user already made and the other is the merchant's MCC
      // code. Marking those "suggested" would bury the handful of rows that
      // genuinely are a coin-flip under a wall of things to confirm.
      suggested: origin === 'history' || origin === 'naive_bayes',
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

/**
 * Turns a reviewed batch into durable keyword rules, so the same merchants come
 * back as `source: 'rule'` (confidence 1.0) on the next statement instead of
 * being guessed again.
 *
 * Correcting a row used to teach nothing at all: the fix lived only in that one
 * transaction, and the next month's statement made the identical wrong guess.
 *
 * Only rows the user stood behind are learned from:
 *   * `'user'`   — they picked the category themselves,
 *   * `'history'` / `'naive_bayes'` once `suggested` is false — they accepted a
 *     guess, which is a decision.
 * `'rule'` rows are skipped (already a rule, and re-learning would add a
 * narrower duplicate of one that already works), and `'statement'` rows are
 * skipped because the issuer's category column will be there again next month
 * anyway — learning from it would write a rule per merchant on the statement.
 *
 * Pass EVERY reviewed row, not just the imported ones: a duplicate the user
 * corrected and then excluded is still a correction worth keeping.
 */
export async function learnFromReviewedRows(rows: StatementPreviewRow[]): Promise<number> {
  // Collapse to one write per merchant first — a phone bill statement has forty
  // rows for the same merchant, and forty upserts of the same keyword is thirty
  // nine pointless sync journal entries. Last row wins if one merchant somehow
  // got two categories in one batch; there is no honest way to pick between
  // them and the later edit is the more recent intent.
  const byToken = new Map<string, string>();
  for (const row of rows) {
    if (!row.categoryId || row.suggested) continue;
    const origin = row.categoryOrigin;
    if (origin !== 'user' && origin !== 'history' && origin !== 'naive_bayes') continue;
    const token = merchantToken(row.note);
    if (!token) continue;
    byToken.set(token, row.categoryId);
  }

  let learned = 0;
  for (const [token, categoryId] of byToken) {
    if (await upsertCategoryRule(token, categoryId)) learned++;
  }
  return learned;
}
