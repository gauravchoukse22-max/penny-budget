# App Store submission pack — 1.3.0 (build 26), the rename release

Everything to paste into App Store Connect, in the order the screens ask for it.
Audited against the code on 2026-08-04: no analytics SDK, no crash reporter, no
ads. The only network destinations in the entire app are the Supabase backend
(optional account/sync) and gary-labs.com (static pages). Data is on-device
unless the user turns on the optional account.

**1.2.0 is already live** (released 2026-08-11, App ID 6788635272). A live
version's name cannot be edited, so the rename ships as **1.3.0**: create the
new version in App Store Connect first, and the Name field unlocks.

---

## 0. The app name — do this first

App Store Connect → **App Information → Name**:

```
KaiJar: Budget Planner
```

(22 of 30 characters.)

**Why not just "KaiJar":** Apple weights the Name field more heavily than
anything else in search. "Penny Budget" was carrying the word *budget* for
free; "KaiJar" carries nothing. The descriptor after the colon buys that back.
This is the same shape as Spendee, PocketGuard and every other app in the
category.

It does **not** affect the home screen. The icon label comes from the binary
(`CFBundleDisplayName`), which is set to plain **KaiJar** — short where it has
to be short, descriptive where it has to be findable.

**Decided by Gary, 2026-08-11.** Not an open question — paste it as written.
Use the identical string on Google Play so the two listings match.

## 1. App Privacy (App Store Connect → App Privacy → Get Started)

**Do you collect data from this app?** → **Yes** (the optional account collects
email; sync stores budget data). Declaring "No" would be false the moment
anyone signs in.

Declare exactly these three, nothing else:

| Data type | Where ASC lists it | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Email Address | Contact Info | Yes | No | App Functionality |
| Other Financial Info | Financial Info | Yes | No | App Functionality |
| User ID | Identifiers | Yes | No | App Functionality |

- "Other Financial Info" covers the budgets/transactions that sync to the
  server when the user opts in. It is collected only with an account, but the
  label has no "conditional" option, so it must be declared.
- **Do NOT declare:** Location, Purchases, Browsing History, Usage Data,
  Diagnostics, Photos. There is no analytics or crash SDK, and receipts never
  leave the device (deliberate: they are excluded from cloud backup).
- **Tracking:** No. Nothing is shared with data brokers or used across apps.

## 2. Age rating questionnaire

Every answer is **None / No**:
no violence, no sexual content, no profanity, no drugs, no gambling
(simulated or real), no horror, no unrestricted web access, no user-generated
content shared publicly (household sharing is invite-only between two people).
Result: **4+**.

## 3. URLs

| Field | Value (all verified live, HTTP 200) |
|---|---|
| Support URL | https://gary-labs.com/penny-budget/support/ |
| Marketing URL | https://gary-labs.com/penny-budget/ |
| Privacy Policy URL | https://gary-labs.com/penny-budget/privacy/ |

## 4. Store listing copy

**Subtitle** (30 chars max):
`Budget from your statements`

**Promotional text** (170 chars, editable without review):
`Penny Budget is now KaiJar — same app, same data, nothing to re-do. Still free, still no bank login, still everything a $100-a-year budget app does from your statements.`
(167 chars. Leads with the rename on purpose: existing users arriving at the
listing need the reassurance in the first line, not buried in What's New.)

**Description:**

```
Everything a $100-a-year budget app does with your bank data — done from your
statements, on your phone, free.

KaiJar never asks for your bank login. Import a PDF or CSV statement
from any bank, review every transaction before it lands, and Penny learns
your merchants so the next import files itself.

BUDGET LIKE THE BIG APPS
• Give every dollar a job, and see what's left to spend at a glance
• Unspent money rolls into next month — a quiet month builds a buffer
• Overspending carries forward honestly, never swept under the rug
• Split one receipt across categories: one Costco run, three budgets

SEE WHERE IT ALL GOES
• The Money Map shows your whole month in one picture
• Net worth, tracked over time from balances you enter
• A debt payoff planner that shows what paying $50 extra actually saves
• Savings goals with real funded-by dates

SHARE WITH YOUR HOUSEHOLD
• One budget between two phones, no per-seat pricing
• Recurring bills post themselves and remind you the day before

PRIVATE BY DESIGN
• Your data stays on your device unless you turn on the optional account
• No ads, no analytics, no trackers — the privacy label speaks for itself
• Back up everything to a file you own, restore it anywhere

No subscriptions. No bank linking. No catch.
```

**Keywords** (100 chars max, no spaces after commas):
`budget,budgeting,money,expense,tracker,spending,bills,debt,net worth,envelope,statement,csv,family`
(98 chars)

**What's New in 1.3.0:**

```
Penny Budget is now KaiJar.

Same app, same person building it, same everything inside. If the icon on
your home screen looks different this morning, that is why — nothing has
been taken over.

Your data has not moved and nothing needs re-doing. Every transaction,
budget, card, savings goal and category is exactly where it was. You do not
need to sign in again, re-import a statement, or re-share your household —
the sharing code you already gave someone still works.

Why: there were a dozen or more apps called some version of "Penny Budget",
and being impossible to find in a search is a bad problem for an app you
open every day. KaiJar is ours alone.

The new icon is a jar filling up with coins, which is closer to what the app
actually does than a piggy bank was.
```

## 5. App Review notes (paste into "Notes" in the review section)

```
This version renames the app from "Penny Budget" to "KaiJar". Same developer
account, same bundle ID (com.gary.pennybudget), same app — the previous name
collided with a dozen other budgeting apps. The bundle ID is unchanged
deliberately, so this is an update to the existing app rather than a new one.

KaiJar works fully without an account — all budgeting features are
available immediately after onboarding with no sign-in.

The optional account (Settings → Account) only adds cloud backup and
household sync. Demo account for testing it:
  email: appreview@gary-labs.com
  password: [GARY: from your password manager — deliberately not in the repo]

Statement import (Settings → Import Credit Card Statement) parses a PDF or
CSV bank statement on-device. Nothing is uploaded. Any bank's CSV export
works if you wish to test it.

Account deletion is in Settings → Account → Security → Delete Account.
```

## 6. Remaining decisions

- **Pricing:** Free, all territories (matches the "free forever" positioning).
- **Release option:** choose **Manually release this version** — first release
  with the new distribution cert; release when you've smoke-tested the
  approved build.
- Export compliance is already answered in the binary
  (`ITSAppUsesNonExemptEncryption: false`) — ASC will not ask again.

## 7. Screenshots

`docs/store-screenshots/` — 8 per size, upload in numeric order:
- `iphone-6.9/` → the 6.9" slot (1290×2796) — REQUIRED
- `iphone-6.5/` → the 6.5" slot (1284×2778) — optional but done
- `ipad-13/` → the 13" iPad slot (2064×2752) — required because
  `supportsTablet` is true
