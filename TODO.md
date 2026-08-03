# Penny Budget — running to-do

The single source of truth for outstanding work. Read this at the start of every
session, before planning anything. Update it as items land — a finished item gets
deleted, not ticked, so this file stays short enough to actually read.

Two lists on purpose: **Gary only** is things nobody else can do (passwords,
Apple ID, dashboards he is logged into). Everything else is Claude's.

---

## Gary only

- [ ] **Upload the current build to TestFlight.** Xcode Organizer → Distribute App
      → App Store Connect → Upload. Needs his Apple ID, so it can never be automated.
- [ ] **Android: run the 14-day closed test** with ~12 testers, then apply for
      production access. Google gates production on this for personal accounts.
- [ ] **Play listing**: Data safety, content rating, store listing copy and
      graphics. Drafts are in `~/Developer/penny-budget-builds/`.

## Claude

### Next
- [ ] **Disha rejoins with Replace** — the flow exists now; walk them through it.
      That is what clears her duplicate categories and cards in one action. She
      should back up first (Settings → Backup), since Replace discards whatever
      is only on her phone.

### Known gaps, not yet built
- [ ] **Currency does not sync.** Household members with different currencies see
      mismatched symbols on the same numbers. Needs a shared settings record;
      `app_settings` deliberately never syncs because it also holds device-local
      state (biometric lock, household id).
- [ ] **A truncated v3 backup file would still wipe Funds.** Restore trusts the
      declared format version; a file claiming v3 without a `funds` key clears the
      grid. Needs validation, not the key-presence guess that was rejected.
- [ ] **`assets` and `liabilities` tables** exist in migrations, are read by nothing,
      and are absent from backups. Either use them or drop them before they bite.
- [ ] **`expo-system-ui` is not installed**, so `userInterfaceStyle: automatic`
      does not fully apply light/dark on Android.

### Fixed and verified on-simulator 2026-08-02: scrolling changed the month
Reported twice, so it was not marginal. Home's month swipe used
`onMoveShouldSetPanResponderCapture` — the CAPTURE phase runs before the
ScrollView can claim the touch, so the swipe got first refusal on every gesture
with only a threshold between a scroll and a month change. A thumb arcs as it
flicks; a fast scroll clears the old 15pt sideways easily. Now
`onMoveShouldSetPanResponder` (non-capture), which is only consulted after the
ScrollView declines, plus 24pt/2.5:1 to claim, 60pt/2:1 to commit, and
`onPanResponderTerminationRequest` so the ScrollView can take the gesture back.
Verified: two arcing scrolls that each drifted ~70pt sideways (past the old
±50pt commit) left the month on August; a deliberate horizontal swipe still
moved it to July. **Only Home has this gesture** — the other tabs use the
MonthSwitcher arrows, so nothing else needed the fix.

### Rewritten 2026-08-03: the statement importer is no longer issuer-specific
Third report of a real Chase statement importing nothing, and the previous two
fixes were aimed at the wrong layer. The dialog said *"Couldn't read a date on
any of the 162 rows"* and quoted **"The amount of your payment should be at
least your minimum payment,"** — a line of legal prose. That quote is the whole
diagnosis: the reader was not looking at the transaction table at all.

**Root cause — the design, not a parsing detail.** `lib/pdf-layout.ts` found ONE
column header in the document and then read every page's rows through that
header's x positions. A real statement has several tables; the payment
information box contains "date", "payment" and "name", so it matched first.
From then on column 1 meant "Payment Due Date", and all 162 real transaction
rows read their *description* as their date and were dropped. Any statement
whose first table isn't the transaction table fails this way — so this was never
going to be a Chase-only problem.

**The fix — recognise transactions by shape, not by geometry.** New
`lib/statement-lines.ts` reads the printed LINES: a transaction is a line that
begins with a date and ends with an amount. That is true of every issuer,
needs no header, survives tables split across pages, and cannot be derailed by
another table elsewhere in the document. `documentToRecords` now tries the line
reader first and keeps the old header-anchored path only as a fallback for
genuinely tabular PDFs. Interpretation (year, sign, date order, section
subtotals) is unchanged — both CSV and PDF still share it.

Also handled, each with a fixture: two dates per row (Discover, Capital One),
trailing-minus and parenthesised credits (Capital One, Citi), `$`-prefixed
amounts (Amex, Apple Card), month-name dates, reference/authorisation ids
stripped from the note, wrapped merchant names, and a running-balance column
(Wells Fargo) — where taking the last number on the line imports the balance as
the charge. Section banners now set the sign ONLY when the statement signs
nothing itself; a "Payments" heading with no matching "Purchases" heading after
it used to turn every later purchase into a credit.

