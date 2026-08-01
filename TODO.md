# Penny Budget — running to-do

The single source of truth for outstanding work. Read this at the start of every
session, before planning anything. Update it as items land — a finished item gets
deleted, not ticked, so this file stays short enough to actually read.

Two lists on purpose: **Gary only** is things nobody else can do (passwords,
Apple ID, dashboards he is logged into). Everything else is Claude's.

---

## Gary only

- [ ] **Upload the current build to TestFlight.** Xcode Organizer → Distribute App
      → App Store Connect → Upload. Needs his Apple ID, so it can never be automated.
- [ ] **Android: run the 14-day closed test** with ~12 testers, then apply for
      production access. Google gates production on this for personal accounts.
- [ ] **Play listing**: Data safety, content rating, store listing copy and
      graphics. Drafts are in `~/Developer/penny-budget-builds/`.

## Claude

### Next
- [ ] **Month switcher on every bottom-tab screen.** Gary wants to move between
      months from anywhere and see what he did last month. Home, Budget and
      Insights already read `selectedMonth` from BudgetContext; **Transactions and
      Cards do not reference it at all**, so those two need month scoping as well
      as a control, not just a header. Use one shared component so the control
      cannot drift between tabs, and keep it out of Settings.
- [ ] **`features/bulk-actions.ts` journals nothing.** All three of
      `bulkUpdateCategory`, `bulkUpdateCard` and `bulkDeleteTransactions` write
      straight to SQLite with no `queueSyncMutation`, so every bulk edit made
      from the Transactions tab's select mode stays on one phone. Pre-existing,
      and exactly the class of silent divergence AGENTS.md §2 warns about.
- [ ] Build iOS + Android, and hand Gary the upload steps.
- [ ] **Disha rejoins with Replace** — the flow exists now; walk them through it.
      That is what clears her duplicate categories and cards in one action. She
      should back up first (Settings → Backup), since Replace discards whatever
      is only on her phone.

### Known gaps, not yet built
- [ ] **Currency does not sync.** Household members with different currencies see
      mismatched symbols on the same numbers. Needs a shared settings record;
      `app_settings` deliberately never syncs because it also holds device-local
      state (biometric lock, household id).
- [ ] **A truncated v3 backup file would still wipe Funds.** Restore trusts the
      declared format version; a file claiming v3 without a `funds` key clears the
      grid. Needs validation, not the key-presence guess that was rejected.
- [ ] **`assets` and `liabilities` tables** exist in migrations, are read by nothing,
      and are absent from backups. Either use them or drop them before they bite.
- [ ] **`expo-system-ui` is not installed**, so `userInterfaceStyle: automatic`
      does not fully apply light/dark on Android.

### Verified only by typecheck, never run on a device
These are real risks, not paperwork. Each changed behaviour no agent could observe.
- [ ] **The seeded Cash card.** `features/db-migrations.ts` seeds it once per
      install at the well-known id `penny-cash-card`, stamped in
      `app_settings.cashCardSeededAt`. Check on Gary's phone AND Disha's that
      exactly ONE Cash card appears after a sync — a second one would mean the
      fixed id is not doing its job, which is the duplicate-cards bug again.
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
bump alone is rejected once a version is approved. **Android 1.2.0 vc7** is built
but not uploaded. Everything committed after build 12 — the sharing rework, tap
targets, swipe-to-delete, the savings→funds link, Funds moving under Budget — is
**not in any build the user has**.

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
