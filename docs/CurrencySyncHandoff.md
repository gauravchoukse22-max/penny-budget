# Currency sync — the two patches I could not apply

Everything else has landed: `shared_settings` exists, is synced, is journalled,
is backed up, and the Sharing screen explains and can change it. **None of it is
visible to the user until the two patches below are applied**, because the app
reads its currency from `lib/queries.getAppSettings`, and the picker that sets it
lives in `app/(tabs)/settings.tsx`. Both files were owned by another agent while
I worked, so I left them alone rather than collide with concurrent edits.

Apply patch 1 to make it work. Patch 2 is copy only, and should go in with it —
without it the picker changes a currency for two people while looking like it
changes one.

---

## Patch 1 — `lib/queries.ts` (required; nothing works without it)

### 1a. Add the import

Right under the existing `reconcileSavingsGoalEntries` import near the top:

```ts
// One-way edge: features/funds.ts owns every fund_entries write (and its
// journaling) and imports nothing from here, so this cannot become a cycle.
import { reconcileSavingsGoalEntries } from '../features/funds';
```

**add:**

```ts
// Same one-way edge: features/shared-settings.ts reads app_settings straight
// from the database rather than through getAppSettings, precisely so importing
// it here cannot become a cycle.
import { resolveDisplayCurrency, setSharedCurrency } from '../features/shared-settings';
```

### 1b. Split `getAppSettings` into a local read and a resolved read

**Current code** (`lib/queries.ts`, under `// ---------- Settings ----------`):

```ts
export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
```

…through its closing brace:

```ts
    insightsLayout: row?.insightsLayout ?? null,
    watchedCategories: row?.watchedCategories ?? null,
  };
}
```

**Replace the whole function with:**

```ts
/**
 * This device's OWN settings row, exactly as stored — nothing resolved.
 *
 * The write path must use this, not getAppSettings: getAppSettings hands back
 * the household's currency when there is one, and updateAppSettings writes the
 * whole row back, so reading the resolved value there would quietly overwrite
 * this device's own preference with the shared one. It would then be gone for
 * good — the value the user gets back when they leave the household.
 */
export async function getLocalAppSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    currency: string;
    salaryMode: 'fixed' | 'variable';
    fixedSalary: number;
    onboarded: number;
    biometricLock: number;
    cloudSyncEnabled: number;
    autoLockGraceMinutes: number;
    hideAmounts: number;
    householdId: string | null;
    insightsLayout: string | null;
    watchedCategories: string | null;
  }>('SELECT currency, salaryMode, fixedSalary, onboarded, biometricLock, cloudSyncEnabled, autoLockGraceMinutes, hideAmounts, householdId, insightsLayout, watchedCategories FROM app_settings WHERE id = 1');
  return {
    currency: row?.currency ?? 'USD',
    salaryMode: row?.salaryMode ?? 'fixed',
    fixedSalary: row?.fixedSalary ?? 0,
    onboarded: !!row?.onboarded,
    biometricLock: !!row?.biometricLock,
    cloudSyncEnabled: !!row?.cloudSyncEnabled,
    autoLockGraceMinutes: row?.autoLockGraceMinutes ?? 1,
    hideAmounts: !!row?.hideAmounts,
    householdId: row?.householdId ?? null,
    insightsLayout: row?.insightsLayout ?? null,
    watchedCategories: row?.watchedCategories ?? null,
  };
}

/**
 * The settings the APP should render with.
 *
 * Identical to the stored row except for the currency, which is a property of
 * the BUDGET rather than of the phone — exactly the argument made on
 * resolveSalaryForMonth below, and the same fix. app_settings deliberately never
 * syncs (it also holds the biometric lock and the household id), so a household
 * takes its currency from the shared record whenever one exists and two members
 * stop seeing $6,000 and £6,000 for the same number. With no household this is
 * a passthrough and a solo user is completely unaffected.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const local = await getLocalAppSettings();
  return { ...local, currency: await resolveDisplayCurrency(local.currency, local.householdId) };
}
```

### 1c. Make `updateAppSettings` read local, and mirror the currency

**Current code:**

```ts
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const db = await getDb();
  const current = await getAppSettings();
  const next = { ...current, ...patch };
```

**Replace those four lines with:**

```ts
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const db = await getDb();
  // getLocalAppSettings, NOT getAppSettings — see the note on it. Reading the
  // resolved currency here would write the household's value over this device's
  // own on the next unrelated settings change.
  const current = await getLocalAppSettings();
  const next = { ...current, ...patch };
```

