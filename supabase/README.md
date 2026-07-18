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

## 5. Family sharing (household co-editing) — required before the feature works

The Family Sharing UI ships in the app but does nothing until the backend tables
exist. Apply the migration:

```bash
supabase db push        # applies migrations/20260717010000_household_sharing.sql
```

This creates `households`, `household_members`, `household_invites`, and
`household_records` (the shared-budget mirror), all with **RLS scoped to
household membership** plus SECURITY DEFINER RPCs for create/join/leave/invite.
No secrets or extra config needed — it's pure schema. After it's applied:
create a household on one account, generate an invite code, join from a second
account, and confirm a transaction added on one device appears on the other.

**Security note:** the shared-budget rows in `household_records` are readable by
every member of that household and are stored in plaintext to project admins
(same trust model as the cloud backup). RLS is the only thing keeping households
apart — review the policies before going wide. Client-side payload encryption
was considered and deferred (a lost passphrase = unrecoverable shared budget).

## 6. Bank linking via Plaid (family-only) — required before Linked Banks works

Runs on Plaid's **Trial plan**: free, real production bank data, but capped at
**10 connected Items across your whole Plaid account** — fine for a family,
fatal for the public. The app therefore ships with the feature OFF; only builds
with `EXPO_PUBLIC_BANK_LINKING=1` (put it in `.env.local`) show the Linked
Banks screen. Do not enable it in store builds.

**a) Plaid dashboard** (dashboard.plaid.com):
1. Create a Plaid account, then a team/app. Note the **client_id** and the
   **Sandbox** and **Production** secrets (Keys page).
2. Apply for Production access and request the **Transactions** product.
   Start in Sandbox first — everything works end-to-end with test banks.
3. Under **Link → Hosted Link**, no extra setup is needed; the functions use
   Hosted Link so no native Plaid SDK (and no prebuild) is required.
4. Add `pennybudget://bank-linked` as an **Allowed redirect URI**
   (API → Allowed redirect URIs). Required for OAuth banks like Chase.

**b) Migration + secrets + deploy:**
```bash
supabase db push        # applies migrations/20260718000000_plaid_items.sql
supabase secrets set PLAID_CLIENT_ID=xxxxxxxxxxxxx
supabase secrets set PLAID_SECRET=xxxxxxxxxxxxx          # sandbox secret first
supabase secrets set PLAID_ENV=sandbox                   # flip to production later
supabase functions deploy plaid-create-link
supabase functions deploy plaid-finish-link
supabase functions deploy plaid-sync
supabase functions deploy plaid-unlink
```

**c) Verify in Sandbox:** Settings → Linked Banks → Link a bank → pick any
institution → credentials `user_good` / `pass_good`. Transactions should
appear as a new card after sync.

**Security notes:** `plaid_items` (which holds access tokens) has RLS enabled
with **zero policies** — clients can't read it at all; only the Edge Functions
(service role) touch it. The client never sees a public_token or access_token;
Hosted Link completion is resolved server-side via `/link/token/get`.
Unlinking calls `/item/remove`, which also frees the Trial-plan Item slot.

**Privacy note (do before sharing a flagged build even with family):** linked
transactions leave the device by definition. docs/privacy.html must disclose
Plaid as a processor for linked accounts — see the compliance task.

## Already in place (from earlier setup)
- `delete_user()` SECURITY DEFINER RPC (in-app account deletion)
- `backups` Storage bucket with per-user RLS
- Apple provider enabled with the app's bundle id
