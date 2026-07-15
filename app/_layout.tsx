import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, AppState } from 'react-native';
import { BudgetProvider, useBudget } from '../context/BudgetContext';
import { authenticateUser } from '../features/biometrics';
import { AppLockScreen } from '../components/FeatureCards';

function RootNavigator() {
  const { ready, settings } = useBudget();
  const biometricLock = settings.biometricLock;
  const router = useRouter();
  const segments = useSegments();
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const [locked, setLocked] = useState(false);
  const authingRef = useRef(false);

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

  // Lock the app on launch when the setting is enabled.
  useEffect(() => {
    if (ready && biometricLock) setLocked(true);
  }, [ready, biometricLock]);

  // Prompt for authentication whenever we transition into a locked state.
  useEffect(() => {
    if (locked) runAuth();
  }, [locked, runAuth]);

  // Re-lock when the app is backgrounded, so returning requires auth again.
  useEffect(() => {
    if (!biometricLock) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') setLocked(true);
    });
    return () => sub.remove();
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
      </Stack>
      {locked && <AppLockScreen onUnlock={runAuth} />}
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <BudgetProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </BudgetProvider>
  );
}
