import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { backupToCloud, restoreFromCloud, getLastCloudBackupTimestamp } from '../../features/cloud-backup';

export default function AccountScreen() {
  const theme = useTheme();
  const { isConfigured, loading, user, signIn, signUp, signOut, deleteAccount } = useAuth();
  const { refresh } = useBudget();

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  useEffect(() => {
    if (user) getLastCloudBackupTimestamp(user.id).then(setLastBackup);
  }, [user]);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Enter an email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const result = mode === 'signIn' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
      if (!result.success) {
        setError(result.message);
      } else if (result.needsEmailConfirmation) {
        setInfo(result.message);
      } else {
        setPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const doBackup = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await backupToCloud(user.id);
      Alert.alert(result.success ? 'Backed up' : 'Backup failed', result.message);
      if (result.success) setLastBackup(await getLastCloudBackupTimestamp(user.id));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteAccount = () => {
    if (!user) return;
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and your cloud backup. It cannot be undone. The budget data on this device stays and keeps working offline.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await deleteAccount();
              Alert.alert(result.success ? 'Account deleted' : 'Delete failed', result.message);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const doRestore = () => {
    if (!user) return;
    Alert.alert(
      'Restore from cloud backup?',
      'This replaces ALL current data in the app with the contents of your latest cloud backup. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await restoreFromCloud(user.id);
              Alert.alert(result.success ? 'Restore complete' : 'Restore failed', result.message);
              if (result.success) await refresh();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered, { backgroundColor: theme.groupedBackground }]}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  if (!isConfigured) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Cloud accounts aren't set up yet</Text>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>
              This build doesn't have cloud accounts configured. Your data stays fully on this device — nothing changes.
            </Text>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Signed in</Text>
            <Text style={[styles.helper, { color: theme.secondaryLabel }]}>{user.email}</Text>
          </Surface>

          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>Cloud Backup</Text>
            <Text style={[styles.helper, { color: theme.secondaryLabel, marginBottom: spacing.md }]}>
              Last backed up: {lastBackup ? new Date(lastBackup).toLocaleString() : 'Never'}
            </Text>
            <Pressable style={styles.actionRow} onPress={doBackup} disabled={busy}>
              <Ionicons name="cloud-upload-outline" size={20} color={theme.accent} />
              <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Back up now</Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.separator }]} />
            <Pressable style={styles.actionRow} onPress={doRestore} disabled={busy}>
              <Ionicons name="cloud-download-outline" size={20} color={theme.systemRed} />
              <Text style={{ color: theme.systemRed, marginLeft: 10, fontWeight: '600' }}>Restore latest backup</Text>
            </Pressable>
          </Surface>

          <Pressable style={[styles.button, styles.secondaryButton, { borderColor: theme.separator }]} onPress={signOut}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Sign Out</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.secondaryButton, { borderColor: theme.systemRed }]}
            onPress={doDeleteAccount}
            disabled={busy}
          >
            <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Delete Account</Text>
          </Pressable>
          <Text style={[styles.helper, { color: theme.tertiaryLabel, textAlign: 'center' }]}>
            Permanently deletes your account and cloud backup. Data on this device is untouched.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>{mode === 'signIn' ? 'Sign In' : 'Create Account'}</Text>
          <Text style={[styles.helper, { color: theme.secondaryLabel }]}>
            An optional account lets you back up and restore your data via the cloud. The app works fully offline without one.
          </Text>

          <TextInput
            style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Email"
            placeholderTextColor={theme.tertiaryLabel}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Password"
            placeholderTextColor={theme.tertiaryLabel}
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error && <Text style={[styles.errorText, { color: theme.systemRed }]}>{error}</Text>}
          {info && <Text style={[styles.helper, { color: theme.systemGreen }]}>{info}</Text>}

          <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={submit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={{ color: '#FFF', fontWeight: '600' }}>{mode === 'signIn' ? 'Sign In' : 'Create Account'}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
              setError(null);
              setInfo(null);
            }}
            style={{ marginTop: spacing.md, alignItems: 'center' }}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>
              {mode === 'signIn' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  helper: { fontSize: 14, lineHeight: 20 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginTop: spacing.md },
  errorText: { fontSize: 13, marginTop: spacing.md },
  button: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.lg },
  secondaryButton: { borderWidth: 1.5 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  divider: { height: StyleSheet.hairlineWidth },
});
