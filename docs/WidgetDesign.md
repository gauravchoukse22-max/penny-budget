# Penny Budget — Home-Screen Widget Design & Feasibility

*Written 2026-08-03. Design + feasibility only — no code changes. Companion files referenced:
`lib/queries.ts` (computeSurplus, resolveSalary), `app/(tabs)/` routes, `PREBUILD_NOTES.md`,
`app.json` (scheme `pennybudget`, bundle `com.gary.pennybudget`).*

---

## 0. What the competition ships (brief research, 2026)

| App | Widgets | What reviewers praise |
|---|---|---|
| **Copilot Money** | iOS home-screen spending widget + lock-screen widgets, Apple Watch glances | "Budget status at a glance", native feel. Weakness noted in reviews: widget needs a live bank connection to show fresh data — Penny Budget's on-device data avoids this entirely. |
| **Monarch** | Lock-screen widget reflecting budget categories; **no home-screen widgets** on either platform | Reviews knock the widget for updating "less aggressively" — stale data with no honesty marker. |
| **YNAB** | Lock-screen widget showing "ready to assign" / a category balance; no home-screen widget | Praised for fitting the method (one number that drives behaviour), knocked for being confusing without context. |

Takeaways that shaped this design:
1. **One number wins.** Every praised widget is "the number that tells me if I can spend."
   For Penny Budget that number is **surplus ("left to spend")** — already computed as
   `salary − spend − transferred savings` in `computeSurplus()`.
2. **Staleness is the #1 review complaint.** Widgets must carry an honest "as of" stamp,
   because our data only refreshes when the app opens.
3. **There is an open gap**: none of the big three ships a good *medium* home-screen widget.
   Sources: useorigin.com widget roundup 2026, getfinny.app lock-screen widget roundup 2026,
   help.monarch.com "Using Mobile Widgets", copilot.money.

---

## 1. Widget set (the design)

All amounts respect the in-app `hideAmounts` setting (show `•••` when on).
All widgets share one data source: a JSON snapshot the app writes on every foreground/refresh
(see §2.3). `asOf` in that snapshot drives every stale state below.

**Currency symbol comes from the snapshot** (`app_settings.currency`), never hardcoded.

### W1 — "Left to Spend" (small) ⭐ SHIP FIRST
- **iOS size:** systemSmall. **Android:** 2×2 AppWidget.
- **Shows:**
  - Top row: app glyph + month name ("Aug").
  - Center, dominant: surplus amount (e.g. `₹18,450`), tinted green when ≥ 0, the app's
    red/danger colour when < 0 (label flips to "Over by").
  - Below: thin progress bar = spend ÷ (salary − savings), same green→amber→red ramp the
    Home screen uses.
  - Bottom line, small: `"12 days left · as of 7:40 AM"`.
- **Tap target:** whole widget → `pennybudget://` (Home tab — it already leads with this number).
- **Refresh:** snapshot rewritten on every app foreground + after every transaction save;
  WidgetKit timeline asks for a re-render at local midnight so "days left" and the date
  stay honest even without an app open. Android: `updatePeriodMillis` minimum (30 min) is
  wasteful and unnecessary — update on snapshot write + a midnight `AlarmManager`-free
  approach: schedule next update via `WorkManager` daily.
- **Empty state:** onboarding not done or no salary for month → "Set up your month" + arrow,
  taps to `pennybudget://` (Home shows the setup prompt).
- **Stale state:** `asOf` > 48 h old → keep the number but render the "as of" line in the
  warning colour: `"as of Fri — open to refresh"`. Never hide the number; never lie about age.

### W2 — "Month at a Glance" (medium)
- **iOS:** systemMedium. **Android:** 4×2.
- **Shows:** left half = W1 content (surplus + bar + days left). Right half = 3 rows:
  `Spent  ₹41,550` / `Saved  ₹10,000` / `Salary  ₹70,000` — the exact fields of
  `computeSurplus()`. Footer: as-of stamp spanning the width.
