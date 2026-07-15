import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { parseCsvLine } from '../lib/csv';
import { listAllTransactions, createTransaction } from '../lib/queries';
import { listRecurringTransactions } from './recurring-transactions';
import { suggestCategory } from './smart-categorizer';

// Imports a bank/credit-card statement export (a generic Date/Description/
// Amount CSV — the format most banks export, distinct from the app's own
// export format in lib/csv.ts). Column names are matched loosely by keyword
// so it tolerates the header variations different banks use.
//
// Dedup rules, so re-uploading an overlapping statement (or one that covers a
// bill also handled by Recurring Bills) doesn't create duplicate transactions:
//   1. Exact match (date + amount + note) against existing transactions is
//      skipped — the row was already imported.
//   2. A row matching an ACTIVE recurring transaction's (note, amount) is
//      skipped — that charge is already tracked automatically by the
//      recurring engine, so it shouldn't also land here as a one-off import.
// Everything else imports normally, even if a merchant with the same name
// appeared last month — only exact re-imports and recognized recurring bills
// are excluded.

export type StatementImportResult = {
  imported: number;
  duplicatesSkipped: number;
  recurringSkipped: number;
  uncategorized: number;
  malformedRows: number;
} | { unrecognizedFormat: true };

function findColumn(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.includes(k)));
}

/** Parses "$1,234.56", "-12.34", "(12.34)" (parens = negative), "+5" etc. */
function parseStatementAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Accepts ISO (YYYY-MM-DD) or US-style (MM/DD/YYYY, MM/DD/YY) dates. */
function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = m[3];
    if (year.length === 2) year = (parseInt(year, 10) > 70 ? '19' : '20') + year;
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Prompts for a CSV file and imports it as transactions on `cardId`.
 * Returns null if the user cancels the file picker, or
 * `{ unrecognizedFormat: true }` if no date/description/amount columns
 * could be identified from the header row.
 */
export async function importCreditCardStatement(cardId: string): Promise<StatementImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;

  const content = await FileSystem.readAsStringAsync(picked.assets[0].uri);
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { imported: 0, duplicatesSkipped: 0, recurringSkipped: 0, uncategorized: 0, malformedRows: 0 };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = findColumn(headers, ['transaction date', 'date']);
  const descIdx = findColumn(headers, ['description', 'merchant', 'payee', 'particular']);
  const amountIdx = findColumn(headers, ['amount']);
  const debitIdx = findColumn(headers, ['debit']);
  const creditIdx = findColumn(headers, ['credit']);

  if (dateIdx === -1 || descIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    return { unrecognizedFormat: true };
  }

  const [existingTransactions, recurring] = await Promise.all([listAllTransactions(), listRecurringTransactions()]);

  const existingKeys = new Set(
    existingTransactions.map((t) => `${t.date}|${t.amount.toFixed(2)}|${(t.note ?? '').trim().toLowerCase()}`)
  );
  const recurringKeys = new Set(
    recurring.filter((r) => r.active).map((r) => `${r.amount.toFixed(2)}|${r.note.trim().toLowerCase()}`)
  );

  let imported = 0;
  let duplicatesSkipped = 0;
  let recurringSkipped = 0;
  let uncategorized = 0;
  let malformedRows = 0;

  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const note = (fields[descIdx] ?? '').trim();
    const date = parseStatementDate(fields[dateIdx] ?? '');

    let amount: number | null = null;
    if (amountIdx !== -1) {
      amount = parseStatementAmount(fields[amountIdx] ?? '');
    } else {
      const debit = debitIdx !== -1 ? parseStatementAmount(fields[debitIdx] ?? '') : null;
      const credit = creditIdx !== -1 ? parseStatementAmount(fields[creditIdx] ?? '') : null;
      if (debit) amount = Math.abs(debit);
      else if (credit) amount = -Math.abs(credit);
    }

    if (!date || !note || amount === null || amount === 0) {
      malformedRows++;
      continue;
    }

    const normalizedNote = note.toLowerCase();
    const exactKey = `${date}|${amount.toFixed(2)}|${normalizedNote}`;
    if (existingKeys.has(exactKey)) {
      duplicatesSkipped++;
      continue;
    }

    const recurringKey = `${amount.toFixed(2)}|${normalizedNote}`;
    if (recurringKeys.has(recurringKey)) {
      recurringSkipped++;
      continue;
    }

    const suggestion = await suggestCategory(note);
    if (!suggestion) uncategorized++;

    await createTransaction({
      amount,
      date,
      categoryId: suggestion?.categoryId ?? null,
      cardId,
      note,
      source: 'imported',
    });
    // Guards against duplicate rows within the same file.
    existingKeys.add(exactKey);
    imported++;
  }

  return { imported, duplicatesSkipped, recurringSkipped, uncategorized, malformedRows };
}
