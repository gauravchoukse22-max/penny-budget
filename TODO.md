# Penny Budget — running to-do

The single source of truth for outstanding work. Read this at the start of every
session, before planning anything. Update it as items land — a finished item gets
deleted, not ticked, so this file stays short enough to actually read.

Two lists on purpose: **Gary only** is things nobody else can do (passwords,
Apple ID, dashboards he is logged into). Everything else is Claude's.

---

## Gary only

- [ ] **Upload a build to TestFlight.** Xcode Organizer → Distribute App →
      App Store Connect → Upload. Needs his Apple ID, so it can never be
      automated. **Pick the archive by its explicit name**, never by the version
      string: Organizer shows 13, 14, 15, 16, 17 and 18 all as plain "1.2.0 (n)".
      **1.2.0 (18)** is the newest built and carries the statement-importer fix
      Disha is waiting on; **19 will supersede it** once the batch above is
      verified, so if 19 exists, upload 19 instead.
- [ ] **Delete the stale June 2027 transactions**, then re-import the Chase
      statement. The first import filed them a year ahead (the year bug, fixed in
      18). On the new build: tap the month name → year arrow to 2027 → June will
      have a dot showing it holds transactions. Clear them BEFORE re-importing so
      the duplicate check isn't comparing against wrongly-dated copies.
- [ ] **Confirm the statement import actually works on the real Chase PDF.** The
      parser rewrite has 109 fixtures but has never seen a real bank statement —
      Gary declined to share the file, so his next in-app import IS the test. If
      it still imports nothing, the dialog now names which check failed and
      quotes a line it read; send that text (it contains no amounts).
- [ ] **Android: run the 14-day closed test** with ~12 testers, then apply for
      production access. Google gates production on this for personal accounts.
- [ ] **Play listing**: Data safety, content rating, store listing copy and
      graphics. Drafts are in `~/Developer/penny-budget-builds/`.

## Claude

### Next — START HERE in a fresh session
- [ ] **Verify the 2026-08-03/04 batch on the simulator, then cut iOS 19 /
      Android vc13.** SEVEN screens changed and NONE has rendered anywhere:
      Home (A+ hero), Add Transaction (chips), Cards (rows), Budget (ledger),
      Insights (Review Night + Edit sheet), Settings (hub, currency picker,
      three new links), Card detail (Edit/Save mode) — plus two brand-new
      screens, Net Worth and Bill Calendar. Every item is detailed in "Verified
      only by typecheck" below. Order: build for simulator → walk each screen →
      fix what looks wrong → bump to 19/vc13 in app.json + build.gradle +
      ios/PennyBudget/Info.plist → archive + gradle → verify signing and that
      the compiled bundle contains the new code → hand Gary the archive name.
      **The native build is also what finally links expo-print,
      expo-notifications and expo-system-ui**, so PDF export, bill reminders and
      Android dark mode only start working from this build onward.
- [ ] **Disha rejoins with Replace** — the flow exists now; walk them through it.
      That is what clears her duplicate categories and cards in one action. She
      should back up first (Settings → Backup), since Replace discards whatever
      is only on her phone.

### Competitive gaps — what paid apps ship that Penny doesn't (researched 2026-08-03)
Measured against YNAB ($109/yr), Monarch ($99.99/yr), Copilot ($95/yr), Rocket
Money, Simplifi, PocketGuard, and the one-time-purchase indies. Split by whether
the gap is closable WITHOUT bank linking — the ones that need a bank feed are
deliberate non-goals and belong in marketing copy, not this list.

**Next up — the one top-5 gap not yet built:**
- [ ] **Goal target dates + debt payoff planner.** Two features, both pure
      arithmetic over data already stored, and they pair with the Net Worth
      screen that just shipped (liabilities are entered there already).
      (a) Goals answer "funded by March at $200/mo", and the reverse — "to hit
      it by June you need $340/mo" (YNAB target-by-date, Simplifi fully-funded
      date). (b) Debt payoff: avalanche vs snowball ordering over the
      `liabilities` rows, with "paying $50 extra clears this 14 months sooner"
      (YNAB Loan Planner, PocketGuard Plus). No bank feed, no new dependency.
      Deferred from the 2026-08-03 batch on purpose: seven screens changed that
      day and none had rendered yet, so an eighth would have been unverifiable.

**Lower priority, none started:**
- [ ] **Multi-currency.** MoneyCoach and Buddy have it; real data-model surgery
      here. Blocked behind the currency-sync bug below — fix that first.
