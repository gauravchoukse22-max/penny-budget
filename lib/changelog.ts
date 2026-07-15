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
