# KaiJar — running to-do

> **Renamed 2026-08-11: "Penny Budget" → "KaiJar".** "Penny Budget" collided with
> dozens of apps; the first pick, "Kaijet", is a registered trademark of KaiJet
> Technology International (brand j5create), who have litigated before — dropped.
> Code strings, `app.json`, iOS `CFBundleDisplayName` and Android `app_name` are
> already done. The bundle id / package stays `com.gary.pennybudget` forever
> (locked on iOS after first release, and changing it on Android would break the
> Google OAuth client config for zero user-visible gain). The `pennybudget://`
> scheme, `pennybudget.db`, `penny-cash-card` and the `PENNY_UPLOAD_*` gradle
> properties are all deliberately unchanged — renaming any of them breaks
> existing installs, Plaid redirects, or the signing config.

The single source of truth for outstanding work. Read this at the start of every
session, before planning anything. Update it as items land — a finished item gets
deleted, not ticked, so this file stays short enough to actually read.

Two lists on purpose: **Gary only** is things nobody else can do (passwords,
Apple ID, dashboards he is logged into). Everything else is Claude's.

---

## Gary only

### ~~SUBMIT 1.2.0~~ — DONE. Live on the App Store 2026-08-11 07:22 UTC.
Verified against Apple's own lookup API, not from memory: version 1.2.0,
App ID 6788635272. App Privacy, age rating and the three URLs are all
answered already and carry forward — you do **not** redo them for 1.3.0.

### SUBMIT 1.3.0 — the rename release
Everything to paste lives in `docs/AppStoreSubmission.md`. Screenshots are
unchanged and already uploaded — none of them showed the old name.

> **Why a new version at all:** a live version's Name field is locked. Creating
> 1.3.0 is what unlocks it. The store name and the binary must ship together,
> or the icon label and the listing disagree.

1. [ ] App Store Connect → **+ Version** → `1.3.0`. This is what unlocks the
       name field; nothing else works until this exists.
2. [ ] **App Information → Name** → `KaiJar: Budget Planner`
       **(decided 2026-08-11 — paste it exactly, no decision left to make).**
       The home screen still reads just **KaiJar**; that comes from the binary,
       not this field. Same string goes on Google Play.
3. [ ] Upload **PennyBudget 1.3.0 (26)** from Xcode Organizer. The archive name
       still says PennyBudget — that is the internal Xcode target, not the app
       name, and renaming it would break the build recipe for no user benefit.
4. [ ] **1.3.0 version page**: paste the new promo text and What's New from the
       pack. Description, subtitle, keywords and screenshots are unchanged.
5. [ ] Review notes: the pack now opens by explaining the rename and the
       unchanged bundle ID, so review does not read it as a different app.
       Demo account is `appreview@gary-labs.com`; password is in your manager.
6. [ ] Select **build 26**, **Manually release this version**, Submit.
7. [ ] After it is approved — **deploy gary-labs.com** (see Claude's list; the
       site is rebuilt and waiting). Do it before release so the privacy page
       and the app agree on the name.


- [x] **Chase import confirmed working on the real statement PDF** (Gary,
      2026-08-04) — the parser's first contact with a real bank survived. The
      109 fixtures stand validated; keep them ahead of any parser change.
### Rename — two things that live OUTSIDE the app binary
Both are user-visible and neither ships with the build. Found by sweeping for
the old name rather than assuming the app was the only place it appeared.

### LIVE BUG found 2026-08-11 — signup/reset emails had no code

Not a rename issue at all. The rename sweep happened to uncover it.

**What was wrong — precisely.** Gary rightly pushed back with "it was working
before", and he was half right:

- **Verified** `GET /auth/v1/settings` returns `"mailer_autoconfirm": false`, so
  email confirmation really is required. `signUp` therefore gets no session,
  returns `needsEmailConfirmation`, and `app/account/index.tsx:118` always
  routes to the verify-email screen. Nobody skips it.
- **Verified** both templates were link-only — no `{{ .Token }}`.
- So the **6-digit code box never worked**: the app said "Check your email for a
  6-digit code" and the email contained no digits.
