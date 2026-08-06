import React from 'react';
import { Modal, Platform, View, type ModalProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A slide-up sheet, safe on both platforms.
 *
 * On iOS `presentationStyle="pageSheet"` insets the card from the top of the
 * screen, so its header clears the status bar for free. Android ignores
 * presentationStyle entirely — and this app runs edge-to-edge
 * (`expo.edgeToEdgeEnabled=true`), so a plain Modal draws BEHIND the status
 * bar. Every sheet whose first row was a header put Cancel/Save underneath the
 * clock, where the system bar swallows the touches: the buttons rendered
 * perfectly and did nothing.
 *
 * That was the number editor's state on Android — a budget could be typed but
 * neither saved nor cancelled, only backed out of.
 *
 * So: pad by the top inset, Android only. iOS keeps the inset it already has,
 * and padding it again would leave a gap.
 */
export function SheetModal({ children, ...props }: ModalProps & { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" {...props}>
      <View style={{ flex: 1, paddingTop: Platform.OS === 'android' ? insets.top : 0 }}>{children}</View>
    </Modal>
  );
}
