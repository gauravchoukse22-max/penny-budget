// Content-driven statement reading: turns the printed LINES of a statement into
// transactions without needing a column header at all.
//
// Why this exists — the header-anchored reader in lib/pdf-layout.ts was the
// original design, and it fails on real statements for a structural reason:
// it finds ONE header in the document and then reads every page's rows through
// that header's column positions. A real Chase statement has several tables
// (the payment-information box, the account summary, the legal/APR grid), and
// the first one that happens to contain the words "date", "payment" and "name"
// wins. Once that happened, "date" was column 1 of the WRONG table, so every
// one of the 162 real transaction rows read its description as its date and was
// dropped with "no date". Zero imported, twice.
//
// The observation that makes a universal reader possible: every issuer prints a
// transaction as ONE visual line that begins with a date and ends with an
// amount. That is true of Chase, Amex, Citi, Capital One, Discover, Bank of
// America, Wells Fargo, USAA, Synchrony and Apple Card, and it stays true when
// the columns are at different x positions, when there is no header on the page,
// and when the table is split across pages. So: recognise the SHAPE of a
// transaction line, and ignore everything that isn't one.
//
// Nothing here is issuer-specific. There is no list of banks to keep up to date.

export type LineTransaction = {
  date: string; // raw date text, still to be normalised by statement-parse
  note: string;
  amount: string; // raw amount text, still to be parsed by statement-parse
};

/** Money at the END of a line: "$1,234.56", "-12.34", "(12.34)", "445.94-", "12.34 CR". */
// The closing paren is captured INSIDE the amount group: "(825.00" alone is not
// parseable, and Citi writes its credits that way.
const TRAILING_MONEY =
  /(?:^|\s)([-+(]?\s*[$£€¥]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\s*\)?)\s*(-|CR|DR)?$/i;

/**
 * A date at the START of a line. Statements print the transaction date first;
 * some (Discover, Capital One) print transaction AND posting date, in which
 * case the first is the transaction date and the second is dropped.
 *
 * Deliberately anchored to the start: a date in the middle of a sentence is
 * prose ("payment must reach us by 08/05"), not a transaction.
 */
const MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const NUMERIC_DATE = '\\d{1,2}[/.\\-]\\d{1,2}(?:[/.\\-]\\d{2,4})?';
const ISO_DATE = '\\d{4}-\\d{1,2}-\\d{1,2}';
const WORD_DATE_MD = `${MONTH_WORD}\\s+\\d{1,2}(?:,?\\s*\\d{4})?`;
const WORD_DATE_DM = `\\d{1,2}\\s+${MONTH_WORD}(?:,?\\s*\\d{4})?`;

const LEADING_DATE = new RegExp(
  `^\\s*(${ISO_DATE}|${NUMERIC_DATE}|${WORD_DATE_MD}|${WORD_DATE_DM})` +
    // An optional SECOND date (posting date) that we discard.
    `(?:\\s+(?:${ISO_DATE}|${NUMERIC_DATE}|${WORD_DATE_MD}|${WORD_DATE_DM}))?` +
    `\\s+(.*)$`,
  'i'
);

/**
 * Reference / authorisation ids that issuers print in their own column
 * ("8521333J400XS6H17", "55432110098812340"). They carry no meaning for the
 * user and would otherwise be glued onto the front of every merchant name.
 *
 * The guard against eating a real merchant word is deliberately narrow: 12+
 * characters AND at least 6 digits. "AMZN.COM/BILL" and "HUNTSVILLE" have no
 * digits; "SHELL OIL 574123" is two short tokens, not one long one.
 */
