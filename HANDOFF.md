# 📌 Penny Budget — Master Handoff & Continuity File

> **READ THIS FIRST if you're a new Claude session picking up this project.**
> This file is the single source of truth for resuming work. Open this folder in Claude Code,
> read this file top to bottom, then continue from **§4 Next steps** and the **§6 Session log**.
>
> **Keeping it live:** update §3, §4, and append to §6 whenever meaningful work pauses.

**Last updated:** 2026-07-08 (bold/colorful redesign, per-month budget snapshots, Particulars
importer, transaction-entry bug fix, first TestFlight builds in flight)

> **⚠️ IN-FLIGHT WHEN THIS FILE WAS LAST TOUCHED:** a background poll-and-submit loop
> (`wait_and_submit.sh`, task id `b78rit34t` in that session — won't exist in a new session, this
> is just context) was watching iOS build `2d78582c-da7f-4e7d-bb5b-b7cd3bf48a23` (bundle
> `com.gary.pennybudget`, buildNumber 3, contains ALL the changes in today's session log) and would
> auto-run `eas submit -p ios --profile production --id 2d78582c-... --non-interactive` the moment
> it finished. **If picking this up fresh:** run `npx eas build:view 2d78582c-da7f-4e7d-bb5b-b7cd3bf48a23`
> to see if it finished, and `npx eas submit -p ios --profile production` (interactive, since
> `ascAppId` still isn't in `eas.json` — see the submit gotcha below) if it hasn't been submitted yet.

---

## 1. What this project is

**Penny Budget** — a private, on-device personal budgeting app. Track spend by category and by
card, set a monthly salary (fixed or variable) and savings goals, and see a live **Surplus**
(Salary − Spend − Savings Goals). Built with Expo (React Native) + TypeScript, file-based routes
via `expo-router`. All data lives in on-device SQLite (`lib/db.ts`) — no server, no accounts.

## 2. Tech stack & architecture

- **Expo SDK 54** (downgraded from 57 on 2026-07-08 per owner request — see §6), React Native
  0.81, TypeScript, `expo-router`.
- **Local-only:** SQLite via `expo-sqlite` (`lib/db.ts`), file `pennybudget.db`, WAL mode. Persists
  across app restarts/reinstalls-of-session — nothing is wiped except an actual uninstall.
- **Source layout:** screens in `app/` (`(tabs)/` for the 6 main tabs, `transaction/`, `category/`,
  `card/` for detail/modal routes, `setup.tsx` for first-run onboarding), shared logic in `lib/`
  (`db.ts` schema+seed, `queries.ts` reads/writes+CSV serialization, `csv.ts` import/export,
  `format.ts` date/currency helpers, `models.ts` types), `context/BudgetContext.tsx` (the one
  global provider — all screens read/write through `useBudget()`), design tokens in
  `theme/colors.ts`, presentational components in `components/`.
- **Design system (`theme/colors.ts`):** pivoted mid-project from Apple-minimal to **bold &
  colorful (Mint/Monarch style)** per owner request ("currently it looks mundane, I don't need
  that minimal of an app") — see §6 for the full pivot. Now: vivid gradient hero/stat cards
  (`heroPositive`/`heroNegative`/`heroNeutral`/`statSpent`/`statSaved`/`statDays`, each a
  `readonly [string, string]` tuple fed to `expo-linear-gradient`), **solid** category-color fills
  on icons/badges/active chips (not soft tints — tinted mode was the old Apple-minimal look),
  named `spacing`/`radius`/`type` tokens still in place. `Theme` is now an explicit `interface`
  (not `typeof light`) specifically so the gradient tuples in `light`/`dark` don't collapse to
  mismatched literal types — don't revert that without re-checking `tsc`.

## 3. Current status

**Built:** onboarding wizard (`setup.tsx`, 5 steps: currency → categories → salary → savings →
cards), Home (gradient surplus hero, 3 gradient stat tiles, budget-health bars, recent
transactions, FAB), Transactions (search + card/category filters, swipe-to-delete), Budget
(categories with progress bars + inline add, salary fixed/variable toggle, savings goals with
per-month editable amounts + transfer checklist), Cards (wallet-style cards, add modal, due-date
badges), Insights (6-month spend trend, category donut, budget-vs-actual bars, card usage donut,
surplus history), Settings (currency picker, CSV export/import, Monthly Log import), Category/Card
detail screens with per-item trend + transaction list + delete + (for cards) billing-day editors.

**Data model defaults** (seeded once, only if the table is empty — fully editable after):
categories mirror a real household budget (Mortgage, Car Payment, Utilities, Internet &
Subscriptions, Phone Service, Groceries, Dining, Gas, Clothing, Family/Baby, Other); savings goals
seed to Emergency Fund, Vacation, Home Repairs, Child/Education Savings, Miscellaneous Savings. See
`lib/db.ts` `DEFAULT_CATEGORIES` / `DEFAULT_SAVINGS_GOALS`. Post-launch category additions (Car
Payment, Internet & Subscriptions) retroactively backfill onto *existing* installs too, via
`addPostLaunchCategoriesIfMissing()` — verified live that this doesn't touch/duplicate a user's
existing categories.

**Per-month budget snapshots (the big architectural fix this session):** category monthly limits
and savings-goal monthly amounts used to be single global values applied identically to every
month past/present/future — editing today's grocery budget silently rewrote what every past
month's budget "was." Now: `category_budgets` (categoryId, yearMonth, monthlyLimit) and
`savings_goal_budgets` (goalId, yearMonth, monthlyAmount) tables snapshot a value **from that month
forward**, with carry-forward semantics (`resolveCategoryLimits`/`resolveSavingsGoalAmounts` in
`lib/queries.ts` — look up the most recent snapshot at-or-before the requested month, else fall
back to the category/goal's original value at creation). Editing in `app/category/[id].tsx` (limit)
or the Budget tab's `GoalAmountInput` (goal amount) writes a new snapshot for `selectedMonth` only
— past months are untouched, future months inherit until they get their own edit. This is exactly
"set a budget at setup, adjust later, per-month" as the owner specified.

**Surplus/Saved math also fixed to not phantom-populate empty months:** `computeSurplus` used to
subtract the *full* savings-goal total every month regardless of activity, so a completely empty
past/future month still showed e.g. `-$600` surplus. Now `totalTransferredSavings()` only counts a
goal's amount toward "Saved" if it was actually checked off via the transfer checklist for that
specific month — mirrors how YNAB/Copilot/Mint only count money as saved once it's real, not just
budgeted. The Home screen's Saved tile shows both (`$X of $Y planned`).

**Card billing tracking:** `cards` has optional `billDay`/`dueDay` (day-of-month ints, self-healing
`PRAGMA table_info` migration in `lib/db.ts`). Editable in `app/card/[id].tsx`;
`lib/queries.ts daysUntilDue()` computes the countdown; Cards tab + card detail show a "Due in N
days" hint (red within 5 days).

**Savings-goal monthly transfer checklist:** `savings_goal_transfers` table (goalId, yearMonth,
transferred) — `BudgetContext.transferStatus` + `setGoalTransferred()`. Checkbox per goal on the
Budget tab. This is now load-bearing for the Surplus/Saved math above, not just cosmetic.

**Two CSV import paths in Settings:**
1. **Import CSV** (`importTransactionsCsv`) — per-transaction format
   `date,amount,category,card,note,source`, any historical `YYYY-MM-DD` date works, `card` must
   match an existing card name exactly or the row is skipped.
2. **Import Monthly Log** (`importParticularsCsv`, backed by `lib/particulars.ts`) — for a
   line-item sheet shape (name + amount per row, no dates/cards, matches the owner's real household
   budget sheet's "Particulars" tab). Keyword-based category guesser
   (`guessCategoryId`/`KEYWORD_RULES`) maps vendor names (Walmart/Trader Joe's/Kroger/etc. →
   Groceries, "Car EMI" → Car Payment, "Wifi"/"Icloud" → Internet & Subscriptions, ...) and
   recognizes "Savings Transfer" rows to exclude from spend. Everything lands on an
   auto-created "Unassigned (imported)" card (reassign per-row after). **Verified against
   fabricated sample data** (see below) since the owner won't share real numbers, only screenshots
   of the sheet's structure with values redacted.

**Real bug fixed — transaction entry silently broken with zero cards:** if `cards.length === 0`
(e.g. user skips the Cards step during onboarding), `app/transaction/add.tsx` rendered an empty
Card section and kept Save permanently disabled with **no error message at all** — this was almost
certainly what the owner hit reporting "I can't enter transactions." Fixed: an explicit empty-state
screen ("Add a card first" + button straight to Cards) renders instead of the broken form.

**Verified:** `npx tsc --noEmit` clean throughout. Manually smoke-tested every tab + the new
gradient rendering + per-month budget carry-forward behavior in the web preview via DOM
inspection (`preview_eval` reading `getComputedStyle(...).backgroundImage` to confirm real
gradients render, not just that the app doesn't crash) — no new console errors beyond the
pre-existing chart `transform-origin` SVG warning. Also wrote a throwaway `tsx` test script against
fabricated CSV data (modeled on, not copied from, the owner's real sheet) to prove the Monthly Log
importer's categorization logic actually works before wiring it into the UI — caught a real bug
this way (an "ikea → Home" keyword rule pointed at a category that had since been renamed away).

**iOS / TestFlight status:** EAS project linked (`@gauravchoukse22/Penny-Budget`, projectId
`65822f93-8765-417b-81dc-bff4f58011c2`), `eas.json` build profiles configured, bundle id
`com.gary.pennybudget`, distribution cert + provisioning profile created and cached on EAS (so
builds after the first run fully non-interactively — no more Apple 2FA prompts needed).
**Build #1** (`94a50614-...`, buildNumber 2) **FINISHED** — this was the Apple-minimal-era code,
built + owner ran `eas submit` on it manually (outcome not confirmed in this session — ask the
owner or check App Store Connect / TestFlight directly). **Build #2** (`2d78582c-...`, buildNumber
3, contains everything through the bold redesign + per-month budgets + Particulars importer + the
transaction-entry fix) was **in progress** when this session ended, with a background script
polling it and set to auto-run `eas submit` the moment it finishes — see the warning banner at the
top of this file for exact status/IDs if picking this up.

**Not yet done:** no automated test suite exists for this project (unlike the sibling Backstory
app) — verification so far is `tsc` + manual preview smoke tests + the one throwaway parser test
script (not committed, lived in a session scratchpad). No Android build has been attempted.

## 4. Next steps (in order)

1. **Confirm build #2 (`2d78582c-...`) finished and got submitted to TestFlight** — check
   `npx eas build:view 2d78582c-da7f-4e7d-bb5b-b7cd3bf48a23` and the owner's email/App Store
   Connect for a processing notification. If the auto-submit failed on `ascAppId` (same failure
   mode as build #1's auto-submit), run `npx eas submit -p ios --profile production` interactively
   — it'll ask a couple of App Store Connect questions the first time. Once a submit succeeds
   non-interactively or you get the numeric App Store Connect app id, add it to `eas.json`
   `submit.production.ios.ascAppId` so future submits don't need `--non-interactive` friction.
2. **Owner still hasn't shared real historical transaction data** (2-3 years, from their real
   spreadsheet) — they've explicitly said they never will, only screenshots with numbers redacted.
   The Monthly Log importer (`importParticularsCsv`) was built and verified against *fabricated*
   data matching the sheet's structure instead. If the owner wants it tested against something
   closer to real, they'd need to provide a dummy file with the same column layout (fake numbers
   are fine) — screenshots alone can't validate a parser.
3. **Visual QA on a real device** — the bold redesign (gradients, solid category-color fills) was
   verified via web preview DOM inspection only, never screenshotted or eyeballed on an actual
   phone. Once TestFlight build #2 is installable, do a real visual pass.
4. Consider adding a jest test harness (none exists) if this app grows — at minimum around
   `lib/queries.ts` (surplus/carry-forward math) and `lib/particulars.ts` (categorization) since
   those are the crown-jewel calculations and now have real logic worth regression-testing.
5. No Android build attempted yet — iOS was the priority.

## 5. How to run

- `npm start` (= `expo start`) → open `http://localhost:8081` in a browser, or scan the QR with
  Expo Go on your phone (same Wi-Fi network), or `npm run ios` / `npm run android` for a simulator.
- Type-check: `npx tsc --noEmit`.
- If port 8081 is already in use by another running dev server, either reuse that one or stop it
  first — `expo start` won't prompt for a different port in non-interactive shells.

## 6. Session log (newest first)

- **2026-07-08 (latest — bold redesign, per-month budgets, Particulars importer verified, real bug
  fixes, first two TestFlight builds).** Long session, several distinct asks from the owner in
  sequence:
  • **"App is showing same numbers for previous months which are already gone, I don't need that"**
  — root-caused via a clarifying question (owner: "old month had no transactions, neither does this
  month but there are certain numbers showing up which is incorrect") to the Surplus/Saved bug
  described in §3 above (savings-goal totals subtracted unconditionally every month regardless of
  activity). Fixed `computeSurplus` to only count *transferred* savings goals per month
  (`totalTransferredSavings`), added the "$X of $Y planned" hint on the Home screen's Saved tile.
  Verified live: an empty month now shows `$0.00` surplus instead of phantom negative numbers.
  • **"There should be a budget set by the user initially... calculation per month should use the
  budget number and the savings number for that month, unless changed"** — this was the deeper
  ask behind the bug above: category limits and savings-goal amounts needed real per-month
  history, not one global mutable value. Clarified scope via AskUserQuestion (confirmed: full
  per-month snapshots with carry-forward, like salary already had in variable mode — not just a
  cosmetic fix). Built `category_budgets` + `savings_goal_budgets` tables with
  `resolveCategoryLimits`/`resolveSavingsGoalAmounts` (carry-forward: most recent snapshot at-or-
  before the requested month) and `setCategoryLimitForMonth`/`setSavingsGoalAmountForMonth`
  (writes a snapshot for exactly one month forward). Wired through `BudgetContext` as
  `setCategoryLimitForSelectedMonth`/`setSavingsGoalAmountForSelectedMonth`. UI: category detail
  screen's limit editor and a new inline `GoalAmountInput` on the Budget tab both now edit
  *this month's* value only, with an "Applies from [Month] forward" hint so the behavior is
  visible, not a silent surprise.
  • **"Look at big budget apps and my app's look and feel should be like them... I don't need
  that minimal of an app"** — a real design pivot away from the earlier Apple-minimal work.
  Clarified direction via AskUserQuestion: picked **Bold & colorful (Mint/Monarch style)** over
  a dark/glassy Copilot look or a rounded/friendly YNAB look. Installed `expo-linear-gradient`.
  Rewrote `theme/colors.ts`'s `Theme` from `typeof light` to an explicit `interface` (needed
  because the light/dark gradient tuples otherwise inferred incompatible literal types — this
  broke `tsc` once mid-session, fixed by the explicit interface). Added gradient tuples
  (`heroPositive`/`heroNegative`/`heroNeutral` for the Surplus card by sign,
  `statSpent`/`statSaved`/`statDays` for the three stat tiles). Built a reusable `GradientCard`
  component. Flipped `CategoryIcon`, `TransactionRow`'s card badge, and every active filter/mode
  chip (Transactions, Budget, Settings, Setup wizard) from soft 14-16% tinted fills to **solid**
  color fills with white text — the bold-app look uses saturated color as a fill, not a tint.
  Verified gradients actually render (not just that `tsc` passes) by reading
  `getComputedStyle(el).backgroundImage` via `preview_eval` in the browser preview — confirmed real
  `linear-gradient(...)` CSS on the hero and all three stat tiles, each a distinct hue.
  • **"I am unable to enter transactions"** — real, previously-undiagnosed bug. Reproduced in the
  web preview: with zero cards (e.g. skipped the Cards step during onboarding), the Card section
  in `app/transaction/add.tsx` rendered empty and Save stayed silently disabled forever, no error
  shown. Fixed with an explicit "Add a card first" empty state + button straight to the Cards tab.
  This was almost certainly the owner's actual root cause.
  • **"Show me it matches what I provided in screenshots" + "make up the numbers and try
  importing it"** — the owner had shared (heavily redacted, numbers blurred) screenshots of their
  real household budget spreadsheet earlier and refused to ever share real data, only structure.
  Built `lib/particulars.ts` (pure, dependency-free parsing/categorization logic, testable outside
  the RN runtime) + wired it into `lib/csv.ts` as `importParticularsCsv` + a new "Import Monthly
  Log" button in Settings. Verified it actually works by writing a throwaway `tsx` test script
  against **fabricated** data shaped like the real sheet (`Rent+mortgage`, `Car EMI`, grocery-store
  vendor names, `Savings Transfer - Chase`, etc., with made-up dollar amounts) — this caught a real
  bug (an `ikea → Home` keyword rule pointing at a category name that no longer existed after an
  earlier rename) before it ever reached the UI. Also added two new default categories in response
  to gaps this surfaced: **Car Payment** (Car EMI was falling into generic "Other") and **Internet
  & Subscriptions** (Wifi/iCloud was lumped into Utilities) — both retrofit onto existing installs
  via `addPostLaunchCategoriesIfMissing()`, verified live that it appends without disturbing a
  user's existing categories.
  • **"Get it ready for TestFlight" / "push the new updates to TestFlight now"** — owner confirmed
  they already have an Apple Developer account and an EAS account (already logged in as
  `gauravchoukse22`, same account as the sibling Backstory project). Ran `eas init --force` to link
  a fresh EAS project (`@gauravchoukse22/Penny-Budget`), wrote `eas.json` build profiles, added
  `ios.buildNumber` + `infoPlist.ITSAppUsesNonExemptEncryption: false` to `app.json` (avoids an App
  Store Connect encryption-declaration prompt). **First build attempt failed non-interactively**
  (expected — first-time distribution cert creation needs live Apple 2FA, same friction documented
  in the Backstory project's history). Owner ran it themselves interactively and it succeeded —
  **build #1** `94a50614-2522-4715-83f8-8ae3f4178431` FINISHED. Auto-submit attempt failed on
  `Set ascAppId in the submit profile` (needs either a real interactive submit once, or the numeric
  App Store Connect app id manually added to `eas.json`) — owner said they ran `eas submit`
  themselves afterward but the outcome wasn't confirmed in this session. After the redesign +
  per-month budgets + Particulars importer work above, owner asked to push those updates too —
  **build #2** `2d78582c-da7f-4e7d-bb5b-b7cd3bf48a23` (buildNumber 3) kicked off and this time
  ran **fully non-interactively** (cert/profile already cached on EAS from build #1 — this
  confirms the pattern from Backstory's history: only entitlement-changing or first-time builds
  need interactive Apple auth). A background poll script was watching it and set to auto-submit on
  completion when the session ended — see the warning banner at the top of this file.
  • **Verified throughout:** `tsc --noEmit` clean after every change (caught two real bugs this
  way — the setup.tsx `theme` scope bug from the redesign, and the `Theme` type/`ikea` category
  bugs above). Every screen change re-checked live in the web preview via `preview_eval`/
  `preview_snapshot` DOM inspection (screenshot tool was unreliable/timed out all session — DOM
  inspection was the reliable substitute).

- **2026-07-08 (later) — card due-dates + savings transfer checklist, in response to the owner's
  real budget spreadsheet screenshots (numbers redacted, structure visible).** Owner explicitly
  won't share the real spreadsheet/numbers (privacy) — asked me to infer structure from the
  screenshots and ask questions instead of guessing. Clarified via AskUserQuestion: wants the
  **card due-date/bill-date table** and the **"transfers this month" checklist** built as real app
  features (not just a CSV importer), and confirmed their "Ideal" sheet is a template/reference,
  not the actual dated-transaction log — the real transaction log already maps cleanly onto the
  existing per-transaction model, no schema change needed there.
  • Added `billDay`/`dueDay` to the `cards` table via a self-healing migration (checks
  `PRAGMA table_info` and `ALTER TABLE` only if the columns are missing — existing installs/data
  are untouched). Added `daysUntilDue()` to `lib/queries.ts`. Card detail screen gets two new
  inputs (Statement day / Due day); Cards tab + card detail both show a "Due in N days" hint,
  red when ≤5 days out.
  • Added a `savings_goal_transfers` table + `listTransferStatus`/`setTransferStatus` queries,
  wired through `BudgetContext` as `transferStatus` + `setGoalTransferred`. Budget tab's Savings
  Goals section now has a per-goal checkbox mirroring the spreadsheet's monthly transfer checklist
  — purely a tracking/reminder feature, doesn't change the surplus calculation.
  • `tsc --noEmit` clean throughout; smoke-tested Budget and Cards tabs in the web preview after —
  no new console errors, existing cards/goals (which predate these columns) render correctly with
  the new fields defaulting to null/unset.
  • **Not done:** the owner said they'll never hand over the real spreadsheet or a real export —
  so there is no tested end-to-end CSV path for the "monthly totals per category" shape from their
  Expenses tab (only per-transaction CSV import exists, per §3). If that's still wanted, it needs
  either (a) the owner manually entering monthly totals as one transaction per category per month,
  or (b) a bespoke importer built against a real anonymized sample file, which the owner has
  declined to provide so far.

- **2026-07-08 — Apple-minimal redesign + SDK 54 downgrade.**
  • **Downgraded Expo 57 → 54** (owner reported hitting the same SDK-version issue as on another
  project and asked for SDK 54 specifically): `npx expo install expo@~54.0.0` then
  `npx expo install --fix` to bring every `expo-*` package + React/RN/TS back in line. Removed the
  `expo-status-bar` and `expo-sharing` entries from `app.json` `plugins` — neither package ships a
  config plugin on SDK 54, so their presence broke `expo config` outright with a `PluginError`.
  `npx expo` config resolution and `tsc --noEmit` both clean after.
  • **Full visual redesign** to an Apple-minimal style, referencing the sibling **Backstory**
  app's design-token approach (`~/every-year/src/theme/theme.ts`) as the quality bar: rewrote
  `theme/colors.ts` to add a confident indigo `accent`/`accentTint`, a `fieldBackground` token for
  inputs, and named `spacing`/`radius`/`type` scales (previously the theme was just a flat color
  object with no spacing/typography system). Rebuilt `CategoryIcon` to use soft **tinted** circles
  (14–16% opacity of the category color) instead of solid-fill icons — the same "soft tinted
  capsule" language Backstory uses. Softened `Surface`'s shadow (lower opacity, larger blur) and
  bumped its corner radius. Reworked `TransactionRow`'s card badge to a tinted chip. Tab bar now
  swaps outline/filled Ionicons per focus state and uses a hairline top border. Every screen
  (`(tabs)/index`, `transactions`, `budget`, `cards`, `insights`, `settings`,
  `transaction/add`, `transaction/[id]`, `category/[id]`, `card/[id]`, `setup`) was touched to
  route all colors/spacing/radii through the new tokens instead of hardcoded hex/px values, and
  every remaining "systemBlue" accent usage became the new `accent` token with tinted (not solid)
  backgrounds on chips/toggles for a calmer, more premium look.
  • **Bug caught mid-redesign:** a bulk find/replace script accidentally wrote
  `backgroundColor: theme.fieldBackground` into a top-level `StyleSheet.create()` object in
  `setup.tsx`, where `theme` isn't in scope (it's a hook value inside the component) — would have
  been a `ReferenceError` at module load. Caught via `tsc --noEmit` immediately after and fixed
  before it shipped anywhere.
  • **Default categories/savings goals now mirror a real household budget** (owner shared their
  actual Google Sheets budget as a reference): `DEFAULT_CATEGORIES` changed from a generic starter
  set to Mortgage/Utilities/Phone Service/Groceries/Dining/Gas/Clothing/Family-Baby/Other; added a
  new `DEFAULT_SAVINGS_GOALS` seed (Emergency Fund, Vacation, Home Repairs, Child/Education
  Savings, Miscellaneous Savings) + `seedDefaultSavingsGoalsIfEmpty()` in `lib/db.ts`, wired into
  `BudgetContext`'s startup effect alongside the existing category seed. Both seeds are no-ops if
  the respective table already has rows, so this only affects fresh installs.
  • **Verified:** `tsc --noEmit` clean; manually clicked through all 6 tabs in the web preview
  after each major change, checked console for new errors (found none beyond a pre-existing chart
  `transform-origin` SVG warning).
  • **Owner is about to import 2–3 years of real transaction history** via the existing CSV import
  path in Settings — confirmed the importer already supports arbitrary historical dates and
  explained the exact CSV shape / card-name-matching requirement (see §4.1, §3 "CSV
  import/export").
