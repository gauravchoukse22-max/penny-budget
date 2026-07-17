// App-lock authentication. Design rule: FAIL CLOSED. A lock that silently
// unlocks itself when biometrics get un-enrolled (the old behavior) is worse
// than no lock — so any inability to verify identity leaves the app locked.
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export async function checkBiometricsSupport(): Promise<{ supported: boolean; type: string }> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return { supported: false, type: 'None' };

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { supported: false, type: 'None' };

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const isAndroid = Platform.OS === 'android';
  let typeName = 'Biometrics';
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    typeName = isAndroid ? 'Face Unlock' : 'Face ID';
  } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    typeName = isAndroid ? 'Fingerprint' : 'Touch ID';
  } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    typeName = 'Iris';
  }

  return { supported: true, type: typeName };
}

export type EnrolledLevel = 'none' | 'passcode' | 'biometric';

/** What credential the device can actually prompt for — used to warn the user
 * before they try to enable a lock they can't satisfy. */
export async function getEnrolledLevel(): Promise<EnrolledLevel> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG || level === LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK) {
      return 'biometric';
    }
    if (level === LocalAuthentication.SecurityLevel.SECRET) return 'passcode';
    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Prompts for biometrics, falling back to the device passcode. Returns true
 * ONLY on a verified success. Every other outcome — no credential enrolled,
 * user cancel, hardware error, thrown exception — returns false so the caller
 * keeps the app locked.
 */
/**
 * Step-up re-auth before a sensitive action (disable 2FA, delete account). If
 * the device has a credential enrolled, require it; if it has none, don't block
 * the action (there's nothing to step up to, and failing closed here would trap
 * the user out of deleting their own account).
 */
export async function stepUpReauth(promptMessage = "Confirm it's you"): Promise<boolean> {
  const level = await getEnrolledLevel();
  if (level === 'none') return true;
  return authenticateUser(promptMessage);
}

export async function authenticateUser(promptMessage: string = 'Unlock Penny Budget'): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      // Allow the OS passcode as a fallback (and as the sole factor on devices
      // with a passcode but no enrolled biometrics).
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success === true;
  } catch (error) {
    console.error('Authentication error:', error);
    return false;
  }
}
