import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { CHANGELOG } from '../../lib/changelog';
import { markChangelogSeen } from '../../features/whats-new';

export default function WhatsNewScreen() {
  const theme = useTheme();
  const router = useRouter();

  // Opening this screen counts as "seen" — it won't auto-open again until the
  // next perceptible change bumps the changelog id.
  useEffect(() => {
    markChangelogSeen();
  }, []);

  /**
   * "Got it" used to call router.back() alone, and on launch that does nothing.
   * This screen is pushed by the root layout the moment the app is ready, which
   * can land it as the only entry in the navigation history — and back() on an
   * empty history is a no-op, so the button was dead. Verified on the simulator:
   * the sheet scrolled, the tap registered, and it would not close. It was
   * escapable only by swiping the sheet down, which is not something to rely on
   * a first-launch user discovering.
   */
  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="sparkles" size={28} color={theme.accent} />
          <Text style={[type.title1, { color: theme.label, marginTop: spacing.sm }]}>What's New</Text>
          <Text style={[styles.sub, { color: theme.secondaryLabel }]}>
            The changes you can feel and try out in this build.
          </Text>
        </View>

        {CHANGELOG.map((entry) => (
          <Surface key={entry.id}>
            <View style={styles.entryHead}>
              <Text style={[styles.entryTitle, { color: theme.label }]}>{entry.title}</Text>
              <Text style={[styles.entryMeta, { color: theme.tertiaryLabel }]}>
                v{entry.version} · {entry.date}
              </Text>
            </View>
            {entry.changes.map((change, i) => (
              <View key={i} style={styles.changeRow}>
                <Ionicons name="checkmark-circle" size={18} color={theme.accent} style={styles.changeIcon} />
                <Text style={[styles.changeText, { color: theme.secondaryLabel }]}>{change}</Text>
              </View>
            ))}
          </Surface>
        ))}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.separator }]}>
        <Button label="Got it" onPress={dismiss} variant="primary" size="lg" full />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  sub: { fontSize: 14, textAlign: 'center', marginTop: 4, maxWidth: 300 },
  entryHead: { marginBottom: spacing.md },
  entryTitle: { fontSize: 18, fontWeight: '700' },
  entryMeta: { fontSize: 12, marginTop: 3 },
  changeRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  changeIcon: { marginTop: 1, marginRight: 10 },
  changeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
