// Settings that belong to the BUDGET rather than to the phone.
//
// `app_settings` deliberately never syncs, because the same row also holds
// device-local state: the biometric lock, the auto-lock grace, which household
// this device is on, the insights layout, the watched categories. Syncing that
// row would push one phone's lock setting onto the other's. But a handful of
// its columns are not about the phone at all — they describe the shared budget,
// and when two members disagree about one of them the SAME numbers read
// differently on the two devices. Currency is the sharpest case: Gary sees
// $6,000 and Disha sees £6,000 for the identical budget.
//
// The precedent is `monthly_settings` and `resolveSalaryForMonth` in
// lib/queries.ts: a genuinely shared, synced record that WINS over the local
// value whenever a household is active. This table is the same idea generalised
// so the next such setting does not need another table.
//
// ── Why key/value rows instead of one wide row per household ────────────────
// A wide row (`shared_settings(householdId, currency, weekStart, …)`) was the
// first design and was rejected. Adding the second setting to it means ALTER
// TABLE, and the moment one member is on the newer build their payload carries
// a column the older build's table does not have — `INSERT OR REPLACE` then
// throws INSIDE the pull transaction and stalls that member's sync entirely.
// That is the exact hazard already documented on `savings_goals.targetFundId`
// in features/db-migrations.ts. With key/value rows a new setting is a new KEY:
// an older build stores the row, does not recognise the key, and ignores it.
// Inert data beats a schema error. The cost is that the column types are not
// checked by SQLite, so every read goes through a validator below.
//
// ── Why the id is derived ───────────────────────────────────────────────────
// AGENTS.md rule 2: ids two devices generate independently must be derived.
// Both phones write the currency the moment either one changes it, so a uuid()
// here would make that two rows and the winner would be whichever pushed last.
// `shs-<householdId>-<key>` is a pure function of the natural key, so the
// UNIQUE constraint and the primary key can never disagree.
//
// The householdId is IN the id (not just a column) on purpose: a device that
// merge-joins a second household keeps the first household's rows locally
// (nothing wipes them — see clearLocalBudgetData, which only runs on a replace
// join). Keying by household means those stale rows simply never match the
// household now in use, instead of quietly deciding what currency the new
// budget displays in.

import { getDb } from '../lib/db';
import { queueSyncMutation } from './cloudkit-sync';

/** Local table name, and the record type pushed to the household mirror. */
export const SHARED_SETTINGS_TABLE = 'shared_settings';

/**
 * Keys this build understands. A key it does not recognise is left alone rather
 * than deleted — it belongs to a member on a newer build, and dropping it would
 * make this device silently undo their setting on every write.
 */
export type SharedSettingKey = 'currency';

export const CURRENCY_KEY: SharedSettingKey = 'currency';

/** Where the currency on screen actually came from. */
export type CurrencySource = 'shared' | 'local';

export type CurrencyResolution = { currency: string; source: CurrencySource };

export type CurrencyState = {
  /** This device's own app_settings.currency — never overwritten by sharing. */
  local: string;
  /** The household's shared value, or null when there is no household or the
   * household has never had one set (e.g. every member is on an older build). */
  shared: string | null;
  /** What amounts are actually displayed in right now. */
  currency: string;
  source: CurrencySource;
  householdId: string | null;
  /** Sharing is on, a shared value exists, and it is not this device's own. */
  differs: boolean;
};

/** The derived primary key. See the header for why it is not uuid(). */
export function sharedSettingId(householdId: string, key: SharedSettingKey): string {
  return `shs-${householdId}-${key}`;
}

