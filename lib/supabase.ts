import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Cloud accounts/backup are optional — a build without these env vars should
// still boot and run fully offline, just with the Account screen reporting
// "not configured" instead of crashing.
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

/**
 * Encrypted storage for the Supabase session on device.
 *
 * The persisted session blob contains the long-lived refresh token — whoever
 * reads it can take over the cloud account. Storing it as raw AsyncStorage
 * (the old behavior) left it in plaintext in the app sandbox, readable from an
 * unencrypted device backup or a rooted/jailbroken device. This wraps it in
 * AES-256-CTR: the random key lives in the iOS Keychain / Android Keystore via
 * SecureStore (pinned to THIS device so it never rides along an iCloud/iTunes
 * backup), and only the ciphertext goes to AsyncStorage.
 *
 * CTR gives confidentiality, not integrity — that's the right trade for the
 * "someone read my disk" threat and we don't oversell it. The store backs
 * exactly one rotating value (the session); the key is re-minted on every
 * write, so don't reuse this class for a second long-lived secret.
 *
 * SecureStore has no web support, so on web we fall back to default storage
 * (see `authStorage` below) — the token tier there is localStorage, disclosed
 * honestly on the security screen.
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;

    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) {
      // No encryption key on record. Either (a) a legacy PLAINTEXT session from
      // before encryption shipped, or (b) orphaned ciphertext whose key was
      // lost. A plaintext session parses as JSON — migrate it in place so the
      // user isn't logged out and the plaintext copy is overwritten with
      // ciphertext. Anything that doesn't parse is unrecoverable → treat as
      // signed-out.
      try {
        JSON.parse(stored);
      } catch {
        return null;
      }
      await this.setItem(key, stored);
      return stored;
    }

    try {
      return await this.decrypt(key, stored);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

// Native: encrypted session at rest. Web: default storage (SecureStore is
// iOS/Android only), with detectSessionInUrl so email deep links resolve.
const authStorage = Platform.OS === 'web' ? AsyncStorage : new LargeSecureStore();

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On web, reset/confirm links land back in the browser with the session
      // in the URL fragment — let supabase-js pick it up. Native uses explicit
      // deep-link handling instead (see context/AuthContext.tsx).
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

// Refresh tokens only while the app is foregrounded — a backgrounded app has no
// reason to keep renewing, and it avoids refresh churn during the lock screen.
if (isSupabaseConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
