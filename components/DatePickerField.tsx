import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, useColorScheme } from 'react-native';
import { SheetModal } from './SheetModal';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatDayLabel } from '../lib/format';
import { DateField } from './DateField';
import { Button } from './Button';
import { tapLight } from '../lib/haptics';

// iOS' inline calendar has no intrinsic height inside a sheet — this fits a
// full six-row month plus its month header without scrolling.
const INLINE_PICKER_HEIGHT = 380;

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Date row plus a picker that can actually be dismissed.
 *
 * iOS' inline picker draws no chrome of its own, so once mounted there was no
 * way to put it away — it sat under the field for the rest of the session.
 * Presenting it in the app's standard pageSheet (same shape as
 * NumberEditorSheet) gives it a Cancel/Done header, and holding the selection
 * in a draft means backing out leaves the committed date alone. Android's
 * picker is a native dialog that dismisses itself, so it stays inline there.
 */
export function DatePickerField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // A screen that fills its fields from an effect has an empty `value` for the
  // first frame — fall back to today rather than rendering "Invalid Date".
  const iso = value || toIsoDate(new Date());

  // Web has no native picker at all — DateField renders a real <input
  // type="date"> there, so hand off rather than duplicate that branch.
  if (Platform.OS === 'web') return <DateField value={iso} onChange={onChange} />;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Date: ${formatDayLabel(iso)}`}
        style={[styles.dateBox, { backgroundColor: theme.fieldBackground }]}
        onPress={() => {
          tapLight();
          // Always reopen on the committed date, never a stale draft.
          setDraft(iso);
          setOpen(true);
        }}
      >
        <Text style={{ color: theme.label, fontSize: 15 }}>{formatDayLabel(iso)}</Text>
        <Ionicons name="calendar-outline" size={18} color={theme.secondaryLabel} />
      </Pressable>

      {Platform.OS === 'android' && open && (
        <DateTimePicker
          value={new Date(`${iso}T00:00:00`)}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            // The dialog has already closed itself by the time this fires;
            // unmount it so the next tap opens a fresh one.
            setOpen(false);
            if (event.type === 'set' && selected) onChange(toIsoDate(selected));
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <SheetModal visible={open} onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
            <View style={styles.sheetHeader}>
              <Button label="Cancel" onPress={() => setOpen(false)} variant="ghost" size="sm" />
              <Text style={[type.headline, { color: theme.label }]}>Date</Text>
              <Button
                label="Done"
                variant="primary"
                size="sm"
                onPress={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              />
            </View>
            <DateTimePicker
              value={new Date(`${draft}T00:00:00`)}
              mode="date"
              display="inline"
              accentColor={theme.accent}
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
              style={styles.inlinePicker}
              onChange={(_, selected) => {
                if (selected) setDraft(toIsoDate(selected));
              }}
            />
          </View>
        </SheetModal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dateBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: radius.sm },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  inlinePicker: { height: INLINE_PICKER_HEIGHT, marginHorizontal: spacing.sm },
});
