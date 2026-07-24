# App Store Connect — copy/paste content for Penny Budget

Everything below is ready to paste into App Store Connect. Character counts are noted where Apple
enforces limits.

---

## 1. App name

```
Penny Budget
```

## 2. Subtitle (30 characters max)

```
Simple, private budgeting
```
(25 characters)

## 3. Promotional text (170 characters max, editable anytime without a new review)

```
Track spending by category and card, set savings goals, and see your monthly surplus at a glance — all stored privately on your device.
```
(138 characters)

## 4. Description (4000 characters max)

```
Penny Budget is a simple, private budgeting app that keeps every number on your device by default. No ads, no analytics, no tracking. Just you and your money.

TRACK SPENDING YOUR WAY
Log transactions by category and by card in seconds. See exactly where your money goes each month with clear breakdowns and progress bars for every budget category.

KNOW YOUR SURPLUS
Penny Budget shows you Salary minus Spending minus Savings, so you always know how much is really left over — not just what's in your checking account.

SET REAL SAVINGS GOALS
Create savings goals like an Emergency Fund, Vacation, or Home Repairs, assign a monthly target, and check off transfers as you make them. Watch your progress build month over month.

BUDGET BY MONTH, NOT JUST TODAY
Category limits and savings amounts are tracked per month, so adjusting this month's grocery budget never rewrites what past months looked like. Swipe between months to see your full history.

STAY ON TOP OF CARDS
Add your cards, track spend per card, and set billing/due dates so you always know when a payment is coming up.

SEE THE BIG PICTURE
Built-in insights show your 6-month spending trend, category breakdown, budget vs. actual, and surplus history — so you can spot patterns at a glance.

IMPORT & EXPORT
Bring in existing transaction history from a CSV statement export, and export your data anytime. Every imported transaction is shown for you to review and confirm before anything is added — duplicates and recurring bills are flagged automatically. Your data is always yours.

OPTIONAL ACCOUNT — ONLY IF YOU WANT IT
Penny Budget works fully offline and you never have to sign in. If you want a backup or a second device, you can create an optional account with an email address or Sign in with Apple, then back up and restore on demand. Nothing is uploaded automatically or in the background.

SHARE A BUDGET WITH FAMILY
Optionally invite family to co-edit one shared household budget, so everyone sees the same numbers. Entirely opt-in, and you can leave at any time — the budget on your device keeps working offline.

PRIVATE BY DESIGN
Your budget lives in on-device storage. There are no ads, no analytics, and no tracking, ever. Cloud backup and family sharing are strictly opt-in, and you can delete your account and its cloud copy from inside the app at any time.

Whether you're tracking a simple monthly budget or managing multiple cards and savings goals, Penny Budget keeps it fast, clear, and private.
```
(~2,100 characters — well under the limit)

## 5. Keywords (100 characters max, comma-separated, no spaces after commas)

```
budget,budgeting,expense,tracker,finance,savings,money,spending,personal finance,cards,surplus
```
(96 characters)

## 6. What's New in This Version (release notes, 4000 characters max)

**For 1.1.0:**
```
Family sharing, accounts, and statement import.

- Share one budget with family — invite them with a code and everyone co-edits the same numbers
- Optional account with email or Sign in with Apple, so you can back up and restore your budget
- Sync your own budget across your devices with a single toggle
- Import a credit card or bank statement from a CSV export, with every row shown for review first
- Search transactions by amount, not just by name
- Delete your account and its cloud backup from inside the app at any time
- Fixes: statement import now opens correctly, and the Security screen no longer goes blank
```

**Previously (1.0.1, never released publicly):**
```
- New app icon
- Fixed the keyboard covering fields when adding or editing a transaction
- Swipe left or right on the Home screen to move between months
```

## 7. Support URL

Live and verified (HTTP 200):
```
https://gary-labs.com/penny-budget/support/
```
Use the gary-labs.com URLs, NOT the GitHub Pages copies — `lib/legal.ts` points the in-app links
there, and the store listing must match the document the app actually opens.

## 8. Marketing URL (optional — leave blank if you don't have a landing page)

```

```

## 9. Privacy Policy

Live and verified (HTTP 200) — use this URL in App Store Connect:
```
https://gary-labs.com/penny-budget/privacy/
```

This is the authoritative policy (last updated 23 July 2026). It correctly covers accounts, email,
household sharing, Supabase as processor, Sign in with Apple, retention, and in-app deletion — and
it states plainly that the store build **does not connect to your bank**.

Superseded copies that must NOT be used: `docs/PrivacyPolicy.md` (pre-accounts, false) and the
GitHub Pages `privacy.html` (a second, drifting copy of the same document).

## 10. App Privacy questionnaire (App Store Connect → App Privacy)

> **This section was wrong until 1.1.0 and would have caused a rejection.** It previously said "we
> do not collect data," which stopped being true the moment optional accounts and cloud backup
> shipped. Answer as below.

**"Do you or your third-party partners collect data from this app?"** → **Yes.**

Declare exactly these three, all as **App Functionality**, all **linked to the user's identity**,
and **none used for tracking**:

| Category | Data type | Why |
|---|---|---|
| Contact Info | Email Address | Optional account sign-up / Sign in with Apple |
| Financial Info | Other Financial Info | Cloud backup stores the budget snapshot; family sharing syncs it between members |
| Identifiers | User ID | Supabase auth user id, used to scope backups and household membership |

Notes for filling the form:
- "Used for tracking" is **No** for every item — there is no advertising, no analytics, no
  third-party SDK that tracks across apps.
- Data collection is **optional** — the app is fully usable offline without an account. App Store
  Connect lets you mark a data type as optional; do so where offered.
- **Linked Banks / Plaid:** only declare the bank-related flows if the feature is ENABLED in the
  submitted build. It is feature-flagged off in standard store builds — keep it off for 1.1.0
  (see the release checklist), and this table stays accurate as written.

## 11. Age Rating questionnaire

Answer **"No"** / **"None"** to every category (violence, mature themes, gambling, medical/legal
advice, etc.) — Penny Budget is a personal finance utility with no user-generated content, no web
browser, and no social features. This lands at **4+**.

## 12. Category

- **Primary category:** Finance
- **Secondary category (optional):** Productivity

## 13. Pricing & Availability

Your call — no content to draft here. Free is the natural default for a personal utility with no
backend costs.

## 14. Copyright

```
© 2026 Gaurav Choukse
```
