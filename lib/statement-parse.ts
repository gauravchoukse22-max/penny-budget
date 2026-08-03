// Pure parsing for bank / credit-card statement exports. No expo, no database,
// no I/O — so it can be exercised directly by the fixture harness in
// scripts/test-statement-parse.mjs. features/statement-import.ts owns the file
// picking and the database writes; everything that decides WHAT a row means
// lives here.
//
// Real statements are messier than the happy path this originally assumed:
//   * Dates often carry NO YEAR ("06/28") because the year is stated once in
//     the statement period header. Those rows used to fail to parse and were
//     silently dropped, which meant a Chase or Synchrony statement imported
//     zero transactions.
//   * The sign convention is not universal. Some issuers export purchases as
//     positive and payments as negative; others do the exact opposite. The app
//     treats a POSITIVE amount as spending, so guessing wrong turns every
//     purchase into a credit.
//   * The header row is not always the first line — exports frequently open
//     with a title or summary block.
// Each of those is handled below by inspecting the whole file before committing
// to an interpretation, rather than by trusting one row.

export type ParsedStatementRow = {
  date: string; // YYYY-MM-DD
  note: string;
  amount: number; // positive = money spent, negative = credit/refund/payment
  /**
   * The statement's OWN category for this row ("Food & Drink", "Gas"), present
   * only when the export has a category column — Chase, Discover, Capital One
   * and Apple Card CSVs all do. The issuer classified the merchant from its
   * MCC code, which beats guessing from the name; lib/statement-categories.ts
   * translates it into the user's categories. Absent (not null) when the file
   * has no category column, so fixtures without one are unaffected.
   */
  category?: string;
};

export type SkippedRow = {
  line: number; // 1-based line number in the source file
  raw: string;
  reason: 'no-date' | 'no-amount' | 'zero-amount' | 'section-total';
};

export type StatementParseResult = {
  rows: ParsedStatementRow[];
  skipped: SkippedRow[];
  /** True when the file's amounts were flipped so that spending reads positive. */
  signFlipped: boolean;
  /** How dates were read, so the UI can show it and the user can catch a misread. */
  dateOrder: 'month-first' | 'day-first';
  /** Year applied to dates that didn't carry one, if any did. */
  inferredYear: number | null;
  headerLine: number; // 1-based line the header was found on
};

export type UnrecognizedFormat = { unrecognizedFormat: true; inspectedLines: string[] };

const DESCRIPTION_KEYWORDS = ['description', 'merchant', 'payee', 'particular', 'transaction detail', 'name'];
const DATE_KEYWORDS = ['transaction date', 'date of transaction', 'trans date', 'trans. date', 'post date', 'posting date', 'date'];
const AMOUNT_KEYWORDS = ['amount', 'debit', 'credit'];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Section subtotal lines ("Payments  -$489.44", "PAYMENTS AND OTHER CREDITS")
 * carry an amount but describe a group, not a charge. Importing them would
 * double-count the whole section, so they're rejected on sight.
 */
const SECTION_LABELS = [
  'payments and other credits',
  'payments and credits',
  'purchases and adjustments',
  'other credits',
  'total fees charged',
  'total interest charged',
  'fees charged',
  'interest charged',
  'payments',
  'purchases',
  'credits',
  'total',
  'subtotal',
  'balance',
  'previous balance',
  'new balance',
  'minimum payment',
];

export function isSectionLabel(note: string): boolean {
  const n = note.trim().toLowerCase().replace(/[:.]+$/, '');
  return SECTION_LABELS.includes(n);
}

