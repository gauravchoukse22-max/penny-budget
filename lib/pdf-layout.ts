// Pure geometry: turns positioned PDF text runs into the row/column matrix
// that lib/statement-parse.ts already knows how to interpret. No pdfjs, no
// expo, no I/O — fixture-tested alongside the CSV parser in
// scripts/test-statement-parse.mjs.
//
// A PDF has no delimiters — just text runs at coordinates. Reconstruction:
//   1. Cluster runs into visual ROWS by y (PDF y-origin is bottom-left, so
//      bigger y = higher on the page; rows come out top-to-bottom).
//   2. Within a row, merge runs that nearly touch horizontally into one CELL
//      (pdf.js often splits a single printed word into several runs).
//   3. Find the HEADER row (date + description + amount keywords) and use its
//      cells' x-spans as column anchors; every other row's cells snap to the
//      column they overlap most. Right-aligned amount columns are why overlap
//      is measured against spans, not label start positions.
// The result is a string[][] with stable column indices, which is exactly the
// shape a CSV gives — so both formats share one interpretation path.

export type PdfTextRun = {
  str: string;
  x: number;
  y: number;
  width: number;
};

export type PdfCell = { text: string; x0: number; x1: number };
export type PdfRow = { y: number; cells: PdfCell[] };

/** Rows whose y differ by less than this are the same printed line. */
const ROW_Y_TOLERANCE = 4;
/** Runs closer than this within a row belong to the same cell. */
const CELL_GAP = 8;

export function clusterRowsFromRuns(runs: PdfTextRun[]): PdfRow[] {
  const meaningful = runs.filter((r) => r.str.trim().length > 0);
  // Sort top of page first (descending y), then left-to-right.
  const sorted = [...meaningful].sort((a, b) => (Math.abs(b.y - a.y) < ROW_Y_TOLERANCE ? a.x - b.x : b.y - a.y));

  const rows: { y: number; runs: PdfTextRun[] }[] = [];
  for (const run of sorted) {
    const row = rows.find((r) => Math.abs(r.y - run.y) < ROW_Y_TOLERANCE);
    if (row) row.runs.push(run);
    else rows.push({ y: run.y, runs: [run] });
  }

  return rows.map((row) => {
    const cells: PdfCell[] = [];
    for (const run of row.runs.sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && run.x - last.x1 < CELL_GAP) {
        // Continuation of the same printed text — join, preserving one space
        // when the runs don't butt up against each other.
        const joiner = run.x - last.x1 > 1 ? ' ' : '';
        last.text += joiner + run.str;
        last.x1 = run.x + run.width;
      } else {
        cells.push({ text: run.str, x0: run.x, x1: run.x + run.width });
      }
    }
    return { y: row.y, cells: cells.map((c) => ({ ...c, text: c.text.trim() })) };
  });
}

/**
 * Heuristic for section headings that print with neither a date nor an amount
 * ("PAYMENTS AND OTHER CREDITS"): short, all-caps or title-case labels. Kept
 * intentionally loose — a misjudged heading merely becomes its own record and
 * is then skipped by the interpreter for having no date, never imported.
 */
function isSectionHeading(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  return /^(payments|purchases|fees|interest|credits|other credits|adjustments)\b/i.test(t);
}

const HEADER_DATE = ['date'];
const HEADER_DESC = ['description', 'merchant', 'payee', 'transaction detail', 'name'];
const HEADER_AMOUNT = ['amount', 'debit', 'credit', 'charges', 'payment'];