- **Tap targets (iOS medium allows multiple `Link` areas):** left half → Home;
  each right-half row → `pennybudget://budget`. Android: two `PendingIntent` zones, same links.
- **Refresh / empty / stale:** same as W1.

### W3 — "Top Categories" (medium)
- **iOS:** systemMedium. **Android:** 4×2.
- **Shows:** the 4 categories nearest/over budget this month, one row each:
  emoji/initial, name, mini progress bar, `spent / budget` (e.g. `₹5,200 / ₹6,000`).
  Ordering: over-budget first, then highest % used. Footer: as-of stamp.
- **Tap:** row → `pennybudget://category/<id>`; anywhere else → `pennybudget://budget`.
- **Empty:** no category budgets set → "Add category budgets" → `pennybudget://budget`.
- **Stale:** same 48 h rule as W1.

### W4 — "Card Due" (small)
- **iOS:** systemSmall. **Android:** 2×2.
- **Shows:** the card with the **soonest upcoming `dueDay`** (field exists on the card model):
  card name, this-month spend on it, and `"Due in 4 days"` — bold/red when ≤ 3 days.
  If no card has a due day: falls back to total card spend this month.
- **Tap:** → `pennybudget://card/<id>` (route exists: `app/card/[id].tsx`).
- **Refresh:** snapshot writes + daily midnight re-render (the countdown must tick without
  app opens — this is pure date math on data already in the snapshot, so it stays honest).
- **Empty:** no cards → hide behind "Add a card" → `pennybudget://cards`.

### W5 — Lock screen: "Left to Spend" (iOS accessory pair)
- **accessoryCircular:** ring gauge = % of spendable remaining, surplus amount (compact,
  e.g. `18.4K`) centered. Monochrome-safe (lock screen tints everything).
- **accessoryRectangular:** line 1 `Left to spend`, line 2 amount, line 3 `12 days · Aug`.
- **Tap:** opens app to Home. **Refresh/empty/stale:** as W1; on stale, circular shows the
  amount without the ring (a full-looking stale ring is a lie).
- **Android equivalent:** none 1:1 — skip; W1 at 2×2 covers the glanceable case.

*(W6 deliberately not proposed: a "recent transactions" list widget is the weakest of the
candidates — it duplicates the notification shade's mental slot, leaks the most sensitive
data to shoulder-surfers, and none of the benchmark apps ship one.)*

**Ship first: W1.** It is the app's core promise in one number, it is what Copilot/YNAB
reviews praise, it needs only 5 fields, and small-size is the least layout work.

---

## 2. Feasibility on this exact stack (researched, not guessed)

Ground truth about this repo that decides everything:
- `ios/` and `android/` are **checked in and hand-wired**; `expo prebuild` is never run
  casually (PREBUILD_NOTES.md documents prebuild as a deliberate one-way door).
- Builds are local Xcode archives and local Gradle. No EAS, ever.
- Expo SDK 54 pinned.

### 2.1 iOS paths

| Path | How it works | Fit here | Effort |
|---|---|---|---|
| **A. Hand-add WidgetKit target in Xcode** | File → New → Target → Widget Extension in `PennyBudget.xcworkspace`; SwiftUI view + `TimelineProvider`; commit the target into the checked-in `ios/` | **Best fit.** The usual objection — "prebuild wipes it" — does not apply, because this repo treats `ios/` as source and never regenerates it. If a future deliberate prebuild happens (SQLCipher plan), the target's files live in `ios/PennyBudgetWidget/` and re-adding the target to a regenerated project is a documented 15-minute step — add that note to PREBUILD_NOTES.md when built. | **Small-medium.** ~1 day incl. App Group + snapshot reader + one SwiftUI layout. |
| **B. `@bacons/apple-targets` config plugin** | Widget code in `targets/widget/`, plugin wires it during `npx expo prebuild --clean` | **Wrong fit.** Its whole value is surviving prebuild regeneration — a workflow this repo doesn't use. It *requires* running `prebuild --clean`, exactly what PREBUILD_NOTES.md gates. Its own README warns of Swift-compiler/SwiftUI-preview issues from RN build complexity. Adopting it means re-validating the entire hand-wired `ios/`. | Medium, plus workflow risk. |
| **C. `expo-widgets` (new Expo SDK module)** | Official Expo widgets support exists in current docs ("latest") | Not for us yet: repo is pinned to SDK 54 per AGENTS.md; adopting means an SDK story change. Re-evaluate at next SDK upgrade. | N/A now. |