/** Parses "$1,234.56", "-12.34", "(12.34)" (parens = negative), "-$489.44", "+5". */
export function parseStatementAmount(raw: string): number | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip currency symbols and separators anywhere, so "-$489.44" and "$-489.44"
  // both reduce to a plain signed number.
  s = s.replace(/[$£€¥,\s]/g, '');
  if (s.startsWith('-') || s.endsWith('-')) {
    negative = true;
    s = s.replace(/-/g, '');
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Pulls a trailing amount off the END of a description, for the very common
 * case where a PDF's amount never landed in its own column and got glued to
 * the description instead: "STARBUCKS STORE 12345 HUNTSVILLE AL 6.75".
 *
 * A PDF has no delimiters — only text at coordinates — so whether the amount
 * becomes its own cell depends on the issuer's column geometry. When it
 * doesn't, every row of the statement fails with "no amount" and the import
 * reports zero transactions, which is what a real Chase statement did.
 *
 * The guard against eating real text is REQUIRING two decimal places. Merchant
 * names are full of bare digits ("STARBUCKS STORE 12345", "SHELL OIL 5744221")
 * and none of them end in `.dd`, so this cannot swallow a store number. A bare
 * integer is deliberately NOT accepted for the same reason.
 *
 * Returns null when there's nothing money-shaped at the end, leaving the row to
 * be skipped and reported exactly as before.
 */
export function extractTrailingAmount(description: string): { amount: number; note: string } | null {
  const s = (description ?? '').trimEnd();
  if (!s) return null;
  // Optional currency symbol / sign / parens, digits with optional thousands
  // separators, then a REQUIRED 2-decimal tail, then optional close-paren or
  // trailing minus (some issuers write "445.94-").
  const match = s.match(/(?:^|\s)([-+(]?\s*[$£€¥]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})|[-+(]?\s*[$£€¥]?\s*\d+\.\d{2})\s*\)?-?$/);
  if (!match) return null;
  const amount = parseStatementAmount(s.slice(match.index ?? 0).trim());
  if (amount === null) return null;
  const note = s.slice(0, match.index ?? 0).trim();
  return { amount, note };
}

type DateParts = { a: number; b: number; year: number | null };

/**
 * Splits a date into its numeric parts WITHOUT deciding whether it's
 * month-first or day-first — that call needs the whole file (see
 * detectDateOrder), because "06/07" is ambiguous in isolation.
 * Returns null if the text isn't a date at all.
 */
function splitDate(raw: string): DateParts | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // ISO: 2026-06-28 (unambiguous, year first)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return { a: parseInt(m[2], 10), b: parseInt(m[3], 10), year: parseInt(m[1], 10) };

  // Month name: "Jun 28, 2026" / "28 Jun 2026" / "Jun 28"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{2,4}))?$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return { a: mon, b: parseInt(m[2], 10), year: m[3] ? normalizeYear(m[3]) : null };
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{2,4}))?$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return { a: mon, b: parseInt(m[1], 10), year: m[3] ? normalizeYear(m[3]) : null };
  }

  // Numeric with separators: 06/28/2026, 06/28/26, 06.28.26, 06-28, 06/28
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    return { a: parseInt(m[1], 10), b: parseInt(m[2], 10), year: m[3] ? normalizeYear(m[3]) : null };
  }

  return null;
}

function normalizeYear(raw: string): number {
  const n = parseInt(raw, 10);
  if (raw.length === 4) return n;
  // Two-digit years: statements are recent, so treat >70 as 19xx and the rest
  // as 20xx (matching the original behaviour).
  return n > 70 ? 1900 + n : 2000 + n;
}

/**
 * Month-first vs day-first can't be decided per row. Scan every date in the
 * file: if any first component exceeds 12 it MUST be a day, so the file is
 * day-first. Otherwise assume month-first (US convention, which is what Chase
 * and Synchrony use).
 */
export function detectDateOrder(rawDates: string[]): 'month-first' | 'day-first' {
  for (const raw of rawDates) {
    const parts = splitDate(raw);
    // Only numeric forms are ambiguous; a month name already resolved itself.
    if (parts && parts.a > 12 && parts.b <= 12) return 'day-first';
  }
  return 'month-first';
}

/**
 * Picks the year for a date that didn't state one. Statements are historical,
 * so the correct year is the most recent one that doesn't put the date in the
 * future — which also handles a December charge appearing on a statement
 * that closes in January.
 */
