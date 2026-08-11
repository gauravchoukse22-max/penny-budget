# Release Checklist — iOS App Store

Reusable pre-flight for shipping KaiJar. Builds are **local Xcode archives — never EAS**.

Status below is for **1.1.0 (build 9)**, branch `release/1.1.0`.

---

## 1. Code & build

| # | Item | Status |
|---|---|---|
| 1.1 | `npx tsc --noEmit` clean | ✅ |
| 1.2 | `node scripts/test-statement-parse.mjs` — 43 passed, 0 failed | ✅ |
| 1.3 | No known critical bugs | ✅ Security black-screen + import picker fixed |
| 1.4 | Release build compiles, installs, launches, renders — no crash | ✅ simulator, `1.1.0 (9)` |
| 1.4a | Security black-screen fix confirmed **interactively** | ✅ stacked two sensitive screens, no blanking |
| 1.4b | Import picker fix confirmed **interactively** | ✅ file picker opens on the simulator |
| 1.5 | No non-functional UI reachable by a reviewer (Guideline 2.2) | ✅ dead iCloud toggle gone from the running app |
| 1.6 | Feature flags correct for a store build | ✅ no "Linked Banks" row in the running app |
| 1.7 | `EXPO_PUBLIC_*` present for a local Release build (`.env.local`) | ✅ Account section live at runtime |
| 1.8 | **Plaid stays hidden: `EXPO_PUBLIC_BANK_LINKING` is NOT in `.env.local` before archiving** | ✅ verified absent for build 9 |

**How 1.4a was verified without an account:** the black screen needed two `useSensitiveScreen`
screens mounted at once, which normally means Account → Security (sign-in required). The same
condition is reachable signed-OUT via Account → *Forgot password?* — both call the hook. On the
1.1.0 build the reset screen renders normally and backing out restores Account intact, so the
reference-counted native call is behaving. Confirmed on the Security screen itself once signed in.

**Why 1.7 matters:** EAS used to inject these from its stored environment. Local Xcode builds read
`.env.local` during the "Bundle React Native code and images" phase. If it is missing, the app
compiles fine and ships with cloud accounts silently disabled.

**Why 1.8 matters:** `BANK_LINKING_ENABLED = process.env.EXPO_PUBLIC_BANK_LINKING === '1'`
([lib/feature-flags.ts](../lib/feature-flags.ts)). It's a **build-time** flag baked into the JS bundle.
If that line is sitting in `.env.local` when you archive, the "Linked Banks" (Plaid) row ships to
every user and to App Review. Keep it out of `.env.local` for store builds; add it only to your own
dev/family build.

## 2. Versioning — now manual

| # | Item | Status |
|---|---|---|
| 2.1 | `expo.version` bumped (a new user-facing release needs a new version) | ✅ 1.1.0 |
| 2.2 | `expo.ios.buildNumber` bumped and never reused | ✅ 9 (8 skipped — a prior EAS upload may have used it) |
| 2.3 | `Info.plist` `CFBundleVersion` matches | ✅ 1.1.0 / 9 (set directly via PlistBuddy this release) |

> **Xcode archives from `Info.plist`, not `app.json`.** Bumping `app.json` alone does nothing —
> either re-run `npx expo prebuild --platform ios` or set `Info.plist` directly. A duplicate build
> number is rejected as ITMS-4238 *after* the entire upload completes.

## 3. Backend (Supabase)

| # | Item | Status |
|---|---|---|
| 3.1 | Schema applied — household tables, RPCs, RLS | ✅ verified live |
| 3.2 | `backups` storage bucket + per-user policy | ✅ |
| 3.3 | `delete_user()` RPC live | ✅ |
| 3.4 | Auth: Site URL, redirect allowlist, custom SMTP, Apple Client IDs | ✅ verified end-to-end (signup→confirm→signin) |
| 3.5 | Edge Functions deployed | ⚠️ none — see owner task #6 (deletion still works without them) |

## 4. Store metadata

| # | Item | Status |
|---|---|---|
| 4.1 | App Privacy labels reflect what is actually collected | ✅ Email + Financial Info + User ID, all App Functionality, no tracking |
| 4.2 | Description matches the shipped app | ✅ published |
| 4.3 | Demo account + review notes (required once sign-in exists) | ✅ appreview@gary-labs.com, notes saved |
| 4.4 | Support & Privacy URLs live and matching `lib/legal.ts` | ✅ gary-labs.com verified 200 |
| 4.5 | Screenshots current with the redesigned UI | ⏳ regenerating now (fresh capture of the current design) |
| 4.6 | Age rating re-answered | ✅ 4+ |
| 4.7 | Export compliance answer re-derived | ✅ `ITSAppUsesNonExemptEncryption=false` (HTTPS only) |

## 5. Ship

1. Set build number in `Info.plist` (see §2), never reuse one
2. Destination → **Any iOS Device (arm64)** — Archive is greyed out on a simulator
3. **Product → Archive** (the Archive action uses the Release configuration automatically)
4. Organizer → **Distribute App** → **App Store Connect** → **Upload**
5. Xcode will create an **Apple Distribution** certificate if absent. Individual accounts allow 2.
6. Wait for processing (~15–45 min), then attach **the new build** (never an older EAS build — those lack the fixes)
7. Add screenshots, then **Submit for review** with **Phased Release** enabled

## 6. Rollback

A shipped iOS build cannot be withdrawn — plan accordingly.

| Situation | Action |
|---|---|
| Bad build in TestFlight | Expire the build; testers fall back to the previous one |
| Bad build in review | Reject the binary in App Store Connect and upload a fix |
| Bad build live | **Pause Phased Release immediately**, then ship a hotfix build |
| Backend regression | Supabase migrations are additive; roll forward with a new migration |

**Trigger to pause a phased release:** any crash-free-users drop below ~99%, or any report of
data loss, failed sign-in, or a blank screen.
