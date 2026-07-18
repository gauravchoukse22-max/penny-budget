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