function inferYear(month: number, day: number, today: Date): number {
  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  // Allow a couple of days of slack for timezone skew rather than treating a
  // charge dated today as next year's.
  const cutoff = new Date(today.getTime() + 2 * 86400000);
  return candidate.getTime() > cutoff.getTime() ? year - 1 : year;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Rejects impossible dates like 02/31 that Date would silently roll over.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts one date cell to YYYY-MM-DD. `order` comes from whole-file analysis;
 * `today` is injectable so the harness is deterministic.
 *
 * `anchor` is the statement's CLOSING date (ISO), and it is what decides the
 * year for a row that didn't state one: the year that puts the charge on or
 * before the close, which is the only thing a statement can contain. That is
 * also what makes a December charge on a January statement land in December
 * rather than eleven months into the future.
 */
export function parseStatementDate(
  raw: string,
  order: 'month-first' | 'day-first' = 'month-first',
  fallbackYear: number | null = null,
  today: Date = new Date(),
  anchor: string | null = null
): string | null {
  const parts = splitDate(raw);
  if (!parts) return null;
  const month = order === 'day-first' && parts.b <= 12 ? parts.b : parts.a;
  const day = order === 'day-first' && parts.b <= 12 ? parts.a : parts.b;

  if (parts.year != null) return toIso(parts.year, month, day);

  if (anchor) {
    const anchorYear = parseInt(anchor.slice(0, 4), 10);
    const sameYear = toIso(anchorYear, month, day);
    // A charge can't be dated after the statement that lists it, so if this
    // month/day falls past the closing date it belongs to the year before.
    if (sameYear && sameYear <= anchor) return sameYear;
    return toIso(anchorYear - 1, month, day);
  }

  return toIso(fallbackYear ?? inferYear(month, day, today), month, day);
}

/**
 * The statement's CLOSING date, as ISO, read from its own period line.
 *
 * This replaces taking the latest year that appears anywhere in the document,
 * which was wrong in a way that hid the whole import: a statement's fine print
 * carries forward-looking years — a promotional rate that ends 01/31/27, a
 * transfer offer expiring next year — and the old rule took the largest one it
 * found. A June 2026 statement then filed every charge under June 2027, where
 * nothing in the app would ever show it. The rows imported, and the month they
 * imported into was a year away.
 *
 * Only dates introduced by a period label count, and a due date is explicitly
 * NOT one: "Payment Due Date 08/05/26" is in the future by design.
 */
const PERIOD_LABEL =
  /(opening\s*\/?\s*closing\s+date|statement\s+closing\s+date|closing\s+date|close\s+date|statement\s+period|billing\s+(?:cycle|period)|period\s+covered|statement\s+date)\s*:?\s*/gi;

const ANY_DATE =
  /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4})\b/gi;

export function findStatementEndDate(text: string, today: Date = new Date()): string | null {
  const horizon = toIso(today.getFullYear(), today.getMonth() + 1, today.getDate()) ?? '9999-12-31';
  const candidates: string[] = [];

  PERIOD_LABEL.lastIndex = 0;
  for (const label of text.matchAll(PERIOD_LABEL)) {
    // A period prints as "06/09/26 - 07/08/26"; the closing date is the LAST
    // date in the short window after the label, not the first.
    const window = text.slice((label.index ?? 0) + label[0].length, (label.index ?? 0) + label[0].length + 60);
    const dates = [...window.matchAll(ANY_DATE)].map((d) => d[1]);
    for (const raw of dates) {
      const iso = parseStatementDate(raw, 'month-first', null, today);
      // A statement cannot close in the future — that is fine print, not a period.
      if (iso && iso <= horizon) candidates.push(iso);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.sort()[candidates.length - 1];
}

/**
 * Back-compatible year accessor: the closing date's year when the statement
 * states a period, else the latest year that isn't in the future. The old
 * version allowed `thisYear + 1`, which is how a 2027 in the fine print won.
 */
export function findStatementYear(text: string, today: Date = new Date()): number | null {
  const end = findStatementEndDate(text, today);
  if (end) return parseInt(end.slice(0, 4), 10);

  const thisYear = today.getFullYear();
  const years = new Set<number>();
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) years.add(parseInt(m[1], 10));
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{2})\b/g)) years.add(normalizeYear(m[1]));
  const plausible = [...years].filter((y) => y >= 2000 && y <= thisYear);
  if (plausible.length === 0) return null;
  return Math.max(...plausible);
}

