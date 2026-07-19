import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote } from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { stepUpReauth } from '../../features/biometrics';
import { openSecurity } from '../../lib/legal';
import {
  hasVerifiedTotp,
  listTotpFactorIds,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  type TotpEnrollment,
} from '../../features/mfa';
import { confirmAction, notify } from '../../lib/confirm';

function Row({ icon, label, color, onPress, chevron = true }: { icon: any; label: string; color?: string; onPress: () => void; chevron?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={color ?? theme.accent} />
      <Text style={{ color: color ?? theme.label, marginLeft: 10, flex: 1, fontSize: 15 }}>{label}</Text>
      {chevron && <Ionicons name="chevron-forward" size={18} color={theme.tertiaryLabel} />}
    </Pressable>
  );
}

export default function SecurityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOutAllDevices, deleteAccount } = useAuth();
  useSensitiveScreen('security');

  const isApple = (user?.app_metadata as any)?.provider === 'apple';

  const [totpOn, setTotpOn] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaInfo, setMfaInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasVerifiedTotp().then(setTotpOn);
  }, []);

  const startEnroll = async () => {
    setMfaError(null);
    setMfaInfo(null);
    setMfaBusy(true);
    try {
      const result = await beginTotpEnrollment();
      if (result.success && result.enrollment) setEnrollment(result.enrollment);
      else setMfaError(result.message);
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!enrollment) return;
    setMfaError(null);
    setMfaBusy(true);
    try {
      const result = await confirmTotpEnrollment(enrollment.factorId, code.trim());
      if (result.success) {
        setEnrollment(null);
        setCode('');
        setTotpOn(true);
        setMfaInfo(result.message);
      } else {
        setMfaError(result.message);
      }
    } finally {
      setMfaBusy(false);
    }
  };

  const turnOff = async () => {
    if (await confirmAction({
      title: 'Turn off two-factor?',
      message: 'Your account will no longer require a code from your authenticator app.',
      confirmLabel: 'Turn off',
      destructive: true,
    })) {
      if (!(await stepUpReauth('Confirm to turn off two-factor'))) return;
      setMfaBusy(true);
      try {
        const ids = await listTotpFactorIds();
        for (const id of ids) await disableTotp(id);
        setTotpOn(false);
        setMfaInfo('Two-factor authentication is off.');
      } finally {
        setMfaBusy(false);
      }
    }
  };

  const doSignOutAll = async () => {
    if (await confirmAction({
      title: 'Sign out of all devices?',
      message: 'You will need to sign in again everywhere. Your budget data stays on each device.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
    })) {
      const result = await signOutAllDevices();
      if (!result.success) notify('Could not sign out', result.message);
      else router.replace('/account');
    }
  };

  const doDelete = async () => {
    if (await confirmAction({
      title: 'Delete account?',
      message: 'This permanently deletes your account and your cloud backup. It cannot be undone. The budget data on this device stays and keeps working offline.',
      confirmLabel: 'Delete Account',
      destructive: true,
    })) {
      if (!(await stepUpReauth('Confirm to delete your account'))) return;
      setBusy(true);
      try {
        const result = await deleteAccount();
        notify(result.success ? 'Account deleted' : 'Delete failed', result.message);
        if (result.success) router.replace('/account');
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: theme.groupedBackground }} contentInsetAdjustmentBehavior="automatic">
      {/* Two-factor */}
      <GroupedSection
        header="Two-factor authentication"
        footnote="Adds a one-time code from an authenticator app (Google Authenticator, 1Password, etc.) on top of your password."
      >
        {totpOn === null ? (
          <ActivityIndicator color={theme.accent} />
        ) : enrollment ? (
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 14 }}>
              In your authenticator app, add an account and enter this setup key:
            </Text>
            <Text selectable style={[styles.secret, { color: theme.label, backgroundColor: theme.fieldBackground }]}>
              {enrollment.secret}
            </Text>
            <AuthTextField
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123456"
              maxLength={6}
            />
            {mfaError && <InlineError message={mfaError} />}
            <PrimaryButton title="Verify & turn on" onPress={confirmEnroll} loading={mfaBusy} disabled={code.trim().length < 6} />
            <TextButton title="Cancel" onPress={() => { setEnrollment(null); setCode(''); setMfaError(null); }} color={theme.secondaryLabel} />
          </View>
        ) : totpOn ? (
          <View style={{ gap: spacing.sm }}>
            <View style={styles.statusRow}>
              <Ionicons name="shield-checkmark" size={20} color={theme.systemGreen} />
              <Text style={{ color: theme.label, marginLeft: 8, fontWeight: '600' }}>Two-factor is on</Text>
            </View>
            {mfaInfo && <InfoNote message={mfaInfo} tone="success" />}
            <TextButton title="Turn off two-factor" onPress={turnOff} color={theme.systemRed} align="left" />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13, lineHeight: 18 }}>
              Keep your authenticator app safe: if you lose access to it you'll be locked out of your account. To
              recover, add the same setup key on a new phone (save it somewhere safe), or contact support to reset it
              after verifying your identity.
            </Text>
            {mfaError && <InlineError message={mfaError} />}
            {mfaInfo && <InfoNote message={mfaInfo} tone="success" />}
            <PrimaryButton title="Turn on two-factor" onPress={startEnroll} loading={mfaBusy} />
          </View>
        )}
      </GroupedSection>

      {/* Credentials */}
      <GroupedSection header="Sign-in">
        {isApple ? (
          <Row icon="key-outline" label="Add a password" onPress={() => router.push({ pathname: '/account/change-password', params: { mode: 'add' } })} />
        ) : (
          <Row icon="key-outline" label="Change password" onPress={() => router.push('/account/change-password')} />
        )}
        <View style={[styles.divider, { backgroundColor: theme.separator }]} />
        <Row icon="mail-outline" label="Change email" onPress={() => router.push('/account/change-email')} />
      </GroupedSection>

      {/* Sessions */}
      <GroupedSection header="Devices">
        <Row icon="log-out-outline" label="Sign out of all devices" color={theme.systemRed} onPress={doSignOutAll} chevron={false} />
      </GroupedSection>

      <GroupedSection footnote="Read how Penny Budget protects your data.">
        <Row icon="lock-closed-outline" label="Security & Privacy" onPress={openSecurity} />
      </GroupedSection>

      {/* Danger zone */}
      <Pressable
        style={[styles.outlineButton, { borderColor: theme.systemRed }]}
        onPress={doDelete}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Delete Account</Text>
      </Pressable>
      <Text style={[styles.centerFootnote, { color: theme.tertiaryLabel }]}>
        Permanently deletes your account and cloud backup. Data on this device is untouched.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  divider: { height: StyleSheet.hairlineWidth },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  secret: { fontSize: 16, letterSpacing: 2, padding: 12, borderRadius: radius.sm, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  outlineButton: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1.5 },
  centerFootnote: { textAlign: 'center', fontSize: 13, marginTop: -spacing.sm },
});