/**
 * Accepts any ISO-4217-SHAPED code, not just the seven in the picker.
 *
 * Restricting it to this build's list was rejected: a member on a later build
 * that adds CHF would set it, and this device would reject the value and fall
 * back to its own — which is the divergence this whole file exists to remove,
 * reintroduced as a "safety" check. lib/format.ts already degrades safely on an
 * unknown code (Intl throws, both formatters catch and fall back to "$"), so
 * the only thing worth rejecting here is a value that is not a currency code at
 * all — junk, an empty string, or a number that arrived through the JSON
 * payload untyped.
 */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * THE RESOLUTION RULE.
 *
 *   • Household active AND the household has a shared currency → the SHARED
 *     value wins. Both phones then show the same symbol on the same numbers.
 *   • No household → the local `app_settings.currency` is used, exactly as
 *     before. A solo user is completely unaffected by this file; nothing is
 *     written, nothing is read, and the resolution is a one-line passthrough.
 *   • Household active but no shared value (nobody has set one, or every member
 *     is on a build that predates this table) → the local value is used, same
 *     as a solo user. Falling back to a hardcoded 'USD' was rejected: it would
 *     change what a real user's money is displayed in the instant they turn
 *     sharing on.
 *
 * Same shape as resolveSalaryForMonth's `settings.householdId && monthly?.salary
 * != null`, deliberately — one rule, applied the same way in both places.
 *
 * Pure so scripts/test-shared-settings.mjs can pin it down without a database.
 */
export function resolveCurrency(
  localCurrency: string,
  householdId: string | null,
  sharedCurrency: string | null
): CurrencyResolution {
  const local = normalizeCurrency(localCurrency) ?? 'USD';
  const shared = normalizeCurrency(sharedCurrency);
  if (householdId && shared) return { currency: shared, source: 'shared' };
  return { currency: local, source: 'local' };
}

/** Assembles the full state from its parts. Pure — see resolveCurrency. */
export function buildCurrencyState(
  localCurrency: string,
  householdId: string | null,
  sharedCurrency: string | null
): CurrencyState {
  const local = normalizeCurrency(localCurrency) ?? 'USD';
  const shared = normalizeCurrency(sharedCurrency);
  const resolved = resolveCurrency(local, householdId, shared);
  return {
    local,
    shared,
    currency: resolved.currency,
    source: resolved.source,
    householdId,
    differs: resolved.source === 'shared' && resolved.currency !== local,
  };
}

/**
 * The sentence the Sharing screen shows, in full, whenever sharing is on.
 *
 * This is the answer to "joining must not silently rewrite the joiner's
 * currency". Joining never writes the shared value (see the decision recorded
 * on seedSharedSettingsForNewHousehold), so the joiner's own setting survives
 * untouched — but what they SEE changes, and a currency symbol changing without
 * explanation is alarming in a way a wrong-looking category never is. So the
 * state is stated on screen rather than inferred from the symbol.
 *
 * Pure, and tested, because this string is the entire user-facing safety net.
 */
export function describeSharedCurrency(state: CurrencyState): string {
  if (!state.householdId) {
    return `Amounts show in ${state.local} on this device.`;
  }
  if (!state.shared) {
    return `This shared budget has no currency set yet, so this device is showing its own (${state.local}). Setting one here makes both phones show the same symbol on the same numbers.`;
  }
  if (state.differs) {
    return `Amounts show in ${state.shared} because that is this shared budget's currency. This device's own setting is ${state.local}, and it is kept — it comes back if you leave the shared budget. Nothing was converted; only the symbol changes.`;
  }
  return `Amounts show in ${state.shared}, the currency for everyone in this shared budget.`;
}

// ── Storage ─────────────────────────────────────────────────────────────────

/**
 * Reads `app_settings` straight from the database rather than through
 * lib/queries.getAppSettings.
 *
 * Same reason cloudkit-sync's syncTokenKey does it: lib/queries imports THIS
 * module (getAppSettings resolves the currency through it), so importing back
 * would be a cycle. Reading two columns is cheaper than the cycle is expensive.
 */
async function readLocalRow(): Promise<{ currency: string; householdId: string | null }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ currency: string | null; householdId: string | null }>(
    'SELECT currency, householdId FROM app_settings WHERE id = 1'
  );
  return { currency: row?.currency ?? 'USD', householdId: row?.householdId ?? null };
}

/** One shared setting's raw value, or null when the household has never set it. */
export async function readSharedSetting(householdId: string, key: SharedSettingKey): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ settingValue: string | null }>(
    `SELECT settingValue FROM ${SHARED_SETTINGS_TABLE} WHERE id = ?`,
    [sharedSettingId(householdId, key)]
  );
  return row?.settingValue ?? null;
}

/**
 * Upserts one shared setting and journals it, so the other member actually gets
 * it (AGENTS.md rule 2 — a write that skips the journal never leaves the phone
 * and nothing surfaces the failure).
 *
 * The row is re-read and journaled as it LANDED rather than as the caller meant
 * it, which is what lib/queries.journalUpsert does for the month-scoped tables.
 * That helper is not reused here only because importing lib/queries would close
 * the cycle described on readLocalRow.
 */
export async function writeSharedSetting(
  householdId: string,
  key: SharedSettingKey,
  value: string
): Promise<void> {
  const db = await getDb();
  const id = sharedSettingId(householdId, key);
  await db.runAsync(
    `INSERT INTO ${SHARED_SETTINGS_TABLE} (id, householdId, settingKey, settingValue, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET settingValue = excluded.settingValue, updatedAt = excluded.updatedAt`,
    [id, householdId, key, value, new Date().toISOString()]
  );
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${SHARED_SETTINGS_TABLE} WHERE id = ?`,
    [id]
  );
  if (row) await queueSyncMutation('UPDATE', SHARED_SETTINGS_TABLE, id, row);
}

