// Strict parsing for user-typed money amounts.
//
// Every money field in the app used to run raw parseFloat() on whatever was
// typed, which has two failure modes that silently corrupt real budgets:
//   * parseFloat stops at the first character it doesn't like — "1,000"
//     became $1.00, a 1000× loss with no error.
//   * It happily accepts values that make no sense in context: negative
//     salaries, "1e9", Infinity-scale numbers.
// This module is the single replacement: it either returns a sane number or
// null, never a partial parse. Callers decide what null means for their field
// (disable Save, keep previous value, show an error).

/** Upper bound for any single money value the app will accept. */
export const MAX_MONEY_VALUE = 999_999_999.99;

export type ParseMoneyOptions = {
  /** Permit negative amounts (e.g. app-format CSV refunds). Default false. */
  allowNegative?: boolean;
};

/**
 * Parses user-typed money text. Tolerates currency symbols, thousands commas,
 * spaces, and parentheses-negative; rejects everything else ("abc", "1e9",
 * "1.2.3", empty) by returning null — never a partial value.
 */
export function parseMoneyInput(raw: string, opts: ParseMoneyOptions = {}): number | null {
  let s = (raw ?? '').trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$£€¥₹\s]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/,/g, '');

  // Plain decimal only — no exponents, no second dot, no stray characters.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;

  const value = negative ? -n : n;
  if (!opts.allowNegative && value < 0) return null;
  if (Math.abs(value) > MAX_MONEY_VALUE) return null;
  // Money is cents — round away float dust ("0.1"+"0.2" style artifacts).
  return Math.round(value * 100) / 100;
}

// ── Arithmetic expressions ──────────────────────────────────────────────────
//
// "1200+300" is how people actually adjust a balance they already know, so the
// money fields a HUMAN types accept a chain of + / − terms.
//
// Deliberately NOT eval() or new Function(): this runs on arbitrary user text,
// and a real evaluator would happily accept — and execute — far more than
// arithmetic. Scanning the string into signed numeric terms can only ever
// produce a number, so there is nothing to escape from.
//
// This is a SEPARATE entry point rather than a change to parseMoneyInput,
// because that one also parses machine data (lib/csv.ts): a statement column
// reading "100-200" must stay invalid there, not quietly become −100.

const TERM = String.raw`(?:\d+\.?\d*|\.\d+)`;
/** The whole cleaned string must be a chain of signed terms — never a partial parse. */
const EXPRESSION_RE = new RegExp(`^[+-]?${TERM}(?:[+-]${TERM})*$`);
const TERM_RE = new RegExp(`[+-]?${TERM}`, 'g');
/** An operator only means arithmetic when it FOLLOWS a digit. A leading "−" is
 * a plain negative amount and stays parseMoneyInput's business. */
const HAS_OPERATOR_RE = /[\d.]\s*[+-]/;

/**
 * Parses user-typed money text, additionally accepting simple `+`/`−` chains
 * ("1200+300", "5,000 - 250", "$40+12.50"). Anything without an operator falls
 * straight through to parseMoneyInput, so every existing rule — currency
 * symbols, thousands commas, parentheses-negative, no exponents, the
 * MAX_MONEY_VALUE ceiling — still applies unchanged.
 */
export function parseMoneyExpression(raw: string, opts: ParseMoneyOptions = {}): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (!HAS_OPERATOR_RE.test(s)) return parseMoneyInput(s, opts);

  const cleaned = s.replace(/[$£€¥₹\s,]/g, '');
  if (!EXPRESSION_RE.test(cleaned)) return null;

  // Accumulate in whole cents so a long chain can't drift a fraction of a cent.
  let cents = 0;
  for (const term of cleaned.match(TERM_RE) ?? []) {
    const sign = term.startsWith('-') ? -1 : 1;
    const n = parseFloat(term.replace(/^[+-]/, ''));
    if (!Number.isFinite(n)) return null;
    cents += sign * Math.round(n * 100);
  }

  const value = cents / 100;
  if (!opts.allowNegative && value < 0) return null;
  if (Math.abs(value) > MAX_MONEY_VALUE) return null;
  return value;
}
