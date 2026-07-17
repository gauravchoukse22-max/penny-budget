# Supabase backend — deploy steps

These are the **server-side pieces** the app expects. The app runs fine without
them (accounts just won't fully work), so deploy at your own pace. You need the
[Supabase CLI](https://supabase.com/docs/guides/cli) linked to the project:

```bash
supabase link --project-ref <your-project-ref>
```

## 1. Apple token revocation (Guideline 5.1.1(v)) — required before the next iOS submission

Apple requires that deleting an account also **revokes** the app's Sign in with
Apple access. The single-use code from sign-in is long expired by deletion time,
so we exchange it for a refresh token at sign-in, store it, and revoke it at
delete. Three parts:

**a) Create the token table**
```bash
supabase db push        # applies migrations/20260717000000_apple_tokens.sql
```

**b) Set the Apple secrets** (from your Apple Developer account → Certificates,
Identifiers & Profiles → Keys; create a "Sign in with Apple" key if you don't
have one):
```bash
supabase secrets set APPLE_TEAM_ID=XXXXXXXXXX
supabase secrets set APPLE_KEY_ID=YYYYYYYYYY
supabase secrets set APPLE_CLIENT_ID=com.gary.pennybudget
supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — you don't set those.

**c) Deploy the functions**
```bash
supabase functions deploy apple-store-token
supabase functions deploy apple-revoke
```

That's it. The app calls `apple-store-token` after each Apple sign-in and
`apple-revoke` right before deleting the account. Both are best-effort on the
client, so a missing deploy never strands a user — but revocation only actually
happens once these are live.

## 2. Custom SMTP (required for password reset emails to be reliable)

Supabase's built-in mailer is rate-limited to ~2 emails/hour — fine for testing,
not for real password resets. In the dashboard: **Authentication → Emails → SMTP
Settings**, plug in a provider (Resend, Postmark, or SES). Then under
**Authentication → Emails → ... → Advanced**, disable link tracking so the
single-use reset/confirm links aren't consumed by a scanner before the user
clicks them.

## 2b. Email templates must include the 6-digit code — REQUIRED for in-app code entry

The app's "Confirm your email" and "Forgot password" screens ask the user to
type a **6-digit code** (a more reliable cross-platform path than deep links).
Supabase only emails that code if the template contains the `{{ .Token }}`
variable — the default templates are link-only, so **the code path silently
won't work until you edit them.** In **Authentication → Emails → Templates**,
add the code to both the **Confirm signup** and **Reset password** templates,
e.g.:

```
Your Penny Budget code is: {{ .Token }}

Or tap this link: {{ .ConfirmationURL }}
```

Keeping the link too means the deep-link fallback still works. Also consider
tightening **OTP / email link expiry** (Authentication → Providers → Email) from
the 24h default to ~30 minutes, and confirm **refresh-token rotation** is on
(Authentication → Sessions) — usually the default.

## 3. Leaked-password protection (recommended)

**Authentication → Policies / Password settings** → enable "Check against
HaveIBeenPwned" and set minimum length to 8. (This toggle is on the Pro plan.)

## 4. Redirect URLs

**Authentication → URL Configuration → Redirect URLs**, add:
- `pennybudget://account/update-password`
- `pennybudget://account/index`
- your web app origin (e.g. `https://gauravchoukse22-max.github.io/penny-budget/app`)

## Already in place (from earlier setup)
- `delete_user()` SECURITY DEFINER RPC (in-app account deletion)
- `backups` Storage bucket with per-user RLS
- Apple provider enabled with the app's bundle id
