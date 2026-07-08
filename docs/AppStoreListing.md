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
Penny Budget is a simple, private budgeting app that keeps every number on your device — no accounts, no sign-in, no server. Just you and your money.

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
Bring in existing transaction history via CSV import, and export your data anytime. Your data is always yours.

PRIVATE BY DESIGN
Penny Budget stores everything locally on your device using on-device storage. There are no accounts, no ads, no analytics, and nothing is ever sent to a server.

Whether you're tracking a simple monthly budget or managing multiple cards and savings goals, Penny Budget keeps it fast, clear, and completely private.
```
(~1,550 characters — well under the limit)

## 5. Keywords (100 characters max, comma-separated, no spaces after commas)

```
budget,budgeting,expense,tracker,finance,savings,money,spending,personal finance,cards,surplus
```
(96 characters)

## 6. What's New in This Version (release notes, 4000 characters max)

```
- New app icon
- Fixed the keyboard covering fields when adding or editing a transaction
- Swipe left or right on the Home screen to move between months
```

## 7. Support URL

Use the support page from §9 below once hosted, e.g.:
```
https://<your-domain-or-github-pages>/penny-budget/support.html
```

## 8. Marketing URL (optional — leave blank if you don't have a landing page)

```

```

## 9. Privacy Policy

Full standalone page is in [PrivacyPolicy.md](PrivacyPolicy.md) — copy/paste it into whatever page
host you use (GitHub Pages, Notion public page, etc.), then put that page's URL into the Privacy
Policy URL field in App Store Connect.

## 10. App Privacy questionnaire (App Store Connect → App Privacy)

Since Penny Budget has no backend, no accounts, no analytics SDKs, and no ad SDKs, and all data
stays in on-device SQLite:

- **"Do you or your third-party partners collect data from this app?"** → **No, we do not collect
  data from this app.**

That single answer covers the whole questionnaire — you won't need to fill in the per-category
data-type table because nothing is collected.

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
