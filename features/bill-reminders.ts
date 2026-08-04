// Bill due-date reminders — local notifications the day before each bill.
//
// Rocket Money's non-bank hook is "never miss a bill"; this is Penny's version
// built on data already on the device: recurring rules (dayOfMonth) and card
// due days (cards.dueDay), projected by lib/bill-schedule.ts.
//
// ── Native-module caveat ────────────────────────────────────────────────────
// expo-notifications is installed as a JS dependency but its NATIVE module is
// not linked until the next `expo prebuild` + native build. In a JS-only
// update (or a binary built before the dependency landed), requiring or
// calling it can throw. Everything here therefore goes through
// getNotificationsModule(), which resolves the module inside a try/catch and
// degrades to "unavailable": the switch stays off, setBillRemindersEnabled
// returns 'unavailable' so the screen can explain, and nothing crashes.
//
// ── Scheduling model ────────────────────────────────────────────────────────
// One notification per bill event in the next 30 days, at 9:00 AM the day
// BEFORE the due date. Identifiers are the event's derived id
// (bill-rec-<ruleId>-<date> / bill-card-<cardId>-<date>), so rescheduling
// replaces the same logical reminder instead of stacking duplicates. Every
// reschedule first cancels all bill-* notifications, so deleted rules and
// cleared due days disappear rather than firing as ghosts.
//
// The enabled flag lives in app_settings.billRemindersEnabled (self-healed in
// lib/db.ts). It is read/written directly here — NOT through
// updateAppSettings/AppSettings — because it is a device-local capability
// flag, not a budget preference: app_settings never syncs, and no other
// screen needs it.

import { Platform } from 'react-native';
import { getDb } from '../lib/db';
import { formatCurrency } from '../lib/format';
import { upcomingBillEvents, shiftIsoDate, type BillEvent } from '../lib/bill-schedule';

const BILL_ID_PREFIX = 'bill-';
const REMINDER_WINDOW_DAYS = 30;
const REMINDER_HOUR = 9; // 9:00 AM local, the day before the bill.

type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null | undefined;

/** Resolve expo-notifications, or null when its native side isn't linked yet
 * (see the caveat at the top of the file). Cached: availability can't change
 * within a process. */
function getNotificationsModule(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-notifications') as NotificationsModule;
    // Touching a method verifies the native binding actually exists, not just
    // the JS package — the throw happens here, inside the catch, not later in
    // the middle of a reschedule.
    if (typeof mod.getAllScheduledNotificationsAsync !== 'function') throw new Error('stub module');
    cachedModule = mod;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** True when the notifications native module is linked in this binary. The
 * Bills screen uses this to explain a disabled switch. */
export function areNotificationsAvailable(): boolean {
  return getNotificationsModule() !== null;
}

export async function getBillRemindersEnabled(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ billRemindersEnabled: number }>(
    'SELECT billRemindersEnabled FROM app_settings WHERE id = 1'
  );
  return !!row?.billRemindersEnabled;
}

async function persistEnabled(enabled: boolean): Promise<void> {
  const db = await getDb();
  // Deliberately no queueSyncMutation: device-local, never synced — see header.
  await db.runAsync('UPDATE app_settings SET billRemindersEnabled = ? WHERE id = 1', [enabled ? 1 : 0]);
}

export type EnableResult = 'enabled' | 'denied' | 'unavailable';

/**
 * Flip the "Remind me about bills" switch. Enabling asks for the OS
 * notification permission LAZILY — this is the first and only moment the app
 * ever prompts for it, so the request has obvious context (the user just
 * asked for reminders). Returns:
 *   'enabled'     — permission granted, reminders scheduled, flag persisted
 *   'denied'      — user refused the OS prompt; flag stays off
 *   'unavailable' — native module not linked in this binary; flag stays off
 */
