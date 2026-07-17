import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Platform, KeyboardAvoidingView, View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, StrengthMeter } from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { evaluatePassword, MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';

export default function UpdatePasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { passwordRecovery, updatePassword, user } = useAuth();
  useSensitiveScreen('update-password');

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery session arrives a beat after the deep link is opened. Wait
  // briefly before deciding the link was bad, so a valid link doesn't flash the
  // "expired" state.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const active = passwordRecovery || !!user;

  const submit = async () => {
    setError(null);
    if (!evaluatePassword(password).meetsMinimum) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await updatePassword(password);
      if (result.success) setDone(true);
      else setError(result.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!active && !waited) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.groupedBackground }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!active) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: theme.groupedBackground }} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection
          header="Link expired"
          footnote="This reset link is invalid or has already been used. Request a new one and try again."
        >
          <Text style={{ color: theme.label, fontSize: 16 }}>We couldn't verify this reset link.</Text>
          <PrimaryButton title="Request a new link" onPress={() => router.replace('/account/forgot-password')} />
        </GroupedSection>
      </ScrollView>
    );
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: theme.groupedBackground }} contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header="Password updated" footnote="You're all set — your new password is active.">
          <Text style={{ color: theme.label, fontSize: 16 }}>Your password has been updated.</Text>
          <PrimaryButton title="Continue" onPress={() => router.replace('/account')} />
        </GroupedSection>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        <GroupedSection header="New password" footnote={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <AuthTextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="password-new"
            returnKeyType="go"
            onSubmitEditing={submit}
            placeholder="New password"
          />
          <StrengthMeter password={password} />
          {error && <InlineError message={error} />}
          <PrimaryButton title="Update password" onPress={submit} loading={submitting} disabled={!evaluatePassword(password).meetsMinimum} />
        </GroupedSection>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
