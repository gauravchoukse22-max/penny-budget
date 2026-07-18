// Written, user-facing record of every change you can FEEL or TEST in the app.
// Shown on launch when there's something new, and any time from
// Settings → What's New. Add a new entry at the TOP whenever a perceptible
// change ships (skip purely internal refactors, build config, or docs).
//
// `version` is the marketing version the change ships in. `id` is what we store
// as "seen" — bump it whenever you add an entry so the sheet reappears once.

export type ChangelogEntry = {
  id: string; // unique, monotonic marker used for "already seen" tracking
  version: string;
  date: string; // human-readable, e.g. "July 2026"
  title: string;
  changes: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-07-18-statement-import',
    version: '1.0.1',
    date: 'July 2026',
    title: 'Credit card statement import that actually works',
    changes: [
      'You can now import the PDF statement itself — not just a CSV. The app reads the statement\'s table directly (tested against Chase and Synchrony layouts), including headers that wrap onto two lines and long descriptions that continue on the next line.',
      'Statement import no longer throws away rows it can\'t read. It now handles dates without a year (like 06/28), figures out the year from the statement itself, and understands more date and amount formats.',
      'It auto-detects your bank\'s sign convention — so cards that export purchases as negative numbers (like Chase) no longer import every purchase as a refund.',
      'Section subtotal lines like "Payments and Other Credits" are recognized and excluded, instead of importing as fake transactions.',
      'New review screen: before anything is added, you see every transaction with its date, amount, and a suggested category. Toggle rows off, fix categories, or flip an amount\'s sign — nothing is saved until you tap Import.',
      'Duplicates and charges already tracked as recurring bills are flagged and pre-unchecked, and any lines that couldn\'t be read are shown to you rather than silently dropped.',
      'The file picker now accepts the CSV files real banks actually hand out, which previously could be unselectable.',
    ],
  },
  {
    id: '2026-07-17-family-sharing',
    version: '1.0.1',
    date: 'July 2026',
    title: 'Share one budget with your family',
    changes: [
      'New Family Sharing (Settings → Account → Family Sharing): create a shared household and everyone in it co-edits the same budget — add a transaction on one phone, see it on the other.',
      'Invite family with a simple 8-character code (expires in 7 days). They tap Join, enter the code, and you\'re sharing.',
      'Creating a household seeds it from the budget already on your device; joining one merges your budget with the shared one (back up first if unsure — Settings → Backup).',
      'Changes sync when the app opens and via a "Sync now" button. You can leave a household anytime — the data on your device stays and keeps working offline.',
      'Completely optional: if you never create or join a household, nothing changes and your budget stays only on your device.',
    ],
  },
  {
    id: '2026-07-17-account-security',
    version: '1.0.1',
    date: 'July 2026',
    title: 'A real account page — and much stronger security',
    changes: [
      'The Sign In / Account screen was rebuilt: a cleaner grouped layout, a show/hide eye on the password, a password-strength meter and rules while you type, inline errors that actually explain what went wrong, and Password AutoFill support.',
      'Forgot your password? There\'s now a proper reset flow — we email you a 6-digit code (or a link) to set a new one right in the app.',
      'Confirming a new account is easier: enter the 6-digit code from your email instead of bouncing out to a browser and back.',
      'New Security screen (Account → Security): turn on two-factor authentication — you\'ll be asked for a code from your authenticator app each time you sign in — plus change your email or password and sign out of all devices.',
      'Signed up with Apple? You can now add a password, so you can also sign in with your email on Android and the web.',
      'Your sign-in token is now stored encrypted on your device instead of in plain text.',
      'Signing out now only signs out this device — it no longer unexpectedly signs out your other devices.',
      'App Lock is sturdier: it never silently unlocks itself, offers a passcode fallback, and you can choose how quickly it re-locks (immediately, 1, 5, or 15 minutes).',
      'New "Hide amounts" switch (Settings → Security) masks your money figures as ••••  to keep them private in public.',
      'Added a Terms of Use, and Terms/Privacy links right where you create an account.',
    ],
  },
  {
    id: '2026-07-15-icloud-toggle',
    version: '1.0.1',
    date: 'July 2026',
    title: 'Clearer iCloud Sync status',
    changes: [
      'The "iCloud Sync" toggle in Settings was turning on with no real backend behind it yet — confusing since nothing visibly happened. It now shows as "Coming in a future update" on iOS, and no longer appears at all on Android or web, where it was never applicable. Your data is unaffected either way.',
      'To move your budget between devices today, use the optional account: Settings → Account → Back up now / Restore latest backup.',
    ],
  },
  {
    id: '2026-07-15-web-backup',
    version: '1.0.1',
    date: 'July 2026',
    title: 'Backup & CSV now work on the web version',
    changes: [
      'On the web app, "Back up all data (JSON)" and "Export CSV" now download a real file to your computer, instead of silently failing.',
      '"Restore from backup", "Import CSV", "Import Monthly Log", and "Import Credit Card Statement" now correctly read the file you choose on the web app.',
    ],
  },
  {
    id: '2026-07-15-qa-fixes',
    version: '1.0.1',
    date: 'July 2026',
    title: 'Sharper, safer numbers',
    changes: [
      'Deleting a card now clearly warns that its transactions go with it — and they\'re fully removed, instead of lingering as broken rows with no card.',
      'Deleting a category now moves its transactions to "to review" so spending never silently disappears from your totals.',
      'The Smart Forecast only shows on the current month, so swiping back to a past month no longer displays a mismatched projection.',
      '"Days Left" now reads 0 for months that have already ended, and card due dates are correct in short months like April and February.',
      'Amount fields show your chosen currency symbol (€, £, ₹, ¥ …) instead of always showing "$".',
      'CSV import is more reliable: notes that contain a line break no longer corrupt the imported file.',
      'Money totals are rounded to the cent, so you\'ll never see a stray "-$0.00".',
    ],
  },
  {
    id: '2026-07-15-feel',
    version: '1.0.1',
    date: 'July 2026',
    title: 'A budget that feels alive',
    changes: [
      'Home now leads with a big "Left to spend" number that counts up as it loads, with a tap-to-reveal "How is this calculated?" breakdown.',
      'Every budget row shows how much is left — green when you\'re under, red when you\'re over.',
      'Tapping a salary, category limit, or goal opens a full-screen number pad with −/+ steppers and quick-add chips, instead of a tiny text box.',
      'Progress bars now fill with a smooth spring instead of snapping.',
      'Buttons gently scale and tap back when pressed, with light haptic feedback throughout.',
      'Saving a transaction gives a success buzz, and categories you use most float to the top of the picker.',
      'Swiping between months slides instead of jumping.',
      'Optional accounts: you can now create an account to back up and restore your budget to the cloud — completely optional, the app still works fully offline.',
      'You can now sign in with Apple as a one-tap, private alternative to email and password (iOS only).',
      'You can permanently delete your account and cloud backup from Settings → Account at any time.',
    ],
  },
];

/** The marker for the newest entry — what we compare against "last seen". */
export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? '';
