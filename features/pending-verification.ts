// Remembers an email that signed up but hasn't confirmed yet, so relaunching
// the app can route the user back to the resend screen instead of a dead end.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pending_verification_email';

export async function setPendingVerification(email: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, email);
  } catch {
    /* non-critical */
  }
}

export async function getPendingVerification(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function clearPendingVerification(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-critical */
  }
}