Fixtures went 53 → 77, one per real issuer layout, plus the exact multi-table
Chase document that failed. `tsc --noEmit` clean.

**NOT yet verified against Gary's actual Chase PDF** — that is the only test
that counts, and it is the one both previous fixes skipped. New tool for it:

```
node scripts/check-statement-pdf.mjs ~/Downloads/statement.pdf --lines
```

Reads one local file, prints exactly what would be imported, masks amounts and
merchant names by default. Nothing is uploaded.

### Fixed 2026-08-03: PDF statements imported ZERO rows
Separate bug from the crash, and only visible once the crash was gone: Gary's
real Chase statement read fine (162 rows) and then skipped every one. Cause is
in the geometry, not the parser — a PDF has no delimiters, so whether an amount
becomes its own cell depends on the issuer's column positions, and here it
didn't: `["07/02", "STARBUCKS ... AL 6.75", ""]`, amount column empty. Fix is
`extractTrailingAmount` in `lib/statement-parse.ts`, tried only after the real
amount/debit/credit columns fail, which pulls a trailing amount off the
description and strips it from the note. **The guard is requiring two decimal
places** — merchant names are full of bare digits ("SHELL OIL 5744221") and
none end in `.dd`. Fixture suite went 43 → 53 to pin both the salvage and the
store-number cases. Reproduced and fixed against a generated Chase-shaped PDF;
Gary's actual statement is still the real test.

