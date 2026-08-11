# ✅ DONE — 1.2.0 shipped 2026-08-11. Do not follow this file.

> **This walkthrough is finished and kept only as a record.** 1.2.0 went live on
> the App Store at 07:22 UTC on 2026-08-11 (verified against Apple's lookup API,
> App ID 6788635272).
>
> **For the KaiJar rename, follow `TODO.md` → "SUBMIT 1.3.0" instead**, with the
> paste blocks in `docs/AppStoreSubmission.md`. It is a much shorter list: App
> Privacy, the age rating, the URLs and the screenshots are all answered already
> and carry forward. Following the phases below would walk you back through
> first-submission work you have already done, using a build number that no
> longer exists.
>
> The one thing still worth reading here is **Phase 1**, the demo account note.

---

Every step is: **where to click**, then **what to paste**. Paste blocks are
fenced — copy the whole block, nothing outside it. Total time ~30 minutes,
and you can stop after any phase and pick up later.

---

## Phase 0 — Get build 23 into App Store Connect

*Skip this phase if you already uploaded 23 for your TestFlight test.*

1. Open **Xcode** → menu bar → **Window → Organizer**.
2. In the list, click the archive named exactly **PennyBudget 1.2.0 (23)**.
   (Several say "1.2.0 (n)" — go by the name, 23 is the one.)
3. Click **Distribute App** → **App Store Connect** → **Upload** → keep every
   default → **Upload**.
4. If Xcode asks to create a distribution certificate, say yes — that's
   expected on first upload.
5. Wait for "Upload Successful", then give Apple ~15 minutes to process it.
   You'll get an email when the build is ready.

---

## Phase 1 — Check the demo account still logs in (2 minutes)

You already created this one — **appreview@gary-labs.com** — and it's recorded
in `docs/AppStoreListing.md`. You do NOT need to make a new one.

The password is yours; it was deliberately never written into the repo. If you
don't have it to hand, it's in your password manager, or reset it from the app.

**Just confirm it works**, because Apple will actually try it:

1. In KaiJar on your phone: **Settings → Account**.
2. Sign out if you're signed in as yourself.
3. Sign in as `appreview@gary-labs.com`.
4. If it logs in, sign back out and switch to your own account. Done.

If it does NOT log in, reset the password from the sign-in screen and use the
new one in Phase 6.

---

## Phase 2 — Open the app in App Store Connect

1. Go to **appstoreconnect.apple.com** and sign in.
2. **My Apps → KaiJar**.
3. In the left sidebar under **iOS App**, click the **blue "+"** (or
   "+ Version or Platform") and create version:

```
1.2.0
```

---

## Phase 3 — App Privacy (left sidebar → App Privacy)

If it asks "Do you collect data from this app?" → **Yes**.

Add exactly **three** data types. For each one, when asked, answer:
**Linked to the user's identity: Yes · Used for tracking: No ·
Purpose: App Functionality.**

| Click "Add Data Type", then find | Under section |
|---|---|
| **Email Address** | Contact Info |
| **Other Financial Info** | Financial Info |
| **User ID** | Identifiers |

Nothing else — no Location, no Usage Data, no Diagnostics. The app has no
analytics or crash reporting, so declaring more would be false.

Click **Publish** (top right) when the section shows all three.

---

## Phase 4 — Age rating (on the 1.2.0 version page, "Age Rating" → Edit)

Answer **None** or **No** to every single question. Result shows **4+**.
Click **Done**.

---

## Phase 5 — The 1.2.0 version page (the big form)

Work top to bottom on the version page. Click **Save** (top right) often —
it never hurts.

### 5a. Screenshots

The files are on your Mac in `Developer/penny-budget/docs/store-screenshots/`.
In Finder you can drag all 8 at once into each slot, in name order (01 → 08):

- **iPhone 6.9" Display** slot ← drag the 8 files from `iphone-6.9/`
- **iPhone 6.5" Display** slot ← drag the 8 files from `iphone-6.5/`
- **iPad 13" Display** slot ← drag the 8 files from `ipad-13/`

### 5b. Promotional Text

```
New: unspent money rolls into next month, split one receipt across categories, a debt payoff planner, and your net worth over time. All on your phone — no bank login.
```

### 5c. Description (replace whatever is there)

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

### 5d. Keywords

```
budget,budgeting,money,expense,tracker,spending,bills,debt,net worth,envelope,statement,csv,family
```

### 5e. Support URL

*(Verified live 2026-08-04 — Apple does open these, and a dead one is a
rejection. This is the same URL `lib/legal.ts` uses, so the page a user opens
from inside the app is the page the store links to.)*

```
https://gary-labs.com/penny-budget/support/
```

### 5f. Marketing URL (optional field)

```
https://gary-labs.com/penny-budget/
```

### 5g. What's New in This Version

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

### 5h. Subtitle (under "General Information", if editable)

```
Budget from your statements
```

### 5i. Privacy Policy URL (App Information page, left sidebar — check it says)

*(Verified live 2026-08-04, and matches `PRIVACY_URL` in `lib/legal.ts`.)*

```
https://gary-labs.com/penny-budget/privacy/
```

---

## Phase 6 — Build, review notes, submit

Still on the 1.2.0 version page:

1. Scroll to the **Build** section → click **Add Build** (or the ⊕) →
   select **1.2.0 (23)** → **Done**.
   *(If no build appears, Apple is still processing — wait for the email.)*
2. Scroll to **App Review Information**:
   - **Sign-in required** → check the box. **User name:** `appreview@gary-labs.com`
     **Password:** the one you confirmed in Phase 1.
   - **Notes** — paste:

```
Signing in is OPTIONAL. KaiJar is fully usable with no account — a
reviewer can skip sign-in entirely and still exercise every budgeting feature.

The optional account (Settings → Account) enables cloud backup and Family
Sharing. Demo credentials are provided above if you wish to review those.

- Account deletion: Settings → Account → Security → Delete Account (removes the
  account and its cloud backup; on-device data is untouched).
- "Linked Banks" / Plaid is NOT enabled in this build.
- Statement import (Settings → Import Credit Card Statement) parses a PDF or CSV
  bank statement entirely on-device. Nothing is uploaded. Any bank's CSV export
  works if you wish to test it.
```

3. **Version Release** section → select **Manually release this version**.
   (You decide when it goes live after approval.)
4. Click **Save**, then **Add for Review** (top right), then on the summary
   page **Submit to App Review**.

---

## Done — what happens next

- Status becomes **Waiting for Review**, usually **In Review** within
  24–48 hours, then **Pending Developer Release** if approved.
- Apple emails you at every status change. When it says approved, open the
  version page and click **Release This Version** whenever you're ready.
- If it's rejected, don't reply to Apple — paste the rejection text to
  Claude and we'll fix it together. First submissions of big updates
  sometimes bounce once; it's routine, not a crisis.