- [ ] **Tags** (cross-category labels, YNAB flags / Simplifi tags), **split
      transactions**, **receipt photo attachments**, **refund tracker**
      (Simplifi's, small and distinctive), **Apple Watch app**.
- [ ] **Home-screen widgets** — designed in `docs/WidgetDesign.md` (5 widgets,
      recommended first is "Left to Spend" small), then **dropped by Gary on
      2026-08-03**. The doc stands if it ever comes back; note it is the first
      feature needing a Swift target and an App Group (an Apple-portal step only
      Gary can do), which is part of why it was dropped.

**Deliberate non-goals** (need bank linking, against the on-device stance): auto
transaction sync, live balances, bill negotiation, credit score, investment
feeds, Amazon order matching, auto-transfers. Penny's counter-position: PDF/CSV
statement import from any bank, $0 forever, household sharing with no per-seat
price, categorisation that runs on the phone. Pitch: *"Everything a $100/yr
budget app does with your bank data — done from your statements, on your phone,
free."*

### Known gaps, not yet built
- [ ] **Currency does not sync.** Household members with different currencies see
      mismatched symbols on the same numbers. Needs a shared settings record;
      `app_settings` deliberately never syncs because it also holds device-local
      state (biometric lock, household id). Now also blocks multi-currency above.
- [ ] **A truncated v3 backup file would still wipe Funds.** Restore trusts the
      declared format version; a file claiming v3 without a `funds` key clears the
      grid. Needs validation, not the key-presence guess that was rejected.
      (Net Worth's v4 addition took the careful path — a v3 file leaves
      assets/liabilities alone — but Funds still has the original hole.)

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

**Also added the same day:** when an export carries the issuer's own category
column (Chase/Discover/Capital One/Apple Card CSVs do), the importer now uses
it in preference to the smart categorizer, translated into the user's own
categories by `lib/statement-categories.ts` (alias table: "Food & Drink" →
Dining, "Gasoline" → Gas, …). No match → guesser, never a wrong category.

**NOT yet verified against a real statement** — that is the only test that
counts, and it is the one both previous fixes skipped. Gary declined to provide
the file, so the verification IS his next in-app import from the next build.
When he reports back: if it still imports zero, get the exact dialog text — it
now names which check failed and quotes a line. For local diagnosis if a PDF is
ever available: `node scripts/check-statement-pdf.mjs <file> --lines` (runs
entirely on the Mac, masks amounts/merchants by default).

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
- [ ] **The rebuilt Budget tab (allocation ledger).** The screen now leads with
      "not yet assigned" = salary − Σ category limits − Σ savings goal amounts
      (all resolved per selected month), a thin assigned/savings/unassigned bar,
      salary controls folded into the header, category rows showing the ASSIGNED
      amount on the right with a small left/over hint, and a new "Assign the
      rest" sheet with +$25/+$50/+$100 chips writing through
      setCategoryLimitForSelectedMonth. `tsc` clean and the parser regression
      suite passes, but nothing has rendered. Needs eyes on: the zero-salary
      prompt, the over-allocated wording ("assigned $X more than income"), the
      bar when over-allocated (denominates by the plan, not income), the assign
      sheet's live remaining number after chip taps, hideAmounts masking in the
      header/hints/chips, month switching keeping past months' own numbers, and
      that swipe-to-delete still coexists with the new row layout on Android.
- [ ] **The rebuilt Insights tab ("Review Night").** Whole screen is new: eight
      independent cards in `components/insights/`, an Edit sheet that hides and
      reorders them (persisted in the new `app_settings.insightsLayout` column),
      and the SVG money map. The recurring-charge detector IS fixture-tested
      (`node scripts/test-recurring-detect.mjs`, 24 assertions), and tsc is
      clean, but nothing has rendered on a simulator — the money map's ribbon
      geometry and the edit sheet's reordering especially need eyes. Check both
      light/dark and an empty-data install.
- [ ] **The rebuilt Cards tab (compact rows).** Full-height WalletCards became
      one row per card: mini swatch, name + last four, due countdown, month
      total. Needs eyes on the swipe-to-delete panel clipping inside the rounded
      Surface, and the pressed-state colour of a row.
- [ ] **Net Worth (new screen).** `app/net-worth/index.tsx` finally uses the
      long-dormant `assets`/`liabilities` tables. Both are now in
      `SYNCABLE_TABLES` and every write journals, so this is the first new
      SYNCED feature since the sharing rework — a two-phone check matters more
      here than a simulator one. Backup format went to v4; a v3 file must leave
      existing net-worth rows ALONE rather than clearing them (the truncated-
      backup trap), which is fixture-tested but never run against a real restore.
- [ ] **Bill calendar + reminders (new screen).** `app/bills/index.tsx` plus
      `lib/bill-schedule.ts` (14 fixtures) and `features/bill-reminders.ts`.
      **The notification half cannot work until the next NATIVE build** —
      expo-notifications was only added to package.json, so autolinking happens
      at iOS 19 / vc13. Until then the code degrades to a disabled switch. Needs
      eyes on: the calendar grid on a small phone, permission prompt copy, and
      that toggling reminders off really cancels scheduled ones.
- [ ] **Monthly PDF report export.** `features/report-export.ts` (34 fixtures on
      the HTML generator). Same native caveat: expo-print links at the next
      build; before that the button says so instead of failing. Nobody has seen
      the rendered PDF — check page breaks and that a month with no data doesn't
      produce an empty sheet.
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
