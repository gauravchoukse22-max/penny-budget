import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Platform, KeyboardAvoidingView, type TextInput as RNTextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote, StrengthMeter } from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { isValidEmail, evaluatePassword, MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { resetPassword, verifyRecoveryOtp, updatePassword } = useAuth();
  useSensitiveScreen('forgot-password');

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const passwordRef = useRef<RNTextInput>(null);

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await resetPassword(email.trim());
      if (result.success) {
        setInfo(result.message);
        setStep('reset');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const completeReset = async () => {
    setError(null);
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!evaluatePassword(password).meetsMinimum) {
      setError(`Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const verified = await verifyRecoveryOtp(email.trim(), code.trim());
      if (!verified.success) {
        setError(verified.message);
        return;
      }
      const updated = await updatePassword(password);
      if (updated.success) {
        router.replace('/account');
      } else {
        setError(updated.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        {step === 'request' ? (
          <GroupedSection header="Reset password" footnote="We'll email you a 6-digit code to reset your password. You can also tap the link in that email instead.">
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
              returnKeyType="go"
              onSubmitEditing={sendCode}
              placeholder="you@example.com"
            />
            {error && <InlineError message={error} />}
            {info && <InfoNote message={info} tone="success" />}
            <PrimaryButton title="Send reset code" onPress={sendCode} loading={submitting} disabled={!isValidEmail(email)} />
          </GroupedSection>
        ) : (
          <GroupedSection header="Enter code & new password" footnote={`Code sent to ${email}. New password must be at least ${MIN_PASSWORD_LENGTH} characters.`}>
            <AuthTextField
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123456"
              maxLength={6}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <AuthTextField
              ref={passwordRef as any}
              label="New password"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              autoComplete="password-new"
              returnKeyType="go"
              onSubmitEditing={completeReset}
              placeholder="New password"
            />
            <StrengthMeter password={password} />
            {error && <InlineError message={error} />}
            <PrimaryButton title="Reset password" onPress={completeReset} loading={submitting} disabled={code.trim().length < 6 || !evaluatePassword(password).meetsMinimum} />
            <TextButton title="Use a different email" onPress={() => { setStep('request'); setError(null); setInfo(null); }} color={theme.secondaryLabel} />
          </GroupedSection>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
});