function findColumn(headers: string[], keywords: string[]): number {
  // Ordered by keyword specificity so "transaction date" wins over a bare
  // "date" column that happens to appear earlier (e.g. a "Post Date" first).
  for (const k of keywords) {
    const idx = headers.findIndex((h) => h.includes(k));
    if (idx !== -1) return idx;
  }
  return -1;
}

type Header = { line: number; fields: string[]; dateIdx: number; descIdx: number; amountIdx: number; debitIdx: number; creditIdx: number; categoryIdx: number };

/**
 * Finds the real header row. Exports often begin with a title or an account
 * summary block, so the first line is not reliably the header — scan the first
 * several rows for one that names a date, a description and an amount.
 */
function findHeader(rows: string[][], maxScan = 25): Header | null {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const fields = rows[i].map((h) => h.trim().toLowerCase());
    const dateIdx = findColumn(fields, DATE_KEYWORDS);
    const descIdx = findColumn(fields, DESCRIPTION_KEYWORDS);
    const amountIdx = findColumn(fields, ['amount']);
    const debitIdx = findColumn(fields, ['debit', 'withdrawal', 'charge']);
    const creditIdx = findColumn(fields, ['credit', 'deposit', 'payment']);
    const categoryIdx = findColumn(fields, ['category']);
    if (dateIdx !== -1 && descIdx !== -1 && (amountIdx !== -1 || debitIdx !== -1 || creditIdx !== -1)) {
      return { line: i, fields, dateIdx, descIdx, amountIdx, debitIdx, creditIdx, categoryIdx };
    }
  }
  return null;
}

/**
 * Decides whether the file's amounts need flipping so that spending is
 * positive (the app sums transaction amounts as spend).
 *
 * A credit-card statement is overwhelmingly purchases, so the sign shared by
 * MOST rows is the sign that means "charge". If that's negative, the whole file
 * is inverted relative to what the app expects. A tie leaves the file alone,
 * keeping the previous behaviour for genuinely ambiguous input.
 */
export function detectSignConvention(amounts: number[]): boolean {
  let negative = 0;
  let positive = 0;
  for (const a of amounts) {
    if (a < 0) negative++;
    else if (a > 0) positive++;
  }
  return negative > positive;
}

/**
 * Parses a delimited statement export into transactions. `records` is already
 * split into fields (lib/csv.ts parseCsv handles quoting, including newlines
 * inside quoted notes).
 */
