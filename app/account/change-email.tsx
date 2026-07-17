import React, { useState } from 'react';
import { ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing } from '../../theme/colors';
import { GroupedSection, AuthTextField, PrimaryButton, TextButton, InlineError, InfoNote } from '../../components/AuthUI';
import { useSensitiveScreen } from '../../features/privacy-screen';
import { isValidEmail } from '../../lib/passwordStrength';

export default function ChangeEmailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, changeEmail } = useAuth();
  useSensitiveScreen('change-email');

  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSent(null);
    if (!isValidEmail(newEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await changeEmail(newEmail.trim());
      if (result.success) setSent(result.message);
      else setError(result.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
        <GroupedSection
          header="Change email"
          footnote="For your security, we send confirmation links to BOTH your current and new address. The change takes effect only after you confirm from both."
        >
          <Text style={{ color: theme.secondaryLabel, fontSize: 14 }}>Current: {user?.email ?? '—'}</Text>
          <AuthTextField
            label="New email"
            value={newEmail}
            onChangeText={setNewEmail}
            clearable
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={submit}
            placeholder="new@example.com"
          />
          {error && <InlineError message={error} />}
          {sent && <InfoNote message={sent} tone="success" />}
          {!sent ? (
            <PrimaryButton title="Send confirmation links" onPress={submit} loading={submitting} disabled={!isValidEmail(newEmail)} />
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