function isReferenceToken(token: string): boolean {
  if (token.length < 12) return false;
  if (!/^[A-Za-z0-9*#/-]+$/.test(token)) return false;
  const digits = (token.match(/\d/g) ?? []).length;
  return digits >= 6;
}

/**
 * Summary and disclosure lines that happen to start with a date and end with an
 * amount — the only false positives the shape rule admits. Matched against the
 * description, case-insensitively, as a substring.
 */
const NON_TRANSACTION_PHRASES = [
  'previous balance',
  'new balance',
  'statement balance',
  'balance subject to interest',
  'credit limit',
  'available credit',
  'cash advance limit',
  'minimum payment due',
  'payment due date',
  'statement closing date',
  'opening/closing date',
  'annual percentage rate',
  'days in billing cycle',
  'total fees charged',
  'total interest charged',
  'year-to-date',
  'ytd total',
  'account number',
  'page ',
];

function looksLikeSummaryLine(note: string): boolean {
  const n = note.toLowerCase();
  return NON_TRANSACTION_PHRASES.some((p) => n.includes(p));
}

function stripReferenceTokens(note: string): string {
  return note
    .split(/\s+/)
    .filter((t) => !isReferenceToken(t))
    .join(' ')
    .trim();
}

/**
 * Section banners set the sign for the rows beneath them. Most issuers print an
 * explicit minus on credits, but not all — Discover and Capital One list
 * payments under a "Payments and Credits" banner as bare positives, and
 * importing those as spending would inflate every month they appear in.
 */
type SectionSign = 'credit' | 'debit' | null;

export function sectionSignFor(text: string): SectionSign {
  const t = text.trim().toLowerCase().replace(/[:.]+$/, '');
  if (!t || t.length > 60) return null;
  if (/^(payments?|credits?|payments? and (other )?credits?|payments?, credits? and adjustments|refunds?|returns?|other credits?)\b/.test(t)) {
    return 'credit';
  }
  if (/^(purchases?|charges?|purchases? and adjustments|purchases? and other debits|transactions?|fees? charged|interest charged|cash advances?)\b/.test(t)) {
    return 'debit';
  }
  return null;
}

/** True when the amount text already states its own sign, so context must not override it. */
function hasExplicitSign(raw: string): boolean {
  return /[-+(]/.test(raw) || /\b(cr|dr)\b/i.test(raw);
}

/**
 * Reads one printed line. Returns null when the line isn't a transaction —
 * which is the normal case for most of a statement, and is not an error.
 */
export function readStatementLine(line: string): LineTransaction | null {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const dateMatch = text.match(LEADING_DATE);
  if (!dateMatch) return null;
  const date = dateMatch[1].trim();
  const rest = dateMatch[2].trim();
  if (!rest) return null;

  const moneyMatch = rest.match(TRAILING_MONEY);
  if (!moneyMatch) return null;

  const amount = `${moneyMatch[1]}${moneyMatch[2] ?? ''}`.replace(/\s+/g, '');
  const note = stripReferenceTokens(rest.slice(0, moneyMatch.index ?? 0).trim());
  if (!note) return null;
  if (looksLikeSummaryLine(note)) return null;

  return { date, note, amount };
}

/**
 * Some statements — checking and some card accounts — print a running BALANCE
 * after the amount, so a line ends with two money values and naively taking the
 * last one imports the balance as the charge. Detected across the whole
 * document rather than per line: a balance column is present on nearly every
 * transaction line or on none of them.
 */
export function hasTrailingBalanceColumn(lines: string[]): boolean {
  let twoMoney = 0;
  let oneMoney = 0;
  for (const line of lines) {
    const text = line.replace(/\s+/g, ' ').trim();
    const m = text.match(LEADING_DATE);
    if (!m) continue;
    const rest = m[2];
    if (!TRAILING_MONEY.test(rest)) continue;
    const withoutLast = rest.replace(TRAILING_MONEY, '').trim();
    if (TRAILING_MONEY.test(withoutLast)) twoMoney++;
    else oneMoney++;
  }
  // Require a clear majority AND more than a couple of examples, so one odd
  // line ("06/12 REFUND 20.00 20.00") can't switch the whole document.
  return twoMoney >= 3 && twoMoney > oneMoney * 2;
}

/**
 * The whole document, as printed lines, in reading order. Returns the same
 * `string[][]` shape a CSV gives — a synthetic header plus one record per
 * transaction — so lib/statement-parse.ts keeps doing all the interpretation
 * (date order, year inference, sign convention, section subtotals) exactly as
 * it does for a CSV export. One interpretation path, two input formats.
 */
export function linesToRecords(lines: string[]): string[][] {
  const dropBalance = hasTrailingBalanceColumn(lines);
  type Entry = { date: string; note: string; amount: string; section: SectionSign };
  const entries: Entry[] = [];
  let section: SectionSign = null;

  for (const raw of lines) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const banner = sectionSignFor(text);
    // A banner sets context whether it stands alone ("PAYMENTS AND OTHER
    // CREDITS") or carries its own subtotal ("Payments  -$489.44"); either way
    // it is not itself a transaction, because it has no leading date.
    if (banner) section = banner;

    let candidate = text;
    if (dropBalance) {
      const m = text.match(LEADING_DATE);
      if (m && TRAILING_MONEY.test(m[2])) {
        const withoutBalance = m[2].replace(TRAILING_MONEY, '').trim();
        if (TRAILING_MONEY.test(withoutBalance)) {
          candidate = `${m[1]} ${withoutBalance}`;
        }
      }
    }

    const txn = readStatementLine(candidate);
    if (txn) {
      entries.push({ ...txn, section });
      continue;
    }

    // Wrapped description: a line with neither a date nor an amount, directly
    // under a transaction, is the rest of that merchant's name.
    if (entries.length > 0 && !LEADING_DATE.test(text) && !TRAILING_MONEY.test(text) && !banner && !looksLikeSummaryLine(text)) {
      const prev = entries[entries.length - 1];
      prev.note = `${prev.note} ${stripReferenceTokens(text)}`.trim();
    }
  }

  // Section banners are a LAST RESORT for the sign, not a first one. When the
  // statement marks any credit with its own minus (Chase, Amex, Synchrony and
  // most others do), the issuer has already said which rows are credits, and
  // trusting a banner on top of that is what turns a whole statement negative:
  // a "Payments" heading with no matching "Purchases" heading after it would
  // silently claim every later purchase as a credit. Only when NOT ONE amount
  // in the document carries a sign — Discover and Capital One print bare
  // numbers under "Payments and Credits" — does the banner decide.
  const anyExplicitSign = entries.some((e) => hasExplicitSign(e.amount));

  const records: string[][] = [['Date', 'Description', 'Amount']];
  for (const e of entries) {
    const amount =
      !anyExplicitSign && e.section === 'credit' ? `-${e.amount.replace(/^[$£€¥]/, '')}` : e.amount;
    records.push([e.date, e.note, amount]);
  }
  return records;
}