export function parseStatementRecords(
  records: string[][],
  opts: { statementYear?: number | null; statementEndDate?: string | null; today?: Date } = {}
): StatementParseResult | UnrecognizedFormat {
  const today = opts.today ?? new Date();
  const nonEmpty = records.filter((r) => r.some((f) => f.trim().length > 0));
  const header = findHeader(nonEmpty);
  if (!header) {
    return { unrecognizedFormat: true, inspectedLines: nonEmpty.slice(0, 5).map((r) => r.join(',')) };
  }

  const body = nonEmpty.slice(header.line + 1);
  const { dateIdx, descIdx, amountIdx, debitIdx, creditIdx, categoryIdx } = header;

  const dateOrder = detectDateOrder(body.map((f) => f[dateIdx] ?? ''));

  // Two passes: the first reads every row so the sign convention can be judged
  // from the whole file, the second commits to an interpretation.
  type Draft = { line: number; raw: string; date: string | null; note: string; amount: number | null; fromDebitCredit: boolean; category: string };
  const drafts: Draft[] = body.map((fields, i) => {
    let note = (fields[descIdx] ?? '').trim();
    const category = categoryIdx !== -1 ? (fields[categoryIdx] ?? '').trim() : '';
    const date = parseStatementDate(
      fields[dateIdx] ?? '',
      dateOrder,
      opts.statementYear ?? null,
      today,
      opts.statementEndDate ?? null
    );

    let amount: number | null = null;
    let fromDebitCredit = false;
    if (amountIdx !== -1) {
      amount = parseStatementAmount(fields[amountIdx] ?? '');
    }
    if (amount === null && (debitIdx !== -1 || creditIdx !== -1)) {
      // Separate Debit/Credit columns state their meaning explicitly, so no
      // sign guessing is needed: a debit is spending, a credit offsets it.
      const debit = debitIdx !== -1 ? parseStatementAmount(fields[debitIdx] ?? '') : null;
      const credit = creditIdx !== -1 ? parseStatementAmount(fields[creditIdx] ?? '') : null;
      if (debit !== null && debit !== 0) {
        amount = Math.abs(debit);
        fromDebitCredit = true;
      } else if (credit !== null && credit !== 0) {
        amount = -Math.abs(credit);
        fromDebitCredit = true;
      }
    }
    // Last resort, and only for rows that otherwise have nothing: the amount
    // may be sitting at the end of the description because the PDF's columns
    // didn't separate cleanly. Runs after the real columns so a statement with
    // a proper amount column is completely unaffected.
    if (amount === null) {
      const salvaged = extractTrailingAmount(note);
      if (salvaged) {
        amount = salvaged.amount;
        // Keep the description without the number, so the imported note reads
        // "STARBUCKS STORE 12345 HUNTSVILLE AL" and not "… AL 6.75".
        if (salvaged.note) note = salvaged.note;
      }
    }
    return { line: header.line + 2 + i, raw: fields.join(','), date, note, amount, fromDebitCredit, category };
  });

  const signCandidates = drafts
    .filter((d) => d.date && d.amount !== null && !d.fromDebitCredit && !isSectionLabel(d.note))
    .map((d) => d.amount as number);
  const signFlipped = detectSignConvention(signCandidates);

  const rows: ParsedStatementRow[] = [];
  const skipped: SkippedRow[] = [];
  let usedInferredYear = false;

  for (const d of drafts) {
    if (isSectionLabel(d.note)) {
      skipped.push({ line: d.line, raw: d.raw, reason: 'section-total' });
      continue;
    }
    if (!d.date) {
      skipped.push({ line: d.line, raw: d.raw, reason: 'no-date' });
      continue;
    }
    if (d.amount === null) {
      skipped.push({ line: d.line, raw: d.raw, reason: 'no-amount' });
      continue;
    }
    if (d.amount === 0) {
      skipped.push({ line: d.line, raw: d.raw, reason: 'zero-amount' });
      continue;
    }
    const amount = signFlipped && !d.fromDebitCredit ? -d.amount : d.amount;
    rows.push({
      date: d.date,
      // A blank description is not a reason to lose a real charge.
      note: d.note || 'Imported transaction',
      amount,
      // Only set when the file HAS one, so `category` stays absent (and
      // fixture expectations stay byte-identical) for files without.
      ...(d.category ? { category: d.category } : {}),
    });
  }

  const anyYearless = body.some((f) => {
    const parts = splitDate(f[dateIdx] ?? '');
    return parts !== null && parts.year === null;
  });
  usedInferredYear = anyYearless && opts.statementYear == null && !opts.statementEndDate;

  const anchorYear = opts.statementEndDate ? parseInt(opts.statementEndDate.slice(0, 4), 10) : null;

  return {
    rows,
    skipped,
    signFlipped,
    dateOrder,
    inferredYear: anyYearless
      ? (anchorYear ?? opts.statementYear ?? (usedInferredYear ? today.getFullYear() : null))
      : null,
    headerLine: header.line + 1,
  };
}