/** The household's shared currency, validated. Null when there is none. */
export async function getSharedCurrency(householdId: string | null): Promise<string | null> {
  if (!householdId) return null;
  return normalizeCurrency(await readSharedSetting(householdId, CURRENCY_KEY));
}

/**
 * Sets the currency for EVERYONE in the household. Only ever called from a
 * deliberate user action — the Settings picker, or the explicit button on the
 * Sharing screen — never as a side effect of joining. See
 * seedSharedSettingsForNewHousehold.
 */
export async function setSharedCurrency(householdId: string, currency: string): Promise<void> {
  const code = normalizeCurrency(currency);
  if (!code) return;
  await writeSharedSetting(householdId, CURRENCY_KEY, code);
}

/** Everything a screen needs to explain the currency situation in one read. */
export async function getCurrencyState(): Promise<CurrencyState> {
  const local = await readLocalRow();
  const shared = await getSharedCurrency(local.householdId);
  return buildCurrencyState(local.currency, local.householdId, shared);
}

/**
 * The resolved currency for display. This is what lib/queries.getAppSettings
 * returns to the app once the handoff patch in docs/CurrencySyncHandoff.md is
 * applied; until then it is unused and this file changes nothing on screen.
 */
export async function resolveDisplayCurrency(
  localCurrency: string,
  householdId: string | null
): Promise<string> {
  if (!householdId) return normalizeCurrency(localCurrency) ?? 'USD';
  const shared = await getSharedCurrency(householdId);
  return resolveCurrency(localCurrency, householdId, shared).currency;
}

/**
 * ── THE JOIN DECISION ───────────────────────────────────────────────────────
 *
 * CREATING a household seeds the shared currency from this device. JOINING one
 * never writes it at all. Two members therefore converge on the CREATOR's
 * currency, and the joiner is told on the Sharing screen (describeSharedCurrency
 * above) rather than left to notice the symbol changed.
 *
 * Why this direction and not the other:
 *
 *  • Creating already means "the budget on this device becomes the shared one"
 *    — the confirmation dialog in app/household/index.tsx says exactly that,
 *    and seedHouseholdFromLocal pushes every local row up. The currency riding
 *    along with the transactions it labels is the same promise, not a new one.
 *
 *  • Joining is the opposite promise. Both join modes are explicitly about what
 *    happens to the JOINER's data; neither offers to change the household's.
 *    Letting the joiner's currency win would mean an invite code silently
 *    restating every existing member's money in a different symbol — a stranger
 *    changing what your budget reads as, with no dialog anywhere that said so.
 *    Between "the person who arrives adapts" and "the people already there are
 *    changed without being asked", only the first is defensible.
 *
 *  • It is also the recoverable direction. The joiner's own value is never
 *    overwritten, so leaving the household restores it, and one explicit,
 *    confirmed button on the Sharing screen changes it for everyone if that is
 *    what they actually want. Nothing here is a dead end.
 *
 * Seeds only what is MISSING. A household that already has a currency keeps it,
 * so this is safe to call again on any path that re-seeds.
 */
export async function seedSharedSettingsForNewHousehold(householdId: string): Promise<void> {
  const existing = await getSharedCurrency(householdId);
  if (existing) return;
  const local = await readLocalRow();
  const code = normalizeCurrency(local.currency);
  if (code) await writeSharedSetting(householdId, CURRENCY_KEY, code);
}

// LEAVING a household does NOT delete these rows, deliberately. Deleting one
// locally would journal a tombstone into the household being left and wipe the
// currency for the members still in it — the mistake clearLocalBudgetData exists
// to avoid (see its comment in features/household.ts). The rows are a few bytes,
// they are keyed by a household this device no longer uses so nothing reads
// them, and on a rejoin they hold that household's own last known value until
// the pull replaces it.
