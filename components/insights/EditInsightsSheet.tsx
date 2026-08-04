import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Switch, ScrollView } from 'react-native';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Button, IconButton } from '../Button';
import { INSIGHT_CARD_INFO, type InsightCardPref } from '../../lib/insights-layout';

/**
 * The customizer behind the Insights tab's Edit button: every card with a
 * show/hide switch, and up/down arrows to reorder. Arrows instead of drag —
 * an 8-item list doesn't earn a gesture library dependency, and arrows are
 * one-handed, which is how this app's owner actually uses his phone.
 *
 * The sheet edits the SAME pref array the screen renders from and hands each
 * change straight back via onChange; the parent persists it to app_settings.
 * No local draft/apply step: with the sheet as an overlay, watching the cards
 * themselves reorder underneath is the preview.
 */
export function EditInsightsSheet({
  visible,
  prefs,
  onChange,
  onClose,
}: {
  visible: boolean;
  prefs: InsightCardPref[];
  onChange: (next: InsightCardPref[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const infoById = new Map(INSIGHT_CARD_INFO.map((c) => [c.id, c]));

  const setVisible = (index: number, value: boolean) => {
    const next = prefs.map((p, i) => (i === index ? { ...p, visible: value } : p));
    onChange(next);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= prefs.length) return;
    const next = [...prefs];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the dim area closes — the standard sheet-dismiss affordance. */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.secondaryBackground }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.label }]}>Customize Insights</Text>
          <Button label="Done" onPress={onClose} variant="ghost" size="sm" accessibilityLabel="Done customizing insights" />
        </View>
        <Text style={[styles.subtitle, { color: theme.tertiaryLabel }]}>
          Choose which cards show, and in what order.
        </Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          {prefs.map((p, i) => {
            const info = infoById.get(p.id);
            if (!info) return null; // parseInsightsLayout already filters; belt and braces
            return (
              <View
                key={p.id}
                style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
              >
                <View style={styles.arrows}>
                  <IconButton
                    icon="chevron-up"
                    onPress={() => move(i, -1)}
                    disabled={i === 0}
                    accessibilityLabel={`Move ${info.title} up`}
                  />
                  <IconButton
                    icon="chevron-down"
                    onPress={() => move(i, 1)}
                    disabled={i === prefs.length - 1}
                    accessibilityLabel={`Move ${info.title} down`}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: p.visible ? theme.label : theme.secondaryLabel }]}>{info.title}</Text>
                  <Text style={[styles.rowDesc, { color: theme.tertiaryLabel }]} numberOfLines={1}>
                    {info.description}
                  </Text>
                </View>
                <Switch value={p.visible} onValueChange={(v) => setVisible(i, v)} />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  arrows: { flexDirection: 'row', gap: 2 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowDesc: { fontSize: 12, marginTop: 2 },
});
