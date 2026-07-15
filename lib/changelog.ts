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
      'You can permanently delete your account and cloud backup from Settings → Account at any time.',
    ],
  },
];

/** The marker for the newest entry — what we compare against "last seen". */
export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? '';
