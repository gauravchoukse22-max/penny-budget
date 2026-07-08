import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { BudgetProvider, useBudget } from '../context/BudgetContext';

function RootNavigator() {
  const { ready, settings } = useBudget();
  const router = useRouter();
  const segments = useSegments();
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);

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

  if (!ready || !checkedOnboarding) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="setup" />
      <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', headerShown: true, title: 'Transaction' }} />
      <Stack.Screen name="transaction/add" options={{ presentation: 'modal', headerShown: true, title: 'Add Transaction' }} />
      <Stack.Screen name="category/[id]" options={{ headerShown: true, title: 'Category' }} />
      <Stack.Screen name="card/[id]" options={{ headerShown: true, title: 'Card' }} />
    </Stack>
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
