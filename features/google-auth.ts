// Google Sign-In — SCAFFOLD, ships INERT.
//
// Deliberately not wired: Google Sign-In needs @react-native-google-signin/
// google-signin, which is a NATIVE module — it requires a custom dev client
// (not Expo Go) and per-platform OAuth client IDs + the Android signing
// SHA-1 registered in Google Cloud. None of that can be built or tested in the
// managed/web workflow, so this module returns "not available" everywhere and
// imports nothing native. The account screen only renders a Google button when
// isGoogleSignInAvailable() is true — which is never, until the wiring below is
// done in a native build. See PREBUILD_NOTES.md.

export function isGoogleSignInAvailable(): boolean {
  return false;
}

export async function signInWithGoogle(): Promise<{ success: boolean; message: string }> {
  return { success: false, message: 'Google Sign-In isn’t available in this build yet.' };
}

// Wiring recipe (do NOT enable until a custom dev client exists):
//
// 1. `npx expo install @react-native-google-signin/google-signin`
// 2. Add the config plugin + webClientId/iosClientId to app.json, then
//    `npx expo prebuild` and build a dev client (this leaves Expo Go).
// 3. In Google Cloud: OAuth consent screen + a client ID per platform; register
//    the Android release/debug signing SHA-1 (a mismatch is the #1 cause of the
//    cryptic "DEVELOPER_ERROR").
// 4. Replace the body of signInWithGoogle() with:
//      GoogleSignin.configure({ webClientId });
//      const { idToken } = await GoogleSignin.signIn();
//      await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
// 5. Render your OWN branded button (Google's guidelines allow this) so it sits
//    in the existing button stack. On iOS this ALSO triggers Apple Guideline 4.8
//    — Sign in with Apple must keep equivalent prominence (already present).