- But the **link always worked** (`AuthContext.tsx:139` `exchangeCodeForSession`),
  and the screen's own footnote points at it. That is what Gary used when
  testing, which is why the account flow appeared healthy.

Half broken, not broken: advertised path dead, fallback carrying it. An earlier
note here said "broken since launch", which overstated it.

Use `curl "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY"` to check auth
config — read-only, no side effects, and far better than inferring.

- [x] **Confirm signup template fixed** (Gary, 2026-08-11) — `{{ .Token }}`
      added above his existing link wording, link kept as the fallback.
- [x] **Reset password template fixed** (Gary, 2026-08-11) — same change.
- [x] **VERIFIED END TO END, not assumed** (2026-08-11). A real signup was
      POSTed to `/auth/v1/signup` for a throwaway iCloud alias; the response
      returned `session: False` and `confirmation_sent_at` set, which is the
      empirical confirmation that the app routes to the code screen. Gary then
      opened the inbox and **saw a 6-digit number**. That is the first time the
      code path has ever worked.
- [ ] **Delete the test user** — Supabase → Authentication → Users →
      `figures.cobbler-0g@icloud.com`. It inflates the real user count.
- [x] **Custom SMTP is already configured** — `supabase/README.md` §2 lists it
      as a to-do, but it is done. The test email arrived from
      `noreply_at_gary-labs_com_...@icloud.com`, which is iCloud Hide My Email's
      relay encoding of `noreply@gary-labs.com`. So the ~2 emails/hour cap on
      Supabase's built-in mailer does not apply. Another case of the README
      describing intent rather than current state — do not trust it as a record
      of what is configured.
- [ ] **While in there — check `supabase/README.md` §4 redirect URLs are
      actually registered** (`pennybudget://account/update-password`,
      `pennybudget://account/index`). That README is an instruction list, not a
      record of what is configured — the same mistake that hid this bug for
      weeks. The link fallback only works if those are present.

**Note for the rename:** the templates never mentioned "Penny Budget" at all, so
nothing here needed renaming. An earlier version of this item claimed they did.
That was invented from the README and was wrong — see AGENTS.md §0.
- [x] **Plaid — nothing to do. Bank linking is already off in store builds.**
      `BANK_LINKING_ENABLED` is `process.env.EXPO_PUBLIC_BANK_LINKING === '1'`
      (`lib/feature-flags.ts`), the var is not set in `.env.local`, and Expo
      inlines it at bundle time — so the Settings entry point never renders and
      `app/bank/index.tsx` is unreachable. Gary asked to hide Plaid on
      2026-08-11; it was already hidden.

      **An earlier version of this item called the Plaid consent screen "the
      single most trust-sensitive screen in the app" and made redeploying it
      urgent. That was wrong** — no store user can reach it. Redeploying
      `plaid-create-link` is worth doing whenever the function is next touched,
      purely so a future bank-enabled build does not show the old name, but it
      is not blocking anything. See AGENTS.md §0.

      Follow-up that *was* real: the 1.0.1 What's New entry announced Linked
      Banks to users who cannot open it. Now gated behind the same flag.

- [ ] **Android: run the 14-day closed test** with ~12 testers, then apply for
      production access. Google gates production on this for personal accounts.
- [ ] **Play Console → Grow → Store presence → Main store listing → App name**:
      set to `KaiJar: Budget Planner` — the same string as the App Store, so the
      two listings match. Unlike Apple, Play lets you change this any time
      without a new version, but the launcher label still comes from the AAB.
- [ ] **Play listing**: Data safety, content rating, store listing copy and
      graphics. Drafts are in `~/Developer/penny-budget-builds/`.

## Claude

### Rename fallout — clear before 1.2.0 ships

- [x] **Store copy rewritten** (2026-08-11). All nine `docs/*.md` renamed;
      `AppStoreSubmission.md` retargeted to 1.3.0 with a new section 0 on the
      app name, rename-first promotional text, a What's New that leads with
      reassurance, and review notes that explain the unchanged bundle ID.
      Keywords and description needed no change — "penny" was never a keyword,
      and `budget,budgeting` already covers what the Name field stops carrying.
      URLs in the docs were left pointing at `/penny-budget/` on purpose.