**Pick: A.** Hand-add the target; it matches how every other native thing in this repo is wired.

### 2.2 iOS data sharing: snapshot vs SQLite

| Option | Verdict |
|---|---|
| **App Group + JSON snapshot** (RN writes `group.com.gary.pennybudget/widget-snapshot.json` on every refresh; Swift `Codable` reads it) | **Pick this.** ~30 lines each side. The widget needs derived numbers (`computeSurplus` output), not tables. Snapshot writing lives next to the existing "recompute on foreground" path. Works unchanged if SQLCipher lands later (the DB becomes unreadable to Swift; a JSON snapshot of non-secret derived numbers keeps working — note: the snapshot itself is plaintext in the App Group container, same exposure class as today's plaintext DB, so it doesn't worsen the current posture, but revisit when SQLCipher ships). |
| **Read SQLite directly from Swift** | Rejected: duplicates `computeSurplus`/`resolveSalary` logic in Swift (two implementations of the app's most important number **will** drift — see AGENTS.md's history of silent divergence), needs the DB moved into the App Group container (a migration for every existing install), and breaks outright under the planned SQLCipher. |

Writer: `expo-file-system` cannot write to App Group containers on SDK 54; use a ~40-line
local Expo Module (Swift: `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`
+ `WidgetCenter.shared.reloadAllTimelines()`). Local expo-modules are already a known
pattern in Gary's projects (Kaibolo's ML Kit patch).

### 2.3 Snapshot schema (v1)

```json
{
  "v": 1,
  "asOf": "2026-08-03T07:40:11Z",
  "yearMonth": "2026-08",
  "currency": "INR",
  "hideAmounts": false,
  "daysLeftInMonth": 28,
  "salary": 70000, "spend": 41550, "savings": 10000, "surplus": 18450,
  "categories": [{ "id": "…", "name": "Dining", "emoji": "🍜", "budget": 6000, "spend": 5200 }],
  "cards": [{ "id": "…", "name": "HDFC", "dueDay": 7, "monthSpend": 12300 }]
}
```
Only W1 fields are *required* in v1; `categories`/`cards` may be empty arrays until W3/W4 ship.

### 2.4 Android

- **Renderer:** classic `AppWidgetProvider` + `RemoteViews` (XML), hand-wired into the
  checked-in `android/` — matches path A's philosophy. **Glance** is nicer (Compose-style)
  but pulls Compose runtime deps into a non-Compose app; not worth it for W1's layout.
  Community options exist (`react-native-android-widget` has an Expo plugin; an experimental
  `expo-android-glance-widget` plugin exists) but both assume prebuild-managed native dirs —
  same wrong fit as path B.
- **Data:** the same JSON snapshot written to app-private storage
  (`context.filesDir/widget-snapshot.json`, or SharedPreferences holding the JSON string).
  No App Group concept needed — widget code runs in the app's own process/sandbox.
  After writing, the RN side pings a tiny native module that calls
  `AppWidgetManager.notifyAppWidgetViewDataChanged`/`updateAppWidget`.
- **Effort:** small-medium (~1 day for W1) — no provisioning, no signing changes
  (widget is part of the same APK/AAB, same keystore at `~/keystores`).

### 2.5 Effort tiers, summarized

| Piece | Tier |
|---|---|
| iOS W1 (target + App Group + snapshot module + SwiftUI) | Medium (first native target this repo has added) |
| Each additional iOS widget after W1 | Small |
| Lock-screen pair W5 | Small (same extension, two more families) |
| Android W1 (`AppWidgetProvider` + XML + snapshot) | Small-medium |
| Bacons-plugin route | Medium + workflow risk — **not chosen** |

