# Google Play — copy/paste content + submission guide for Penny Budget

Everything below is ready to paste into the **Google Play Console**. Character
limits noted where Google enforces them. This is the Android counterpart to
`AppStoreListing.md`.

> **IMPORTANT — personal developer account:** Google requires new *personal*
> accounts to run a **closed test with ≥12 testers opted in for 14 continuous
> days** before production is unlocked. So the flow is: upload to **Closed
> testing** → recruit 12+ testers → wait 14 days → apply for production. See
> §Testers below.

> **IMPORTANT — Data Safety changed:** Unlike the old "no data collected" answer,
> the app now has **optional accounts + cloud backup**, so Data Safety MUST
> declare Email + Financial info as *optional* collection. See §Data Safety.

---

## 1. App details

| Field | Value |
|---|---|
| App name (30 max) | `Penny Budget` |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Category | Finance |
| Tags | budgeting, personal finance, expense tracker |

## 2. Short description (80 characters max)

```
Private budgeting — track spending, cards & savings goals, all on your phone.
```
(76 characters)

## 3. Full description (4000 characters max)

```
Penny Budget is a simple, private budgeting app that keeps every number on your device. Just you and your money.

TRACK SPENDING YOUR WAY
Log transactions by category and by card in seconds. See exactly where your money goes each month with clear breakdowns and progress bars for every budget category.

KNOW YOUR SURPLUS
Penny Budget shows you Salary minus Spending minus Savings, so you always know how much is really left over — not just what's in your checking account.

SET REAL SAVINGS GOALS
Create savings goals like an Emergency Fund, Vacation, or Home Repairs, assign a monthly target, and check off transfers as you make them. Watch your progress build month over month.

BUDGET BY MONTH, NOT JUST TODAY
Category limits and savings amounts are tracked per month, so adjusting this month's grocery budget never rewrites past months. Swipe between months to see your full history.

STAY ON TOP OF CARDS
Add your cards, track spend per card, and set billing/due dates so you always know when a payment is coming up.

SEE THE BIG PICTURE
Built-in insights show your 6-month spending trend, category breakdown, budget vs. actual, and surplus history — so you can spot patterns at a glance.

IMPORT & EXPORT
Bring in existing transaction history via CSV import, and export your data anytime. Your data is always yours.

PRIVATE BY DESIGN
Penny Budget stores everything locally on your device. There are no ads, no analytics, and no tracking. Optionally, you can create an account to back up and restore your budget to the cloud — completely optional, and the app works fully offline without one. You can delete your account and cloud backup from inside the app at any time.

Whether you're tracking a simple monthly budget or managing multiple cards and savings goals, Penny Budget keeps it fast, clear, and private.
```

## 4. Graphics required by Play

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | Derive from `assets/icon.png` |
| Feature graphic | 1024×500 PNG/JPG (no alpha) | **Needs to be made** — required to publish |
| Phone screenshots | 2–8, PNG/JPG, 16:9 or 9:16, min 320px | Capture Home, Budget, Insights, Add-transaction |
| (optional) Tablet screenshots | 7"/10" | Optional |

## 5. Privacy policy URL

```
https://gauravchoukse22-max.github.io/penny-budget/privacy.html
```

## 6. Data Safety form (App content → Data safety)

Because the app now offers optional accounts + cloud backup, answer:

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all of the user data collected by your app encrypted in transit?** → **Yes**
- **Do you provide a way for users to request that their data is deleted?** → **Yes** (in-app: Settings → Account → Delete Account)

Data types to declare (both **optional**, **collected**, **NOT shared**):

| Data type | Category | Collected? | Shared? | Optional? | Purpose |
|---|---|---|---|---|---|
| Email address | Personal info | Yes | No | Yes (only if user creates an account) | Account management, App functionality |
| Other financial info (budget/transaction data in a cloud backup) | Financial info | Yes | No | Yes (only if user turns on cloud backup) | App functionality (backup & restore) |

Do **not** declare: location, contacts, messages, photos, ads/marketing, or any
analytics — the app has none. If the user never creates an account, nothing is
collected.

## 7. Content rating (App content → Content ratings)

Answer **No / None** to every question (no violence, no sexual content, no
profanity, no controlled substances, no gambling, no user-generated content, no
data-sharing questions in this section). Result: **Everyone / PEGI 3**.

## 8. Target audience & content

- **Target age group:** 18 and over (a personal-finance utility; keeps the app
  out of the Families/Designed-for-Families program and its extra requirements).
- **Appeals to children?** No.

## 9. App access (App content → App access)

- **All functionality is available without special access** — the app is fully
  usable offline with no login. The account is optional and gates nothing, so no
  test credentials are needed. (If Play insists on credentials, note in the
  field: "Login is optional; all features work without an account.")

## 10. Ads

- **Does your app contain ads?** → **No.**

## 11. Government apps / financial features declaration

- Not a government app. It is a personal finance/budgeting tool but does **not**
  facilitate payments, trading, lending, or crypto — answer the financial-
  features declaration accordingly (no regulated financial services).

---

## Testers — meeting the 12-tester / 14-day requirement

1. In Play Console → **Testing → Closed testing**, create a track (e.g. "Beta").
2. Add testers by **email list** or a **Google Group** (a Group is easiest — you
   manage members without re-editing the track). Every tester needs a real
   Google account (the one on their Android device).
3. Share the **opt-in URL** Play generates; each tester must tap it, accept, and
   install from Play. They must stay opted in for 14 continuous days.
4. You need **≥12 testers who actually install**. Where to find them:
   - Friends/family with Android phones (fastest, most reliable).
   - Mutual-testing communities that exist specifically for this rule:
     r/googleplaytesting, r/TestMyApp, and several Discords where devs test each
     other's apps. (You test theirs, they test yours.)
   - Any small group you're part of (work, class, hobby) with Android users.
5. After 14 continuous days with ≥12 opted-in testers, Play shows **"Apply for
   production access"** on the dashboard. Submit it; once granted, promote the
   build to Production.

Bug-fix updates can be pushed to the **same closed track** throughout the 14
days without resetting the clock — so start the test as soon as the build is
ready, then ship fixes during the window.

## 12. Copyright

```
© 2026 Gaurav Choukse
```