function isHeaderRow(row: PdfRow): boolean {
  const texts = row.cells.map((c) => c.text.toLowerCase());
  const hasDate = texts.some((t) => HEADER_DATE.some((k) => t.includes(k)));
  const hasDesc = texts.some((t) => HEADER_DESC.some((k) => t.includes(k)));
  const hasAmount = texts.some((t) => HEADER_AMOUNT.some((k) => t.includes(k)));
  return hasDate && hasDesc && hasAmount;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Merges two printed lines of one logical header ("Date of" stacked above
 * "Transaction", as Chase prints it). Cells that overlap horizontally join
 * their text; the rest are kept side by side in x order.
 */
function mergeHeaderRows(top: PdfRow, bottom: PdfRow): PdfRow {
  const cells: PdfCell[] = top.cells.map((c) => ({ ...c }));
  for (const cell of bottom.cells) {
    const target = cells.find((c) => overlap(c.x0, c.x1, cell.x0, cell.x1) > 0);
    if (target) {
      target.text = `${target.text} ${cell.text}`.trim();
      target.x0 = Math.min(target.x0, cell.x0);
      target.x1 = Math.max(target.x1, cell.x1);
    } else {
      cells.push({ ...cell });
    }
  }
  return { y: bottom.y, cells: cells.sort((a, b) => a.x0 - b.x0) };
}

type HeaderMatch = { header: PdfRow; nextRowIndex: number };

function findHeader(rows: PdfRow[]): HeaderMatch | null {
  for (let i = 0; i < rows.length; i++) {
    if (isHeaderRow(rows[i])) return { header: rows[i], nextRowIndex: i + 1 };
    // Two-line header: try this row merged with the one printed just above it.
    if (i > 0) {
      const merged = mergeHeaderRows(rows[i - 1], rows[i]);
      if (isHeaderRow(merged)) return { header: merged, nextRowIndex: i + 1 };
    }
  }
  return null;
}

/**
 * Converts one page's rows into a CSV-like matrix using the page's own header
 * as the column template. Returns null when no header row is found (a cover
 * page, a rewards summary, etc.) — the caller just moves on to the next page.
 *
 * Multi-line descriptions: a row with NO cell under the date column and NO
 * cell under the amount column is a continuation of the previous row's
 * description (statements wrap long merchant names); its text is appended
 * there instead of becoming a bogus record.
 */
export function pageToRecords(rows: PdfRow[]): string[][] | null {
  const match = findHeader(rows);
  if (!match) return null;

  const { header } = match;
  // Column spans from the header cells, widened to cover the gaps between them
  // so left/right-aligned data still lands in the right column: each column
  // owns the space from the midpoint after the previous header cell to the
  // midpoint before the next.
  const anchors = header.cells.map((c, i) => {
    const prev = header.cells[i - 1];
    const next = header.cells[i + 1];
    const left = prev ? (prev.x1 + c.x0) / 2 : -Infinity;
    const right = next ? (c.x1 + next.x0) / 2 : Infinity;
    return { left, right, x0: c.x0, x1: c.x1 };
  });

  const assign = (cell: PdfCell): number => {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const score = overlap(cell.x0, cell.x1, a.left, a.right);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };

  const headerTexts = header.cells.map((c) => c.text);
  const dateCol = headerTexts.findIndex((t) => HEADER_DATE.some((k) => t.toLowerCase().includes(k)));
  const amountCol = headerTexts.findIndex((t) => HEADER_AMOUNT.some((k) => t.toLowerCase().includes(k)));
  const descCol = headerTexts.findIndex((t) => HEADER_DESC.some((k) => t.toLowerCase().includes(k)));

  const records: string[][] = [headerTexts];
  for (const row of rows.slice(match.nextRowIndex)) {
    if (row.cells.length === 0) continue;
    const record = new Array<string>(header.cells.length).fill('');
    for (const cell of row.cells) {
      const col = assign(cell);
      if (col === -1) continue;
      record[col] = record[col] ? `${record[col]} ${cell.text}` : cell.text;
    }

    const isContinuation =
      dateCol !== -1 &&
      amountCol !== -1 &&
      descCol !== -1 &&
      !record[dateCol] &&
      !record[amountCol] &&
      record[descCol] &&
      // Section banners ("PAYMENTS AND OTHER CREDITS") also print with no date
      // and no amount — those are headings, not wrapped description text.
      !isSectionHeading(record[descCol]) &&
      records.length > 1;
    if (isContinuation) {
      const prev = records[records.length - 1];
      prev[descCol] = `${prev[descCol]} ${record[descCol]}`.trim();
      continue;
    }

    records.push(record);
  }
  return records;
}

/**
 * Full document → one matrix. Pages without a recognizable transaction table
 * are skipped; pages with one are concatenated under the FIRST page's header
 * (statements repeat the same table header on every page).
 */
export function documentToRecords(pages: PdfTextRun[][]): string[][] {
  const all: string[][] = [];
  for (const runs of pages) {
    const rows = clusterRowsFromRuns(runs);
    const records = pageToRecords(rows);
    if (!records) continue;
    if (all.length === 0) {
      all.push(...records);
    } else {
      // Drop the repeated header on subsequent pages.
      all.push(...records.slice(1));
    }
  }
  return all;
}
