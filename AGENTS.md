# KaiJar — read before writing any code

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