---

## 3. Risks

1. **App Group provisioning — OWNER ACTION (Gary).** The App Group
   (`group.com.gary.pennybudget`) must be created in the Apple Developer portal
   (Identifiers → App Groups) and enabled on **both** the app ID and the new widget-extension
   app ID. With Xcode automatic signing this is mostly clicks inside Xcode's
   Signing & Capabilities tab, but it needs Gary's Apple ID logged in. Until done, the
   widget builds but reads nothing. This goes on Gary's to-do list when work starts.
2. **Second target vs the manual archive workflow.**
   - The extension has its **own bundle id** (`com.gary.pennybudget.widget`) and its own
     `CFBundleShortVersionString`/`CFBundleVersion`, and App Store Connect **rejects the
     upload if they don't match the app's** (ITMS-90473-class errors). Build numbers are
     already manual here (currently iOS build 18 in app.json) — the bump must now touch
     **two** Info.plists, or better: set the widget's version/build to `$(MARKETING_VERSION)` /
     `$(CURRENT_PROJECT_VERSION)` at the project level so one bump covers both.
     Add this to `docs/ReleaseChecklist.md` when built.
   - The stale-archive trap in TODO.md ("check for same-numbered archives") now has a second
     way to bite: an archive whose *extension* build number mismatches fails **at upload
     time**, after the whole archive. Same mitigation: the PlistBuddy pre-upload check,
     extended to the extension's plist inside the archive.
   - New extension = new provisioning profile; with automatic signing Xcode handles it,
     but the first archive after adding the target will prompt for it — do that first
     archive well before an intended upload day.
3. **Snapshot schema drift.** If the RN writer changes a field and the Swift/Kotlin readers
   don't, widgets show wrong numbers silently — the exact failure class AGENTS.md warns
   about for sync. Mitigations, all cheap:
   - `"v": 1` version field; readers that see an unknown `v` or a failed decode show the
     **stale/empty state, never a partial number**.
   - Readers decode defensively (all fields optional, required-set checked explicitly).
   - One TS type (`types/widget-snapshot.ts`) is the single documented source of truth;
     the Swift `Codable` and Kotlin data class each carry a comment pointing at it.
   - A fixture test on the RN side pins the emitted JSON, so any writer change is a visible
     diff in review.
4. **Honesty risk: stale-but-confident widgets.** Mitigated by design (as-of stamp is a
   required element of every widget, 48 h warning state), but it must survive design polish —
   removing the stamp to look cleaner recreates Monarch's top widget complaint.
5. **`hideAmounts` leak.** The widget renders on a lock-screen-adjacent surface; snapshot
   carries the flag and every renderer must honour it. Test with the flag on before shipping.

---

## 4. Phased plan

**Phase 1 — W1 "Left to Spend", iOS only, smallest scope.**
1. TS: `types/widget-snapshot.ts` + `writeWidgetSnapshot()` called from the existing
   app-foreground/refresh path and after transaction saves (v1 fields only, no
   categories/cards arrays).
2. Local Expo module (Swift): write JSON into the App Group container + reload timelines.
3. Xcode: add Widget Extension target `PennyBudgetWidget` (systemSmall only), App Group
   capability on both targets, versions tied to project-level build settings.
4. **Gary:** App Group in the developer portal / Signing & Capabilities (owner action).
5. Verify on simulator: fresh data, empty state (new install), stale state (fake old `asOf`),
   `hideAmounts` on, tap-through to Home.
6. Update `PREBUILD_NOTES.md` (re-add-target recipe) and `docs/ReleaseChecklist.md`
   (two-plist build-number check).

**Phase 2 — Android W1** (`AppWidgetProvider` 2×2, same snapshot; no owner actions).
**Phase 3 — iOS lock-screen pair (W5)** — same extension, two more families, small.
**Phase 4 — W2 medium, then W3/W4** — extend snapshot with `categories`/`cards`
(bump to `"v": 2`; v1 readers unaffected because W1 fields are unchanged).

Each phase ships independently; a phase that stalls leaves nothing half-wired.
