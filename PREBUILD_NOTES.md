# Prebuild-gated features — prepared, NOT executed

Two planned items require leaving the managed / Expo Go + web workflow by running
`npx expo prebuild` and building a **custom dev client**. That's a one-way door
for the current dev flow (no more Expo Go; the web build also stops working for
the encrypted-DB item), so they are intentionally **not done** — do them when
you're ready to move to a dev-client workflow. Nothing below has been run.

---

## 1. SQLCipher — encrypt the local database at rest

**Status: not started. Requires prebuild. No code changes were made to `lib/db.ts`.**

Today the local SQLite DB (`pennybudget.db`) is plaintext on the device. SQLCipher
encrypts it at rest.

Recipe:
1. `expo-sqlite` supports SQLCipher via a build flag. Enable it in `app.json`:
   ```json
   ["expo-sqlite", { "useSQLCipher": true }]
   ```
2. Generate a random 32-byte key ONCE, store it in SecureStore
   (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), and pass it as the key when opening the DB:
   ```ts
   // lib/db.ts (inside openAndMigrate, before any query)
   const key = await getOrCreateDbKey();          // 32 random bytes, hex, in SecureStore
   await db.execAsync(`PRAGMA key = "x'${key}'";`);
   ```
   Put the `PRAGMA key` as the FIRST statement, before `PRAGMA journal_mode`.
3. Migrating an EXISTING plaintext DB to encrypted needs
   `sqlcipher_export()` into a new encrypted file, then swap — write a one-time
   migration so current installs aren't wiped.
4. Consequences to accept: `npx expo prebuild` (leaves managed workflow), **no
   Expo Go**, **no web** (SQLCipher isn't available in the wa-sqlite web build —
   the web DB stays plaintext, and the app must guard the PRAGMA behind
   `Platform.OS !== 'web'`).
5. **Export compliance**: re-derive `ITSAppUsesNonExemptEncryption` in app.json.
   SQLCipher (AES) is likely still the mass-market exemption, but it becomes YOUR
   determination — confirm before submitting.

## 2. Google Sign-In (Android + iOS)

**Status: inert stub only (`features/google-auth.ts`). No native module installed.**

`isGoogleSignInAvailable()` returns `false`, so no Google button renders anywhere.
The full wiring recipe is in the comments of `features/google-auth.ts`. Summary:
needs `@react-native-google-signin/google-signin` (native → prebuild + dev
client), a Google Cloud OAuth consent screen, a client ID per platform, and the
Android signing **SHA-1** registered (mismatch → `DEVELOPER_ERROR`). On iOS,
shipping Google also engages Apple Guideline 4.8 — Sign in with Apple must keep
equivalent prominence (it already does).

---

*Nothing here changes the current build. Say the word to take on either and I'll
move the project to a dev-client workflow.*
