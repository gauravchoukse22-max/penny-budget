import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme, spacing, radius } from '../theme/colors';
import { confirmAction } from '../lib/confirm';
import { tapMedium } from '../lib/haptics';

/**
 * What to ask before the delete runs. Omit it entirely for rows whose deletion
 * costs the user nothing to redo — an extra dialog on a single low-value row
 * trains people to dismiss dialogs, which is what makes the dialog on a
 * genuinely destructive row stop working.
 */
export type SwipeConfirm = {
  title: string;
  message?: string;
  confirmLabel?: string;
};

type Props = {
  children: React.ReactNode;
  onDelete: () => void | Promise<void>;
  /**
   * A function is resolved at swipe time rather than on every render, so a
   * message can name a cost that has to be counted first ("deletes 24
   * transactions") without that count being queried for every row on screen.
   */
  confirm?: SwipeConfirm | (() => SwipeConfirm | Promise<SwipeConfirm>);
  /** Spoken by VoiceOver/TalkBack — "Delete" alone doesn't say delete what. */
  accessibilityLabel: string;
  /** Off while a screen is in a mode where the row means something else. */
  enabled?: boolean;
  /** Lets a row match the red panel to its own corner radius and insets. */
  actionStyle?: StyleProp<ViewStyle>;
};

// Every swipe row in the app opens the same way — drag left, red panel, the
// word "Delete" — so the gesture is learned once instead of per screen.
const ACCESSIBILITY_ACTIONS = [{ name: 'delete', label: 'Delete' }];

/**
 * Wraps a list row so dragging it left reveals a red Delete panel.
 *
 * Built on gesture-handler's Animated-based `Swipeable` rather than
 * `ReanimatedSwipeable`: react-native-reanimated is not a dependency of this
 * app, and the Reanimated variant imports it at module load, so it would crash
 * the bundle rather than degrade.
 *
 * The gesture NEVER deletes on its own — revealing the panel and pressing it
 * are two separate deliberate acts. That is what makes it safe to put this on
 * rows whose deletion cascades, and it is why some rows need no dialog at all.
 */
export function SwipeToDelete({
  children,
  onDelete,
  confirm,
  accessibilityLabel,
  enabled = true,
  actionStyle,
}: Props) {
  const theme = useTheme();
  const swipeRef = useRef<Swipeable>(null);

  const run = useCallback(async () => {
    if (confirm) {
      const spec = typeof confirm === 'function' ? await confirm() : confirm;
      const ok = await confirmAction({
        title: spec.title,
        message: spec.message,
        confirmLabel: spec.confirmLabel ?? 'Delete',
        destructive: true,
      });
      // Close on a cancel too, so a declined dialog doesn't leave the row
      // sitting open with the red panel still armed under the user's thumb.
      if (!ok) {
        swipeRef.current?.close();
        return;
      }
    }
    tapMedium();
    swipeRef.current?.close();
    await onDelete();
  }, [confirm, onDelete]);

  if (!enabled) return <>{children}</>;

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      // Without this the panel rubber-bands past its own width and the row
      // behind it shows through the gap.
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={run}
          style={[styles.action, { backgroundColor: theme.systemRed }, actionStyle]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Ionicons name="trash" size={18} color="#FFFFFF" />
          <Text style={styles.actionLabel}>Delete</Text>
        </Pressable>
      )}
    >
      {/* A screen reader cannot perform a drag, so the same delete is also
          published as a row action for the rotor / TalkBack menu. Rows here
          additionally keep a visible control or a detail screen — this is the
          extra path, not the only one. */}
      <View
        accessibilityActions={ACCESSIBILITY_ACTIONS}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') run();
        }}
      >
        {children}
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.md,
    marginLeft: spacing.sm,
  },
  actionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
