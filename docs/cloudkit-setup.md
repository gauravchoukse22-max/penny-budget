# iCloud / CloudKit Sync — Setup Guide

## Status

The **sync engine** (`features/cloudkit-sync.ts`) is fully implemented and testable:

- Every local write is journaled to an `outbox` table (via `queueSyncMutation`, hooked into `lib/queries.ts`), but only while sync is enabled (`setSyncEnabled`).
- `pushPendingChangesToCloudKit()` drains the outbox to a remote.
- `pullChangesFromCloudKit()` applies remote changes into local tables (last-writer-wins upsert on primary key) and advances a change token stored in `sync_meta`.
- `runCloudKitSyncCycle()` runs push then pull.

The remote is abstracted behind the **`CloudKitAdapter`** interface. The default is `mockCloudKitAdapter` — a **no-op** — so the app behaves as local-only and the engine can be unit-tested without native code.

**What is NOT done and cannot be done in a managed/JS-only build:** the actual CloudKit bridge. There is no maintained `expo-cloudkit` npm package; CloudKit is an iOS-only native API. You must supply a native module that implements `CloudKitAdapter`, plus Apple-side configuration. This can only be built and verified on a real iOS EAS build on your Apple Developer account.

> ⚠️ Enabling "iCloud Sync" in Settings today only starts journaling to the outbox. No data leaves the device until the native adapter below is registered.

---

## Steps to make sync real

### 1. Apple Developer / Xcode configuration
1. In the Apple Developer console, enable **iCloud** for the app id `com.gary.pennybudget` and create a **CloudKit container** (e.g. `iCloud.com.gary.pennybudget`).
2. Add the **iCloud entitlement** with **CloudKit** services.

### 2. Expo config (app.json) + config plugin
Add the iCloud entitlement via a config plugin (or a small custom plugin), for example using `@config-plugins`/a custom `withEntitlementsPlist` that sets:

```
com.apple.developer.icloud-container-identifiers = ["iCloud.com.gary.pennybudget"]
com.apple.developer.icloud-services = ["CloudKit"]
com.apple.developer.ubiquity-kvstore-identifier = "$(TeamIdentifierPrefix)com.gary.pennybudget"
```

### 3. Native module implementing `CloudKitAdapter`
Create an Expo native module (Swift) exposing three methods that map to the TS interface in `features/cloudkit-sync.ts`:

```swift
// Sketch — implement against CKContainer / CKDatabase (private DB) + a custom zone.
func saveRecord(recordType: String, recordId: String, fields: [String: Any]) async throws
func deleteRecord(recordType: String, recordId: String) async throws
func fetchChanges(previousToken: String?) async throws -> RemoteChanges  // { changed, deleted, newToken }
```

- Use the **private database** and a dedicated **record zone** (e.g. `PennyBudgetZone`).
- Persist/return the `CKServerChangeToken` as an opaque base64 string for `previousToken`/`newToken`.
- `recordType` == the local table name; store each column as a CloudKit field.

### 4. Register the adapter at startup
In `app/_layout.tsx` (or `context/BudgetContext.tsx` init), before the first sync cycle:

```ts
import { setCloudKitAdapter } from '../features/cloudkit-sync';
import NativeCloudKit from '../modules/native-cloudkit'; // your native module

setCloudKitAdapter({
  isAvailable: true,
  saveRecord: NativeCloudKit.saveRecord,
  deleteRecord: NativeCloudKit.deleteRecord,
  fetchChanges: NativeCloudKit.fetchChanges,
});
```

Once `isAvailable` is `true`, `BudgetContext` will run a sync cycle on launch when the user has enabled iCloud Sync.

### 5. Build & test (on device)
- `eas build --profile development --platform ios` (or production).
- Sign in to iCloud on the device, toggle **Settings → iCloud Sync**, create a transaction, and confirm it appears on a second device.

---

## Testing the engine without native code
The engine is verifiable today against `mockCloudKitAdapter` or a fake in-memory adapter:

```ts
import { runCloudKitSyncCycle, setSyncEnabled, queueSyncMutation } from './features/cloudkit-sync';

setSyncEnabled(true);
await queueSyncMutation('CREATE', 'transactions', 'abc', { id: 'abc', amount: 5 });
await runCloudKitSyncCycle(fakeAdapter); // outbox drains; pull applies fakeAdapter changes; token advances
```
