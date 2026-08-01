# Android Readiness — Penny Budget

Read-only audit, 2026-07-27 (Expo SDK 54.0.35, RN 0.81.5, New Arch), before the first local-Gradle
Android build. **Bottom line: the app will build AND launch on Android as-is — no blockers.** But
there are Android-specific UX/correctness defects to fix before calling it shipped.

## Blockers (break build/launch) — NONE
`app.json` Android block valid: `package com.gary.pennybudget`, `versionCode 4`, full `adaptiveIcon`
(all 4 assets exist). Clean CNG (`ios/` + `android/` gitignored). Every native module is
Android-compatible. `expo-apple-authentication` compiles on Android (JS guarded, button gated).
`predictiveBackGestureEnabled: false`.

## HIGH — fix before "shipped"
1. **App-lock overlay hardcodes "Unlock with Face ID"** (`components/FeatureCards.tsx:277`). Android has
   no Face ID. `features/biometrics.ts` already computes the right label; `settings.tsx:43` uses it.
   Fix: use `checkBiometricsSupport()` type in `AppLockScreen`, or say "Unlock". **(Fix before screenshots.)**
2. **Apple-only accounts locked out on Android.** SIWA is iOS-only (`AuthContext.tsx:225`, button gated
   `account/index.tsx:282`); Google sign-in ships inert (`features/google-auth.ts`). An Apple-signup user
   has no password → on Android only email+password works → can't sign in. "Add a password"
   (`account/security.tsx:193`) needs an active session = catch-22. Workaround: add a password on iOS
   first. Real fix: wire Google sign-in for Android, or force Apple users to set a password + message it.
   **PRODUCT DECISION.**
3. **Onboarding (`app/setup.tsx`) not inset-aware.** `headerShown:false` + hardcoded `paddingTop:60`
   (line 291) + footer padding only (line 305). SDK 54 = Android 15 edge-to-edge enforced → content
   draws behind status/nav bars; footer buttons can sit under the nav bar. Fix: `useSafeAreaInsets()`
   or `SafeAreaView edges={['top','bottom']}`. **(Fix before screenshots — first screen a new user sees.)**
4. **Hardware BACK bypasses `gestureEnabled:false`.** No `BackHandler` anywhere. `update-password`
   (`_layout.tsx:112`) + `import/preview` (`:118`) rely on it; Android hardware back ignores it and pops
   the screen. Fix: `BackHandler` guard on those two.
5. **Keyboard handling unverified on Android.** `behavior={ios?'padding':undefined}` offset 0 in
   `transaction/add.tsx:98`, `transaction/[id].tsx:65`, `budget.tsx:308`, `account/*`,
   `NumberEditorSheet.tsx:73`. Usually OK (ScrollView + adjustResize) but under edge-to-edge the
   autoFocus amount field in `transaction/add` may get covered. Verify on device; if broken set
   `behavior="height"` on Android.
6. **Recents privacy gap on Android.** `features/privacy-screen.ts:14` app-switcher cover is iOS-only;
   lock overlay only 95% opaque (`FeatureCards.tsx:266`) → budget faintly visible in Recents. Fix:
   while locked on Android, `ScreenCapture.preventScreenCaptureAsync()` app-wide (FLAG_SECURE also
   blanks the Recents snapshot). Per-screen `useSensitiveScreen` already works on Android.

## Polish (visual, no break)
- `headerLargeTitle:true` (`account/index`, `household/index`) iOS-only, ignored on Android.
- Hardcoded `modalContent.paddingTop:40` (`settings:443`, `transactions:319`, `cards:126`, `budget:381`)
  — verify clears Android status bar under edge-to-edge; prefer `insets.top`.
- `bulkActionBar` (`FeatureCards.tsx:389`, `bottom:30`) — verify clears Android gesture bar; use `insets.bottom`.
- `presentation:'modal'` = full-screen slide-up on Android (not iOS card sheet) — expected.
- `GradientCard` sets `elevation` on `LinearGradient` — Android may not draw shadow without solid bg outline.
- Already handled (no action): `fontFamily` System→default, Menlo→monospace, tabular-nums,
  datetimepicker native Android dialog, importer `copyToCacheDirectory:true` for `content://` URIs.

## Verdict
Will build + launch on Android now. Fix #1 and #3 before any screenshot; verify #4/#5 on a real
device; #2 is a product call (Google sign-in vs messaging).
