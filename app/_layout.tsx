import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, AppState } from 'react-native';
import { BudgetProvider, useBudget } from '../context/BudgetContext';
import { AuthProvider } from '../context/AuthContext';
import { authenticateUser } from '../features/biometrics';
import { enableAppSwitcherCover, disableAppSwitcherCover } from '../features/privacy-screen';
import { hasUnseenChangelog } from '../features/whats-new';
import { AppLockScreen } from '../components/FeatureCards';

function RootNavigator() {
  const { ready, settings } = useBudget();
  const biometricLock = settings.biometricLock;
  const graceMinutes = settings.autoLockGraceMinutes;
  const router = useRouter();
  const segments = useSegments();
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [locked, setLocked] = useState(false);
  const authingRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);

  const runAuth = useCallback(async () => {
    if (authingRef.current) return;
    authingRef.current = true;
    try {
      const ok = await authenticateUser();
      if (ok) setLocked(false);
    } finally {
      authingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inSetup = segments[0] === 'setup';
    if (!settings.onboarded && !inSetup) {
      router.replace('/setup');
    } else if (settings.onboarded && inSetup) {
      router.replace('/(tabs)');
    }
    setCheckedOnboarding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.onboarded]);

  // Once the user is past onboarding, show "What's New" if a perceptible change
  // shipped since they last saw it. Runs once per launch; the screen marks itself
  // seen so it won't reappear until the next changelog entry.
  const shownWhatsNewRef = useRef(false);
  useEffect(() => {
    if (!ready || !settings.onboarded || shownWhatsNewRef.current) return;
    shownWhatsNewRef.current = true;
    hasUnseenChangelog().then((unseen) => {
      if (unseen) router.push('/whats-new');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.onboarded]);

  // Lock the app on launch when the setting is enabled.
  useEffect(() => {
    if (ready && biometricLock) setLocked(true);
  }, [ready, biometricLock]);

  // Prompt for authentication whenever we transition into a locked state.
  useEffect(() => {
    if (locked) runAuth();
  }, [locked, runAuth]);

  // Re-lock when the app returns from the background — but only after a grace
  // period, so Control Center, notification banners, the Face ID sheet, and
  // quick app-switches don't trigger a relock/prompt loop. We stamp the time on
  // 'background' (ignoring the transient 'inactive' state) and evaluate on
  // 'active'. Grace of 0 = lock immediately.
  useEffect(() => {
    if (!biometricLock) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAtRef.current = Date.now();
      } else if (state === 'active') {
        const since = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (since === null) return;
        const elapsedMs = Date.now() - since;
        if (elapsedMs >= graceMinutes * 60_000) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [biometricLock, graceMinutes]);

  // Blur the app-switcher snapshot while the lock is enabled (iOS native cover).
  useEffect(() => {
    if (biometricLock) enableAppSwitcherCover();
    else disableAppSwitcherCover();
  }, [biometricLock]);

  if (!ready || !checkedOnboarding) return null;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', headerShown: true, title: 'Transaction' }} />
        <Stack.Screen name="transaction/add" options={{ presentation: 'modal', headerShown: true, title: 'Add Transaction' }} />
        <Stack.Screen name="category/[id]" options={{ headerShown: true, title: 'Category' }} />
        <Stack.Screen name="card/[id]" options={{ headerShown: true, title: 'Card' }} />
        <Stack.Screen name="recurring/index" options={{ headerShown: true, title: 'Recurring Bills' }} />
        <Stack.Screen name="search" options={{ headerShown: true, title: 'Search' }} />
        <Stack.Screen name="account/index" options={{ headerShown: true, title: 'Account', headerLargeTitle: true }} />
        <Stack.Screen name="account/forgot-password" options={{ presentation: 'modal', headerShown: true, title: 'Reset Password' }} />
        <Stack.Screen name="account/update-password" options={{ headerShown: true, title: 'New Password', gestureEnabled: false }} />
        <Stack.Screen name="account/verify-email" options={{ presentation: 'modal', headerShown: true, title: 'Confirm Email' }} />
        <Stack.Screen name="account/change-email" options={{ presentation: 'modal', headerShown: true, title: 'Change Email' }} />
        <Stack.Screen name="account/change-password" options={{ presentation: 'modal', headerShown: true, title: 'Change Password' }} />
        <Stack.Screen name="account/security" options={{ headerShown: true, title: 'Security' }} />
        <Stack.Screen name="whats-new/index" options={{ presentation: 'modal', headerShown: true, title: "What's New" }} />
      </Stack>
      {locked && <AppLockScreen onUnlock={runAuth} />}
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <AuthProvider>
      <BudgetProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <RootNavigator />
      </BudgetProvider>
    </AuthProvider>
  );
}