Also rewritten: the "Nothing to import" dialog now names which check failed,
counts the rows, and quotes one, because the old text ("nothing matched a date
+ amount") named two possible causes and quoted nothing — there was no way to
tell from the screen whether dates or amounts were the problem.

### Fixed and verified on-simulator 2026-08-02: PDF import crash
Picking a PDF statement killed the app instantly. Root cause chain, because each
link matters: (1) pdfjs's bundled core-js reads `DOMException.prototype`
unguarded at module eval, (2) Hermes has no `DOMException`, (3) Metro's
`guardedLoadModule` reports a lazy import's eval throw via
`ErrorUtils.reportFatalError` and does NOT rethrow — so the guarded import in
`features/pdf-extract.ts` never saw the error and a release build just died.
Fix: `installPdfjsGlobals()` supplies `DOMException` (small class) and real
streams (`web-streams-polyfill@3.3.3`, new dependency) before the import.
Lesson recorded in the code: a try/catch around a lazy import protects nothing
on native — the module's eval must not throw, period. What is NOT verified: a
real Chase PDF end-to-end on device (the synthetic test PDF exercises the crash
path and the graceful-failure dialog, not Chase's column layout — that layout
logic is fixture-tested from when the feature shipped). When Gary next imports
his actual statement, it should reach the review screen; if rows look wrong,
that is a NEW bug, not this one.

### Verified on-device 2026-08-01: bulk-edit journaling
The cherry-picked `features/bulk-actions.ts` (commit `cd98c47`) was exercised
through the real select-mode UI on the iOS simulator with journaling force-enabled
(a temporary `VERIFY_OUTBOX_WITHOUT_SESSION` bypass in `queueSyncMutation`, since
journaling normally needs a signed-in session; reverted after). A 3-row bulk
recategorise wrote 3 UPDATEs to the outbox with the NEW categoryId in the payload;
a 2-row bulk delete wrote exactly 2 DELETEs and no phantoms. What this does NOT
prove: the remote round-trip — outbox → Supabase → Disha's phone. That path is
shared with single edits and known to work, but the first two-phone bulk edit is
still worth a glance.

### Verified only by typecheck, never run on a device
These are real risks, not paperwork. Each changed behaviour no agent could observe.
- [ ] **The seeded Cash card.** `features/db-migrations.ts` seeds it once per
      install at the well-known id `penny-cash-card`, stamped in
      `app_settings.cashCardSeededAt`. A fresh install on the iOS simulator
      showed exactly one Cash card (2026-08-01), which only proves the seed
      itself. Still check on Gary's phone AND Disha's that exactly ONE appears
      **after a sync** — a second one there is the duplicate-cards bug again,
      and no simulator can show it.
- [ ] **`deleteCard` now moves transactions to Cash instead of deleting them.**
      Delete a throwaway card holding a few transactions and confirm they show up
      on Cash, on both phones, with the right amounts and months.
- [ ] **The Transactions filter sheet.** Card + category chip rows are collapsed
      into one bar. Check the list starts near the top, that Clear works, and
      that the new Uncategorized option finds the rows a deleted category left.
- [ ] Keyboard handling on Android (`KeyboardAwareScreen`) — reasoned from RN
      source, not seen. Recurring Bills and Funds Manage are the likely trouble
      spots, being forms inside a scroll view.
- [ ] `PressableScale` now sizes the touch target — used on 8 screens, so button
      layouts could have shifted subtly.
- [ ] Swipe-to-delete inside scrolling containers on Android.
- [ ] The Funds ledger backfill, on a device that already holds fund balances.

---

### How to actually test App Lock (it works — this is so nobody re-panics)
App Lock was briefly suspected of being a release blocker on 2026-08-01: over an
install with `biometricLock` on, the simulator rendered the app but swallowed
every touch. **It is not a bug.** A simulator with no enrolled biometric and no
passcode gets an iOS prompt it can never satisfy, and `authenticateUser` fails
closed by design. Enrol a face first and every path is correct — prompt on
launch, unlock on match, re-lock on foreground, refuse on non-match, and a
"Penny Budget is Locked" screen with a retry button on cancel.

```
xcrun simctl spawn <udid> notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn <udid> notifyutil -p com.apple.BiometricKit.enrollmentChanged
xcrun simctl spawn <udid> notifyutil -p com.apple.BiometricKit_Sim.pearl.match    # or .nomatch
```

App Lock lives behind the account (Account → Security), so to reach it on a
throwaway install, set `biometricLock = 1` in `app_settings` directly —
`xcrun simctl get_app_container <udid> com.gary.pennybudget data` then
`Documents/SQLite/pennybudget.db`. `autoLockGraceMinutes = 0` makes it re-lock
on every foreground instead of after a minute.

## Where things stand (2026-08-01)

Family sync **works and is verified** — Disha's transaction reached Gary's phone,
and the database shows two members and two distinct writers on household
`f4ea2b4e-b257-4e01-b1bf-cea0356bb5ce` ("Our Household"). Getting there took
fixing six tables that never journaled, a global sync watermark that silently
skipped records after switching households, activation that sampled the session
once at boot, and the absence of any realtime subscription. Do not casually
refactor that area — it took a long time to make correct.

Shipped versions: **iOS 1.2.0 build 12** is what is on both phones. 1.1.0 is live
on the App Store, which is why the version had to move to 1.2.0 — a build-number
bump alone is rejected once a version is approved. Everything committed after
build 12 — the sharing rework, tap targets, swipe-to-delete, the savings→funds
link, Funds moving under Budget, and now the month switcher — is **not in any
build the user has**.

**iOS build 14 / Android vc8** are the numbers for the next upload (2026-08-03).
Build 13 was skipped deliberately: two different 1.2.0 (13) archives existed
(one from 2026-08-02 without that day's fixes), and Xcode's Organizer shows both
as plain "1.2.0 (13)" — one wrong pick uploads a build missing everything, and a
duplicate build number is rejected as ITMS-4238 only after the whole upload
finishes. Bumping past it made the right archive unambiguous. **Check for stale
same-numbered archives before every upload** — `PlistBuddy -c "Print
:ApplicationProperties:CFBundleVersion"` over `~/Library/Developer/Xcode/Archives/*/*.xcarchive`.

Android skipped vc7: it was built but never uploaded, so reusing the number
would have made "what is in Play" ambiguous for nothing. The month-switcher work
was verified by running a Release build on the iOS simulator, tab by tab — the
first time this list's UI claims have been checked on a running app rather than
reasoned about.

Duplicates on Gary's phone are expected until Disha rejoins with Replace: joining
used to pull the shared budget without pushing local rows, leaving the joiner
holding both sets.

## How this app's sync works, in one paragraph

Every local write is journaled to an `outbox`; a sync cycle pushes it and pulls
remote changes into local tables. The remote is a generic `household_records`
mirror keyed by record type and id, scoped by RLS to household membership.
**A write that does not call `queueSyncMutation` never reaches the other member** —
six tables were missing it and diverged silently for weeks. Any new table must be
added to `SYNCABLE_TABLES` and journal every write path, including the rows
orphaned by a delete, because foreign keys are not enforced and cascades never fire.