Then, at the **end** of the same function, immediately after the existing
`setMonthlySalary` mirror:

```ts
  if (next.householdId && next.salaryMode === 'fixed' && patch.fixedSalary !== undefined) {
    await setMonthlySalary(currentYearMonth(), next.fixedSalary);
  }
```

**add:**

```ts
  // Mirror the currency into the shared record, exactly as the salary above is
  // mirrored and for the same reason: it labels numbers BOTH members read, so
  // one phone changing it and the other not is the two of them disagreeing
  // about what the same figure means.
  //
  // Guarded on `patch.currency !== undefined` rather than on the value: this
  // must fire only when the user actually picked a currency. Firing on every
  // settings write would let a device that had merely joined push its own value
  // over the household's the next time anything at all changed — the silent
  // rewrite the join path deliberately refuses to do.
  if (next.householdId && patch.currency !== undefined) {
    await setSharedCurrency(next.householdId, next.currency);
  }
```

### After applying, verify

```
npx tsc --noEmit
```

```
node scripts/test-shared-settings.mjs
```

---

## Patch 2 — `app/(tabs)/settings.tsx` (copy only, but ship it with patch 1)

Once patch 1 lands, tapping a currency in this picker changes it **for everyone
in the shared budget**. The sheet currently only says it does not convert
anything. Someone changing "my" currency and silently restating their partner's
budget is the same class of surprise this whole change exists to remove.

Two changes, both inside the currency `Modal`.

### 2a. The hint under the title

**Current:**

```tsx
          <Text style={[styles.hint, { color: theme.tertiaryLabel, marginBottom: spacing.md }]}>
            Changes only the display symbol — does not convert historical amounts.
          </Text>
```

**Replace with:**

```tsx
          <Text style={[styles.hint, { color: theme.tertiaryLabel, marginBottom: spacing.md }]}>
            {settings.householdId
              ? 'Changes only the display symbol — does not convert historical amounts. Currency is part of the shared budget, so this changes it for everyone in it.'
              : 'Changes only the display symbol — does not convert historical amounts.'}
          </Text>
```

### 2b. Confirm before changing it for someone else

**Current:**

```tsx
                  onPress={async () => {
                    await updateSettings({ currency: cur });
                    setPickingCurrency(false);
                  }}
```

**Replace with:**

```tsx
                  onPress={async () => {
                    // A confirmation ONLY when someone else is affected. Adding
                    // one for a solo user would be a dialog in front of a
                    // preference, which teaches people to tap through dialogs.
                    if (settings.householdId && cur !== settings.currency) {
                      const ok = await confirmAction({
                        title: `Show this budget in ${cur}?`,
                        message: `Everyone in this shared budget sees amounts in ${cur} from now on, not just this device. Nothing is converted — the numbers stay exactly as they are and only the symbol changes.`,
                        confirmLabel: `Use ${cur}`,
                      });
                      if (!ok) return;
                    }
                    await updateSettings({ currency: cur });
                    setPickingCurrency(false);
                  }}
```

`confirmAction` needs importing if it is not already in this file:

```ts
import { confirmAction } from '../../lib/confirm';
```

---

## What is already done, for reference

| Piece | Where |
| --- | --- |
| Table `shared_settings`, key/value, derived id `shs-<householdId>-<key>` | `features/db-migrations.ts` |
| `SYNCABLE_TABLES` entry (older builds skip it on pull, they do not throw) | `features/cloudkit-sync.ts` |
| Read/resolve/write + the join decision, all commented | `features/shared-settings.ts` |
| Seeds the shared currency when a household is CREATED, never when joined | `features/household.ts` (`seedHouseholdFromLocal`) |
| Tells the user what happened, and the "use mine for everyone" button | `app/household/index.tsx` |
| Backed up, gated at `BACKUP_VERSION` 6 like splits, so an older file leaves it alone | `features/backup-restore.ts` |
| 40 assertions incl. the resolution rule and the wording | `scripts/test-shared-settings.mjs` |

**The rule, in one line:** with a household active the shared record wins; with
no household the local `app_settings` value is used, so solo users are untouched.

**The join decision:** the household's currency wins and the joiner is told;
joining never writes. Reasoning is in the block comment on
`seedSharedSettingsForNewHousehold` in `features/shared-settings.ts`.
