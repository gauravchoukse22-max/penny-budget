// Length-first password strength, NIST SP 800-63B style: length is the dominant
// signal, character-class variety is a minor bonus, and obvious weak patterns
// are penalized. Server-side leaked-password (HaveIBeenPwned) rejection is the
// real backstop; this is just honest as-you-type feedback.

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrength = {
  /** 0 (empty) – 4 (strong). Drives the meter's fill + color. */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  /** Whether the minimum length requirement is satisfied. */
  meetsMinimum: boolean;
};

const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty', 'qwertyui',
  '11111111', '00000000', 'iloveyou', 'letmein', 'welcome', 'admin123',
]);

export function evaluatePassword(password: string): PasswordStrength {
  const len = password.length;
  const meetsMinimum = len >= MIN_PASSWORD_LENGTH;

  if (len === 0) return { score: 0, label: 'Too short', meetsMinimum: false };
  if (!meetsMinimum) return { score: 1, label: 'Too short', meetsMinimum: false };

  if (COMMON.has(password.toLowerCase())) {
    return { score: 1, label: 'Weak', meetsMinimum: true };
  }

  let points = 0;
  // Length is the biggest lever.
  if (len >= 8) points += 1;
  if (len >= 12) points += 1;
  if (len >= 16) points += 1;
  // Small variety bonus (not a hard requirement).
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3) points += 1;

  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;
  const label = (['Weak', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label, meetsMinimum: true };
}

/** Loose RFC-5322-ish check — enough to gate the submit button, not to validate deliverability. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
