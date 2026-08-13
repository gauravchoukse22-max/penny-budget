# KaiJar — read before writing any code

## 0. Assume nothing. Verify, then state.

Gary's standing rule. He does not read the code, so he cannot catch a confident
wrong answer, and he submits to the App Store on the strength of these replies.

- Separate **"I verified this by doing X"** from **"I believe this"** in every
  answer, and name the check you actually ran.
- **This file, TODO.md, and every README describe intent, not current truth.**
  Config lives in dashboards; state lives in the running system. Go look.
- A search-result snippet is not a source. Fetch the source; if the fetch fails,
  say so rather than repeating the snippet as fact.
- **A green build proves nothing about what is inside it.** Verify the artifact:
  `aapt2 dump badging` on the APK, PlistBuddy and `strings -a` on the archive.
  The Hermes bundle is bytecode — plain `grep` silently finds nothing.
- What cannot be checked from here — anything behind Gary's logins — must be
  asked, not guessed. Give him the one precise question and where to look.

Three claims in the 1.3.0 rename session were asserted without checking and all
three were wrong: a trademark that does not exist, screenshots that were never
opened, and a dashboard setting inferred from a README instruction.

## 1. Read TODO.md first

[TODO.md](./TODO.md) is the running to-do list and the source of truth for what is
outstanding. Read it at the start of every session, before planning anything, and
update it as work lands. It also records which behaviour has only ever been
typechecked and never run on a device — treat those as unverified, not done.

## 2. Every write must sync

This app shares one budget between household members. A local write that does not
call `queueSyncMutation` (or `journalUpsert` for natural-key upserts) **never
reaches the other member**, and nothing surfaces the failure. Six tables were
missing it and diverged silently.

Any new table must be added to `SYNCABLE_TABLES` and journal every write path,
including rows orphaned by a delete — foreign keys are not enforced here, so
`ON DELETE CASCADE` never fires.

Ids that two devices generate independently must be derived, not random, or the
same logical thing becomes two rows on sync. See `rec-<ruleId>-<postDate>` in
`features/recurring-transactions.ts`.

## 3. Expo version

This project is on the Expo SDK pinned in `package.json` (currently 54). Read the
docs for that exact version — https://docs.expo.dev/versions/v54.0.0/ — not latest.
