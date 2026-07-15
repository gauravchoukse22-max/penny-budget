# Supabase Accounts + Cloud Backup — Setup Guide

## Status

Optional email/password accounts and a manual cloud backup/restore flow, built on Supabase. Unlike `docs/cloudkit-setup.md`, this works today in **plain Expo Go** — `@supabase/supabase-js`, AsyncStorage, and a URL polyfill are all pure-JS/standard autolinked modules, no custom native code or EAS dev client required.

Login is **optional**, not a gate — the app is fully usable offline without ever signing in. Reachable from **Settings → Account**.

- `context/AuthContext.tsx` — session state, `signIn`/`signUp`/`signOut`.
- `features/cloud-backup.ts` — `backupToCloud`/`restoreFromCloud`/`getLastCloudBackupTimestamp`, built on the same row-collect/restore helpers `features/backup-restore.ts` uses for local backup.
- `app/account/index.tsx` — the sign-in/sign-up/account screen.

## 1. Create a Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. **Settings → API** (or **Settings → API Keys**): copy the **Project URL** and the **`anon`/`public`** (or **`publishable`**) key — never the `service_role`/`secret` key.
3. **Authentication → Sign In / Providers**: confirm **Email** is enabled (on by default).

## 2. Storage bucket for backups

1. **Storage**: create a new bucket named exactly `backups`, set to **Private**.
2. **SQL Editor**: run this policy so each user can only read/write their own backup object:
   ```sql
   create policy "Users manage their own backup object"
   on storage.objects for all
   using ( bucket_id = 'backups' and auth.uid()::text = (storage.foldername(name))[1] )
   with check ( bucket_id = 'backups' and auth.uid()::text = (storage.foldername(name))[1] );
   ```

## 3. Configure the app

Add the two values from step 1 to `.env.local` (gitignored — see `.env.example` for the template):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Restart the dev server with cache cleared (`npx expo start -c`) so the new env vars are picked up. Without these set, the app still boots and works fully offline — the Account screen just shows "cloud accounts aren't configured."

## Design notes

- **Storage shape**: one private object per user, `{user_id}/backup.json`, overwritten on each "Back up now" (not a mirrored relational schema) — this is a manual snapshot, not continuous sync, matching what's actually built. `Storage.list()` supplies the "last backed up" timestamp for free.
- **Session persistence**: AsyncStorage, not `expo-secure-store` — Supabase's session payload (access + refresh token + metadata) routinely exceeds SecureStore's ~2KB item limit.
- **Sign-up confirmation**: the UI doesn't hardcode whether "Confirm email" is on for your project — `AuthContext.signUp` checks whether Supabase returns a session; if not, it surfaces a "check your email" message automatically.