- [x] **Screenshots checked — no re-shoot needed** (2026-08-11). All 8 frames
      are Home, Budget, Split, Insights, Planner, Net Worth, Transactions and
      Cards; none is the Settings screen or the lock screen, which are the only
      two places the old name appeared in the UI. The caption headers are
      benefit lines, not the app name. The existing sets for all three sizes
      stand.
- [x] **gary-labs.com rebuilt with the new name** (2026-08-11).
      `~/Developer/gary-labs-site/content.mjs` renamed and `node build.mjs` run
      clean; the built privacy page has 12 KaiJar references and zero stale
      ones. The site app icon (`static/icons/penny-budget.png`, 192px) is the
      new jar.
      **The URL paths deliberately still say `/penny-budget/`.** The live 1.2.0
      binary has those URLs compiled in, so every user you have right now hits
      them — changing the slug would break the Privacy link Apple requires to
      work. The builder has no redirect support, so a slug change would need
      that written first. Revisit once 1.2.0 installs have aged out.
      **→ Gary still has to deploy the site.** Nothing is live until he does.
- [x] **Icon redrawn as a jar of nine coins** (Gary chose it, 2026-08-11).
      `assets/icon.png` 1024, `android-icon-background` 512, `-foreground` 512,
      `-monochrome` 432, `favicon` 48 — all regenerated by
      `scripts/make-icons.py`, originals recoverable from git. The
      coins are punched out as transparent holes, so the one shape serves as
      the store icon, the adaptive foreground (background gradient shows
      through) and the monochrome layer (system tint shows through). Artwork is
      held to 44% of canvas height on the Android layers so the corners survive
      the launcher's 66dp safe-zone mask. Verified by compositing under a
      circle mask — not yet seen on a real launcher.
- [x] **Fresh builds cut and verified** (2026-08-11). Version is **1.3.0**
      everywhere — `app.json`, `Info.plist`, `build.gradle`.

      **iOS:** `~/Library/Developer/Xcode/Archives/2026-08-11/PennyBudget 1.3.0 (26).xcarchive`.
      Verified from inside the archive, not from a green build: display name
      KaiJar, version 1.3.0 (26), bundle id unchanged, Face ID string fixed,
      and the app icon reverted out of Apple's CgBI format to confirm the jar
      really shipped.

      **Android:** `~/Developer/penny-budget-builds/KaiJar-1.3.0-vc16.aab`
      (and `.apk`). Verified: `application-label:'KaiJar'`, versionCode 16,
      versionName 1.3.0, signed with the upload key
      `dc076300950d3d17f19ac812262c2cf8e2ebe1eb` — NOT the debug key.
      Hermes bundle checked with `strings -a` (plain grep finds nothing in
      bytecode — that false negative cost a round trip): 10 KaiJar hits, the
      rename changelog entry present, and the only two remaining "Penny Budget"
      strings are the intentional ones inside that entry.

      **The trap this caught:** `expo prebuild` is what normally regenerates the
      native icons and the Face ID usage string from `app.json`. This repo never
      prebuilds, so editing `app.json` alone would have shipped the rename with
      the old piggy-bank icon on both platforms and a Face ID prompt naming an
      app that no longer exists. The iOS asset catalog and all 25 Android
      mipmap webp files had to be regenerated in place.

      **`ios/` and `android/` are gitignored, so those icons are not in version
      control.** `scripts/make-icons.py` is their only reproducible record —
      run it if either directory is ever recreated, or the app ships the wrong
      icon with a perfectly green build.

### Next — START HERE in a fresh session

