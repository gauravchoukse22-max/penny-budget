import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote } from '../../components/AuthUI';
import { setPendingVerification, clearPendingVerification } from '../../features/pending-verification';

const COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const email = typeof emailParam === 'string' ? emailParam : '';
  const { resendConfirmation, verifyEmailOtp } = useAuth();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (email) setPendingVerification(email);
  }, [email]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return c - 1;
      });
    }, 1000);
  };

  const verify = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError('No email on file. Please sign in again.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await verifyEmailOtp(email, code.trim());
      if (result.success) {
        await clearPendingVerification();
        router.replace('/account');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError('No email on file to resend to. Please sign in again.');
      return;
    }
    const result = await resendConfirmation(email);
    if (result.success) {
      setInfo(result.message);
      startCooldown();
    } else {
      setError(result.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: theme.groupedBackground }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Ionicons name="mail-unread-outline" size={44} color={theme.accent} />
      </View>
      <GroupedSection
        header="Confirm your email"
        footnote={
          email
            ? `Enter the 6-digit code we sent to ${email}. (You can also just tap the link in that email.)`
            : 'Enter the 6-digit code we emailed you. You can also tap the link in that email.'
        }
      >
        <AuthTextField
          label="6-digit code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          placeholder="123456"
          maxLength={6}
          returnKeyType="go"
          onSubmitEditing={verify}
        />
        {error && <InlineError message={error} />}
        {info && <InfoNote message={info} tone="success" />}
        <PrimaryButton title="Confirm" onPress={verify} loading={submitting} disabled={code.trim().length < 6} />
        <TextButton title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'} onPress={resend} />
        <TextButton
          title="Back to sign in"
          onPress={() => { clearPendingVerification(); router.replace('/account'); }}
          color={theme.secondaryLabel}
        />
      </GroupedSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: { alignItems: 'center', paddingTop: spacing.lg },
});