export async function setBillRemindersEnabled(enabled: boolean): Promise<EnableResult | 'disabled'> {
  if (!enabled) {
    await persistEnabled(false);
    await cancelAllBillReminders();
    return 'disabled';
  }

  const Notifications = getNotificationsModule();
  if (!Notifications) return 'unavailable';

  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return 'denied';

    // Android routes every notification through a channel; creating it here
    // (idempotent) keeps the one native call-site next to the permission ask.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('bill-reminders', {
        name: 'Bill reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await persistEnabled(true);
    await rescheduleBillReminders();
    return 'enabled';
  } catch {
    // Any native hiccup (unlinked module surfacing late, OS refusal) degrades
    // to "unavailable" rather than crashing or persisting a broken ON state.
    return 'unavailable';
  }
}

/** Remove every scheduled bill-* notification, leaving any other future
 * notification types alone. Safe to call with the module unavailable. */
export async function cancelAllBillReminders(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(BILL_ID_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {
    // Unlinked native module — nothing was ever scheduled, nothing to cancel.
  }
}

/** "Water bill tomorrow — $45" / "Sapphire payment due tomorrow". With
 * hideAmounts on, the amount stays off the lock screen too — a notification
 * is the most shoulder-surfable surface in the app. */
export function reminderTitle(event: BillEvent, currency: string, hideAmounts: boolean): string {
  if (event.source === 'card-due') return `${event.label} due tomorrow`;
  if (event.amount == null || hideAmounts) return `${event.label} tomorrow`;
  return `${event.label} tomorrow — ${formatCurrency(event.amount, currency)}`;
}

/**
 * Rebuild the next 30 days of reminders from current rules + cards. Call it
 * whenever the schedule may have changed — the Bills screen calls it on
 * focus. No-op (never a crash) when reminders are off or the native module
 * isn't linked. Cancel-then-schedule with stable identifiers means calling
 * this repeatedly converges instead of duplicating.
 */
export async function rescheduleBillReminders(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  if (!(await getBillRemindersEnabled())) return;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return; // Revoked in OS Settings since enabling.

    const db = await getDb();
    const [rules, cards, settingsRow] = await Promise.all([
      db.getAllAsync<{ id: string; note: string; amount: number; dayOfMonth: number; active: number }>(
        'SELECT id, note, amount, dayOfMonth, active FROM recurring_transactions'
      ),
      db.getAllAsync<{ id: string; name: string; dueDay: number | null }>('SELECT id, name, dueDay FROM cards'),
      db.getFirstAsync<{ currency: string; hideAmounts: number }>(
        'SELECT currency, hideAmounts FROM app_settings WHERE id = 1'
      ),
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const events = upcomingBillEvents(
      rules.map((r) => ({ ...r, active: !!r.active })),
      cards,
      todayStr,
      REMINDER_WINDOW_DAYS
    );

    await cancelAllBillReminders();

    const now = new Date();
    for (const event of events) {
      // 9:00 AM local time the day before the bill. Local midnight parsing
      // matches the rest of the codebase's calendar-day convention.
      const fireAt = new Date(shiftIsoDate(event.date, -1) + 'T00:00:00');
      fireAt.setHours(REMINDER_HOUR, 0, 0, 0);
      // A bill due today/tomorrow-morning has its reminder moment in the past;
      // scheduling a past date would fire immediately, which reads as a bug.
      if (fireAt <= now) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: event.id, // stable: reschedules replace, never duplicate
        content: {
          title: reminderTitle(event, settingsRow?.currency ?? 'USD', !!settingsRow?.hideAmounts),
          body: event.source === 'card-due' ? 'Card payment due tomorrow.' : 'Due tomorrow.',
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: Platform.OS === 'android' ? 'bill-reminders' : undefined,
        },
      });
    }
  } catch {
    // Degrade silently: reminders are a convenience layered on the calendar,
    // and the calendar itself must never be taken down by a notification
    // failure in a binary that predates the native module.
  }
}