- [ ] **Re-check the sheets on iOS after the safe-area fix.** iOS **build 25**
      is on Gary's phone. Every pageSheet now renders inside `SheetModal`,
      which pads by the top inset on **Android only** — iOS should look
      unchanged, but that was reasoned from the code, NOT seen. Open the Budget
      tab's number editor and confirm the Cancel/Save header sits where it
      always did, with no new gap. Same for Add Category, the month picker, the
      over-assigned sheet, Split editor, tag picker and the Settings sheets.
- [ ] **Android: the over-assign warning is VERIFIED on an emulator**
      (setup-wizard live note, the Finish dialog, Go back landing on
      Categories, the number editor dialog, and declining keeping the sheet
      open with the typed amount). Never run on a real Android phone.
- [ ] **Android needs a fresh cut and vc15 is now stale.** vc15 predates both
      the over-assign warning AND the sheet fix, so it ships an app whose
      budget editor cannot be saved or cancelled. Do NOT upload vc15 — cut
      vc16 and delete the vc15 AAB (the vc7 rule).
- [ ] **Build number split:** the repo is on iOS **25**; the archive being
      submitted is **23**. 23 has neither the warning nor the sheet fix.

Everything on the competitive-gap list is now BUILT. What remains is
verification and Android.

- [ ] **Walk what remains unwalked.** The import preview is now VERIFIED on the
      simulator (PDF parse → bulk edit → 'remembered 2 merchants' → rules in
      category_rules), and it caught the per-order-code bug the same day. Still
      never run: receipts (see the blocker below), the household Currency
      section (needs two phones), and most of the swept button call sites
      (Search, Recurring, Funds and the Data section were spot-checked; the
      account screens and sheets were not).
- [ ] **expo-image-picker is NOT installed**, so receipts fall back to
      expo-document-picker — on iOS that opens Files, not Photos, and a
      camera-roll photo cannot be attached at all. Adding it is a native module
      and therefore a full rebuild; do it deliberately, and re-check
      `Podfile.lock` afterwards (see the pod-install trap below). The swap is
      confined to `pickReceiptAsset()`.
- [ ] **Two-phone walk for the shared-currency change.** Create → join → change
      currency in both directions. The storage path is typechecked only.
- [ ] **Gary: upload Android vc15 to Play** once the iOS build is up —
      `~/Developer/penny-budget-builds/PennyBudget-1.2.0-vc15.aab`, signer
      (dc0763…e1eb) and versionCode verified. vc13 and vc14 were cut and
      superseded before upload, so their files were deleted — never leave an
      ambiguous number lying around (the vc7 rule).

### Done 2026-08-04: Add a Bill now speaks Add Transaction's language
The Recurring Bills form was four small grey fields and an icon grid while Add
Transaction led with a big centred amount and colour-disc chips — adding a bill
felt like a different app. It now shares the amount header, the category chips,
the mini wallet-card chips and the name-based category suggestion. Where Add
Transaction asks WHEN it happened, a bill asks when it REPEATS, so the date chip
row became The 1st / The 15th / Last day / Other in the same slot. "Last day"
stores 31 and the scheduler already clamps that to each month's real end.

The styles are deliberately copied from `app/transaction/add.tsx`. If that
screen's visual language changes, change this one with it.

**Bug it surfaced, now fixed and confirmed on screen:**
`listRecurringTransactions` returned SQLite's NUMBER 0/1 for `active` while the
type claimed boolean, so nothing type-checked the difference and React Native's
Switch rendered `1` as OFF. Every active bill showed a disabled switch while
posting every month — the screen said one thing and the app did another.
`features/bill-reminders.ts` already coerced it and was the only caller that got
it right; the loader now does it once for everyone.

Verified: saved a bill on The 15th, row reads "Netflix · Day 15 · next Aug 15 ·
$15.50" on ONE line with a green switch, and the "Other" chip reveals the
day-of-month field.

### Watch out: columns that exist and do nothing
FOUR features looked shipped because their column was already in the schema and
nothing read it: `categories.rolloverEnabled`, `transactions.receiptUri`,
`liabilities.interestRate` and `liabilities.minimumPayment`. The last two made a
whole debt-planner design go the wrong way — it concluded the schema could not
support avalanche ordering and stored rates per-device, which would have meant
Disha never seeing them. **Grep for a column before concluding it is missing,
and grep for its READERS before concluding it works.**

