// Turns a card-statement description into a keyword stable enough to hang a
// category rule on, so that correcting "SQ *BLUE BOTTLE COFFEE #0412 08/01"
// once teaches the next import.
//
// The hard constraint is substring-safety. Rules are matched with
// `note.toLowerCase().includes(keyword)` (features/smart-categorizer.ts), so a
// token that REWRITES the description — collapsing whitespace, dropping an
// apostrophe, deleting a store number from the middle and rejoining the halves
// — produces a keyword that can never match anything again. The rule would look
// saved and do nothing. So everything here is a CUT, never an edit: lowercase
// the note, drop a leading processor prefix, stop at the first word that is
// statement noise, and slice. The result is always a literal substring of
// `note.toLowerCase()`.
//
// It errs SPECIFIC rather than general on purpose. "starbucks seattle" merely
// fails to generalise to the airport branch; "payment" silently miscategorises
// every card payment the user ever imports. An unhelpful rule is a nuisance, a
// wrong one is a bug the user has to hunt down months later.
//
// Fixtures: scripts/test-merchant-token.mjs.

/** Words kept before giving up — enough for "trader joe s market", not a whole
 * address line. */
const MAX_WORDS = 4;

// Prefixes issuers and processors bolt onto the front of the real merchant
// name. Stripped from the FRONT only, which keeps the remainder a suffix of the
// lowercased note and therefore still a substring of it.
const LEADING_NOISE: RegExp[] = [
  /^purchase authorized on \d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/,
  /^(pos\s+)?debit\s+card\s+purchase\s+/,
  /^pos\s+(debit|credit|purchase|withdrawal)\s+/,
  /^pos\s+/,
  /^(sq|tst|paypal|pp|py|sp|dd|ec)\s*\*\s*/,
  /^recurring\s+(payment|debit|charge|transfer)\s+/,
  /^(ach|eft)\s+(debit|credit|payment|withdrawal)\s+/,
  /^(visa|mastercard|amex)\s+(purchase|payment)\s+/,
  /^check\s*card\s+\d{3,4}\s+/,
  /^card\s+\d{3,4}\s+/,
  /^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/, // leading posting date
  /^\d{4}-\d{2}-\d{2}\s+/,
];

/** Bookkeeping words that introduce a reference number. Never a merchant. */
const REF_WORDS = new Set([
  'ref', 'ref#', 'id', 'id#', 'trace', 'auth', 'conf', 'confirmation',
  'txn', 'trans', 'seq', 'inv', 'invoice', 'no.', 'trn',
]);

const MONTHS = new Set([
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

/**
 * Tokens too generic to be a rule. A rule on any of these matches most of a
 * statement, so learning one would be actively destructive — better to learn
 * nothing from that row.
 */
const GENERIC = new Set([
  'payment', 'purchase', 'transfer', 'withdrawal', 'deposit', 'fee', 'fees',
  'interest', 'refund', 'credit', 'debit', 'atm', 'cash', 'check', 'cheque',
  'online payment', 'payment thank you', 'mobile payment', 'autopay',
  'auto pay', 'direct debit', 'bill payment', 'pending', 'misc',
  'miscellaneous', 'other', 'transaction', 'adjustment', 'balance',
  'thank you', 'payment received', 'card payment', 'electronic payment',
]);

/**
 * Is this word statement noise rather than part of the merchant name?
 * `position` is how many name words have already been kept, which is what makes
 * a bare month name noise in "amazon aug 04" but not in "august moon cafe".
 */
function isNoiseWord(word: string, position: number): boolean {
  if (word.startsWith('#')) return true; // store number
  if (REF_WORDS.has(word)) return true;
  if (position > 0 && MONTHS.has(word)) return true;

  const digits = (word.match(/\d/g) ?? []).length;
  if (digits === 0) return false;
  // Pure numbers, dates, amounts — nothing but digits and separators.
  if (/^[\d.,\-/#:]+$/.test(word)) return true;
  // Reference ids and masked card numbers. Three digits is the line: it clears
  // "7-eleven" and "76" while catching "2h4dg5" and "xxxxxx1234".
  if (digits >= 3) return true;
  // "st123", "no4" — a short letter stub glued to a number.
  if (/^[a-z]{1,3}\d+$/.test(word)) return true;
  return false;
}

/**
 * The rule keyword for a statement description, or null when the description
 * has nothing specific enough to learn from.
 *
 * Guaranteed: a non-null result is a substring of `note.toLowerCase()`.
 */
export function merchantToken(note: string): string | null {
  let s = (note ?? '').toLowerCase().trim();
  if (!s) return null;

  // Prefixes stack ("POS DEBIT SQ *MERCHANT"), so keep peeling until nothing
  // matches. Bounded rather than `while (true)` — a regex that could match the
  // empty string would otherwise spin forever.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const re of LEADING_NOISE) {
      const next = s.replace(re, '');
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  s = s.replace(/^[\s*#\-.,/]+/, '');
  if (!s) return null;

  // Find where the name stops. `*` separates words as well as whitespace
  // because processors use it as a delimiter ("amzn mktp us*2h4dg5"), but the
  // slice below keeps every original character, separators included, so the
  // token stays a literal substring.
  let cut = s.length;
  let kept = 0;
  const wordRe = /[^\s*]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(s)) !== null) {
    if (kept >= MAX_WORDS || isNoiseWord(m[0], kept)) {
      cut = m.index;
      break;
    }
    kept++;
  }

  const token = s.slice(0, cut).replace(/[\s*#\-.,/&:]+$/, '').trim();

  if (token.length < 3) return null;
  if (!/[a-z]/.test(token)) return null;
  if (GENERIC.has(token)) return null;
  // A token that merely STARTS with a bookkeeping word is the same trap one
  // word longer ("payment thank you visa", "interest charged").
  if (/^(payment|autopay|auto pay|online payment|thank you|interest|finance charge)\b/.test(token)) {
    return null;
  }

  return token;
}

/**
 * The id for the rule that owns `token`.
 *
 * Derived, not random: both members of a household import the same statement
 * and confirm the same merchant, and two independently generated uuids would
 * become two rows for one keyword the moment they sync (AGENTS.md rule 2 — the
 * same reason recurring postings are `rec-<ruleId>-<postDate>`).
 */
export function merchantRuleId(token: string): string {
  const slug = token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `rule-${slug}`;
}
