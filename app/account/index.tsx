import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  useColorScheme,
  type TextInput as RNTextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '../../context/AuthContext';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import {
  GroupedSection,
  AuthTextField,
  PrimaryButton,
  TextButton,
  InlineError,
  InfoNote,
  StrengthMeter,
  OrDivider,
} from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { isValidEmail, evaluatePassword, MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';
import { openTerms, openPrivacy } from '../../lib/legal';
import { getPendingVerification } from '../../features/pending-verification';
import { backupToCloud, restoreFromCloud, getLastCloudBackupTimestamp } from '../../features/cloud-backup';
import { confirmAction, notify } from '../../lib/confirm';

export default function AccountScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  useSensitiveScreen('account-index');

  const {
    isConfigured,
    loading,
    user,
    signIn,
    signUp,
    signInWithApple,
    signOut,
    sessionEndedMessage,
    clearSessionEndedMessage,
    mfaChallenge,
    verifyMfaChallenge,
    cancelMfaChallenge,
  } = useAuth();
  const { refresh } = useBudget();

  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  // If a previous sign-up never got confirmed, prefill that email so the user
  // can pick up where they left off after relaunching.
  useEffect(() => {
    if (!user) getPendingVerification().then((e) => { if (e) setEmail((cur) => cur || e); });
  }, [user]);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const passwordRef = useRef<RNTextInput>(null);

  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  useEffect(() => {
    if (user) getLastCloudBackupTimestamp(user.id).then(setLastBackup);
  }, [user]);

  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const submitMfa = async () => {
    setMfaError(null);
    setMfaSubmitting(true);
    try {
      const result = await verifyMfaChallenge(mfaCode.trim());
      if (result.success) setMfaCode('');
      else setMfaError(result.message);
    } finally {
      setMfaSubmitting(false);
    }
  };

  const emailValid = isValidEmail(email);
  const passwordOk = mode === 'signUp' ? evaluatePassword(password).meetsMinimum : password.length > 0;
  const canSubmit = emailValid && passwordOk && !submitting;

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = mode === 'signIn' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
      if (!result.success) {
        if (result.code === 'email_not_confirmed') {
          router.push({ pathname: '/account/verify-email', params: { email: email.trim() } });
          return;
        }
        setError(result.message);
      } else if (result.needsEmailConfirmation) {
        router.push({ pathname: '/account/verify-email', params: { email: email.trim() } });
      } else {
        setPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const doAppleSignIn = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const result = await signInWithApple();
      if (!result.success && result.message) setError(result.message);
    } finally {
      setSubmitting(false);
    }
  };

  const doBackup = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await backupToCloud(user.id);
      notify(result.success ? 'Backed up' : 'Backup failed', result.message);
      if (result.success) setLastBackup(await getLastCloudBackupTimestamp(user.id));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!user) return;
    if (await confirmAction({
      title: 'Restore from cloud backup?',
      message: 'This replaces ALL current data in the app with the contents of your latest cloud backup. This cannot be undone.',
      confirmLabel: 'Restore',
      destructive: true,
    })) {
      setBusy(true);
      try {
        const result = await restoreFromCloud(user.id);
        notify(result.success ? 'Restore complete' : 'Restore failed', result.message);
        if (result.success) await refresh();
      } finally {
        setBusy(false);
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.groupedBackground }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // ── Pending two-factor challenge (blocks the signed-in view) ────────────
  if (mfaChallenge) {
    return (
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <GroupedSection
          header="Two-factor verification"
          footnote="Enter the current 6-digit code from your authenticator app to finish signing in."
        >
          <AuthTextField
            label="6-digit code"
            value={mfaCode}
            onChangeText={setMfaCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="123456"
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={submitMfa}
          />
          {mfaError && <InlineError message={mfaError} />}
          <PrimaryButton title="Verify" onPress={submitMfa} loading={mfaSubmitting} disabled={mfaCode.trim().length < 6} />
          <TextButton title="Cancel and sign out" onPress={cancelMfaChallenge} color={theme.secondaryLabel} />
        </GroupedSection>
      </ScrollView>
    );
  }

  // ── Cloud not configured for this build ─────────────────────────────────
  if (!isConfigured) {
    return (
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <GroupedSection
          header="Accounts"
          footnote="This build doesn't have cloud accounts configured. Your data stays fully on this device — nothing changes."
        >
          <Text style={{ color: theme.label, fontSize: 16 }}>Cloud accounts aren't set up yet.</Text>
        </GroupedSection>
      </ScrollView>
    );
  }

  // ── Signed in: account management ───────────────────────────────────────
  if (user) {
    const isApple = (user.app_metadata as any)?.provider === 'apple';
    return (
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <GroupedSection header="Signed in">
          <View style={styles.identityRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.label, fontSize: 16 }}>{user.email}</Text>
              {isApple && (
                <Text style={{ color: theme.tertiaryLabel, fontSize: 13, marginTop: 2 }}>Using Sign in with Apple</Text>
              )}
            </View>
            <Ionicons name="person-circle-outline" size={28} color={theme.secondaryLabel} />
          </View>
        </GroupedSection>

        <GroupedSection
          header="Cloud Backup"
          footnote={`Last backed up: ${lastBackup ? new Date(lastBackup).toLocaleString() : 'Never'}`}
        >
          <Pressable style={styles.actionRow} onPress={doBackup} disabled={busy}>
            <Ionicons name="cloud-upload-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Back up now</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <Pressable style={styles.actionRow} onPress={doRestore} disabled={busy}>
            <Ionicons name="cloud-download-outline" size={20} color={theme.systemRed} />
            <Text style={{ color: theme.systemRed, marginLeft: 10, fontWeight: '600' }}>Restore latest backup</Text>
          </Pressable>
        </GroupedSection>

        <GroupedSection header="Security" footnote="Two-factor authentication, password, email, and device sign-out.">
          <Pressable style={styles.actionRow} onPress={() => router.push('/account/security')}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.label, marginLeft: 10, flex: 1, fontSize: 15 }}>Security</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.tertiaryLabel} />
          </Pressable>
        </GroupedSection>

        <Pressable style={[styles.outlineButton, { borderColor: theme.separator }]} onPress={signOut}>
          <Text style={{ color: theme.label, fontWeight: '600' }}>Sign Out</Text>
        </Pressable>
        <Text style={[styles.centerFootnote, { color: theme.tertiaryLabel }]}>Your budget data stays on this device.</Text>
      </ScrollView>
    );
  }

  // ── Signed out: sign in / create account ────────────────────────────────
  const showApple = Platform.OS === 'ios' && appleAvailable;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {sessionEndedMessage && (
          <View style={[styles.banner, { backgroundColor: theme.accentTint }]}>
            <Text style={{ color: theme.label, flex: 1 }}>{sessionEndedMessage}</Text>
            <Pressable onPress={clearSessionEndedMessage} hitSlop={8} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={theme.secondaryLabel} />
            </Pressable>
          </View>
        )}

        <Text style={[styles.intro, { color: theme.secondaryLabel }]}>
          An optional account backs up and restores your budget. The app works fully offline without one.
        </Text>

        {showApple && (
          <View style={{ gap: spacing.md }}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                mode === 'signIn'
                  ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  : AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
              }
              buttonStyle={
                isDark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={radius.md}
              style={styles.appleButton}
              onPress={doAppleSignIn}
            />
            <OrDivider />
          </View>
        )}

        <GroupedSection
          header={mode === 'signIn' ? 'Sign In' : 'Create Account'}
          footnote={
            mode === 'signUp' ? (
              <Text style={[styles.consent, { color: theme.tertiaryLabel }]}>
                By creating an account you agree to the{' '}
                <Text style={{ color: theme.accent }} onPress={openTerms}>
                  Terms of Use
                </Text>{' '}
                and{' '}
                <Text style={{ color: theme.accent }} onPress={openPrivacy}>
                  Privacy Policy
                </Text>
                .
              </Text>
            ) : undefined
          }
        >
          <AuthTextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            clearable
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="you@example.com"
          />
          <AuthTextField
            ref={passwordRef as any}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signUp' ? 'password-new' : 'password'}
            returnKeyType="go"
            onSubmitEditing={submit}
            placeholder="Password"
          />
          {mode === 'signUp' && (
            <>
              <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
              <StrengthMeter password={password} />
            </>
          )}

          {error && <InlineError message={error} />}
          {info && <InfoNote message={info} tone="success" />}

          <PrimaryButton
            title={mode === 'signIn' ? 'Sign In' : 'Create Account'}
            onPress={submit}
            loading={submitting}
            disabled={!canSubmit}
          />

          {mode === 'signIn' && (
            <TextButton title="Forgot password?" onPress={() => router.push('/account/forgot-password')} />
          )}
        </GroupedSection>

        <TextButton
          title={mode === 'signIn' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          onPress={() => {
            setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
            setError(null);
            setInfo(null);
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  intro: { fontSize: 14, lineHeight: 20, marginHorizontal: spacing.xs },
  consent: { fontSize: 13, lineHeight: 18, marginHorizontal: spacing.md },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  divider: { height: StyleSheet.hairlineWidth },
  outlineButton: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5 },
  centerFootnote: { textAlign: 'center', fontSize: 13, marginTop: -spacing.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, borderRadius: radius.md },
  appleButton: { height: 50, width: '100%' },
});