### Done 2026-08-04: the 2026-08-03/04 batch is verified and iOS 19 is archived
Walked on the iPhone 17 Pro Max simulator against a Release build (embedded
bundle, not Metro): onboarding all 5 steps, Home (A+ hero), Budget (allocation
ledger), Settings (hub + three new links), Insights, Net Worth and Bill
Calendar all render correctly with sane empty states.

**The batch would have shipped half-dead.** `expo-print`, `expo-notifications`
and `expo-system-ui` were in `package.json` but had **never been `pod install`ed**
— absent from `ios/Podfile.lock` and from the compiled binary. Build 18 and any
19 cut without this fix would have had PDF export and bill reminders silently
unavailable, exactly the failure their own fallback copy describes. Fixed with
`pod install` (needs `LANG=en_US.UTF-8` or CocoaPods 1.17 throws an ASCII-8BIT
Unicode error). Both features then verified live: the notification permission
prompt appears and the reminders switch sticks ON; the PDF exports at 23 KB and
opens the share sheet.

**Also fixed:** the exported PDF was named with a bare UUID, so "Save to Files"
wrote an unfindable file. `features/report-export.ts` now copies it to
"Penny Budget - August 2026.pdf" before sharing (cosmetic-only, falls back to
the original uri on any failure). Verified in the share sheet.

Still unwalked, no evidence either way: Add Transaction chips, Cards rows,
Card detail Edit/Save, Insights "Review Night" (its string isn't in the bundle —
check whether that feature actually landed).
- [ ] **Disha rejoins with Replace** — the flow exists now; walk them through it.
      That is what clears her duplicate categories and cards in one action. She
      should back up first (Settings → Backup), since Replace discards whatever
      is only on her phone.

### Competitive gaps — what paid apps ship that Penny doesn't (researched 2026-08-03)
Measured against YNAB ($109/yr), Monarch ($99.99/yr), Copilot ($95/yr), Rocket
Money, Simplifi, PocketGuard, and the one-time-purchase indies. Split by whether
the gap is closable WITHOUT bank linking — the ones that need a bank feed are
deliberate non-goals and belong in marketing copy, not this list.

**SHIPPED in builds 20–22:** splits, rollover, tags, refund tracker, receipts
(Files-only until expo-image-picker lands), goal target dates, debt payoff,
net worth trend, shared household currency, import learning.

**Lower priority, none started:**
- [ ] **Multi-currency.** MoneyCoach and Buddy have it; real data-model surgery.
      UNBLOCKED now that currency syncs via shared_settings — but still a big
      job: every stored amount needs a currency and a rate at entry time.
- [ ] **Apple Watch app.**
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
- [ ] **"Paid from a fund" on a transaction** (built 2026-08-15, NOT in any
      build). A transaction can name one cell of the Funds grid, and
      `setTransactionFundPayment` files the matching negative fund entry at the
      derived id `txn-<transactionId>` — so the Vacation fund comes down by the
      booking without anyone typing the number twice.

      **Verified:** `tsc --noEmit` clean, and the orphan-sweep SQL run against a
      real sqlite3 database (it took the stale orphan only, sparing a live
      entry, a just-synced one, a hand-typed one and a `goal-` one).
      **Not verified:** anything on a screen, and the two-phone round trip.

      Needs eyes on: the fund chip row on Add (it renders NOTHING until the
      grid has at least one fund and one account); the "goes to $X" preview,
      including on the Edit screen where the balance must exclude this
      transaction's own withdrawal; the amber "more than it holds" line, which
      warns and does not block; editing the amount moving the fund by the
      difference; deleting the transaction giving the money back; and that
      Funds history rows say "From a transaction" and refuse to swipe-delete.

      The sweep is deliberately **24h-delayed** (`ORPHANED_ENTRY_GRACE_MS`):
      sweeping eagerly would delete a co-member's entry that arrived in a pull
      before its transaction did — and journal the tombstone back at them.
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
