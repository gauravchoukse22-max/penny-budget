import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/colors';

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.tertiaryLabel,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: theme.secondaryBackground,
          borderTopColor: theme.separator,
          borderTopWidth: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? 'list' : 'list-outline'} size={size} color={color} />,
        }}
      />
      {/* Budget, Cards and Insights left the tab bar (6 tabs was too many) but
          stay registered here with href: null — the routes keep working from the
          Settings hub and Home quick-access row, and they render with the tab
          bar still visible because they never left the (tabs) group. */}
      <Tabs.Screen name="budget" options={{ href: null, title: 'Budget' }} />
      <Tabs.Screen name="cards" options={{ href: null, title: 'Cards' }} />
      <Tabs.Screen name="insights" options={{ href: null, title: 'Insights' }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
