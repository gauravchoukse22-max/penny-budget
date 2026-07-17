import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Platform, KeyboardAvoidingView, type TextInput as RNTextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote, StrengthMeter } from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { evaluatePassword, MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';

// Serves two modes:
//  - "change" (default): requires the current password (re-auth) then sets a new one.
//  - "add": for an Apple-only account that has no password yet — no current
//    password to check, so we just set one (unlocks sign-in on Android/web).
export default function ChangePasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isAdd = mode === 'add';
  const { changePassword, addPassword } = useAuth();
  useSensitiveScreen('change-password');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const nextRef = useRef<RNTextInput>(null);

  const nextValid = evaluatePassword(next).meetsMinimum;
  const canSubmit = nextValid && (isAdd || current.length > 0);

  const submit = async () => {
    setError(null);
    setDone(null);
    if (!nextValid) {
      setError(`Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const result = isAdd ? await addPassword(next) : await changePassword(current, next);
      if (result.success) setDone(result.message);
      else setError(result.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        <GroupedSection
          header={isAdd ? 'Add a password' : 'Change password'}
          footnote={
            isAdd
              ? 'Your account was created with Sign in with Apple. Adding a password lets you sign in with your email on Android and the web too.'
              : `Enter your current password, then choose a new one (at least ${MIN_PASSWORD_LENGTH} characters).`
          }
        >
          {!isAdd && (
            <AuthTextField
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              secure
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="password"
              returnKeyType="next"
              onSubmitEditing={() => nextRef.current?.focus()}
              placeholder="Current password"
            />
          )}
          <AuthTextField
            ref={nextRef as any}
            label={isAdd ? 'Password' : 'New password'}
            value={next}
            onChangeText={setNext}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="password-new"
            returnKeyType="go"
            onSubmitEditing={submit}
            placeholder={isAdd ? 'Choose a password' : 'New password'}
          />
          <StrengthMeter password={next} />
          {error && <InlineError message={error} />}
          {done && <InfoNote message={done} tone="success" />}
          {!done ? (
            <PrimaryButton title={isAdd ? 'Add password' : 'Change password'} onPress={submit} loading={submitting} disabled={!canSubmit} />
          ) : (
            <TextButton title="Done" onPress={() => router.back()} />
          )}
        </GroupedSection>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
});
