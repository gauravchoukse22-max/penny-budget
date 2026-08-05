# App Store submission pack — 1.2.0 (build 23)

Everything to paste into App Store Connect, in the order the screens ask for it.
Audited against the code on 2026-08-04: no analytics SDK, no crash reporter, no
ads. The only network destinations in the entire app are the Supabase backend
(optional account/sync) and gary-labs.com (static pages). Data is on-device
unless the user turns on the optional account.

---

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
`New: unspent money rolls into next month, split one receipt across categories, a debt payoff planner, and your net worth over time. All on your phone — no bank login.`

**Description:**

```
Everything a $100-a-year budget app does with your bank data — done from your
statements, on your phone, free.

Penny Budget never asks for your bank login. Import a PDF or CSV statement
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

**What's New in 1.2.0:**

```
The biggest update yet:
• Unspent money now rolls into next month (turn it on per category)
• Split one transaction across several categories
• Debt payoff planner — see what paying extra actually saves
• Net worth, now with a trend over time
• Goal target dates: "funded by March at $200/mo"
• Statement import learns your merchants and can bulk-assign categories
• Tags, a refund tracker, and receipt attachments
• A cleaner look on every screen, in light and dark
```

## 5. App Review notes (paste into "Notes" in the review section)

```
Penny Budget works fully without an account — all budgeting features are
available immediately after onboarding with no sign-in.

The optional account (Settings → Account) only adds cloud backup and
household sync. Demo account for testing it:
  email: [GARY: create a demo account in the app and paste it here]
  password: [GARY]

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
