// Maps raw Supabase / network errors to friendly, actionable copy — and to a
// stable `code` the UI can branch on (e.g. route "email not confirmed" to the
// resend screen). Keeping this in one place is what lets the auth screens show
// specific guidance instead of dumping a raw error string at the user.

export type AuthErrorCode =
  | 'offline'
  | 'rate_limited'
  | 'email_not_confirmed'
  | 'invalid_credentials'
  | 'user_exists'
  | 'weak_password'
  | 'same_password'
  | 'generic';

export type MappedAuthError = { code: AuthErrorCode; message: string };

/** True when the failure is a lost/timed-out network request rather than a
 * server-side rejection. supabase-js surfaces these as a bare fetch TypeError. */
function isNetworkError(error: any): boolean {
  const msg = String(error?.message ?? error ?? '').toLowerCase();
  return (
    error?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

export function mapAuthError(error: any): MappedAuthError {
  if (!error) return { code: 'generic', message: 'Something went wrong. Please try again.' };

  if (isNetworkError(error)) {
    return { code: 'offline', message: "You're offline — check your connection and try again." };
  }

  const status: number | undefined = error?.status;
  const raw = String(error?.message ?? '').toLowerCase();

  if (status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
    return { code: 'rate_limited', message: 'Too many attempts — please try again in a minute.' };
  }
  if (raw.includes('email not confirmed') || raw.includes('not confirmed')) {
    return {
      code: 'email_not_confirmed',
      message: 'Please confirm your email first — we can resend the link.',
    };
  }
  if (raw.includes('invalid login credentials') || raw.includes('invalid credentials')) {
    return { code: 'invalid_credentials', message: 'Incorrect email or password.' };
  }
  if (raw.includes('already registered') || raw.includes('already been registered') || raw.includes('user already')) {
    return { code: 'user_exists', message: 'An account with this email already exists. Try signing in.' };
  }
  if (raw.includes('pwned') || raw.includes('leaked') || raw.includes('data breach') || raw.includes('compromised')) {
    return {
      code: 'weak_password',
      message: 'This password has appeared in a data breach. Please choose a different one.',
    };
  }
  if (raw.includes('should be at least') || raw.includes('password should') || raw.includes('weak')) {
    return { code: 'weak_password', message: 'Please choose a stronger password (at least 8 characters).' };
  }
  if (raw.includes('different from the old') || raw.includes('same as the old') || raw.includes('should be different')) {
    return { code: 'same_password', message: 'Your new password must be different from your current one.' };
  }

  return { code: 'generic', message: error?.message ?? 'Something went wrong. Please try again.' };
}
