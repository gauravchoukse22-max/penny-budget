import AsyncStorage from '@react-native-async-storage/async-storage';
import { LATEST_CHANGELOG_ID } from '../lib/changelog';

const SEEN_KEY = 'pennybudget.whatsNewSeen';

/** Returns the changelog id the user has already seen, or null if none. */
export async function getSeenChangelogId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Marks the newest changelog entry as seen so the sheet won't auto-open again. */
export async function markChangelogSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, LATEST_CHANGELOG_ID);
  } catch {
    // Best-effort — worst case the sheet shows once more next launch.
  }
}

/** True when there's a newer changelog entry than the user last saw. */
export async function hasUnseenChangelog(): Promise<boolean> {
  const seen = await getSeenChangelogId();
  return seen !== LATEST_CHANGELOG_ID;
}
