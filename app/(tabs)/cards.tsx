import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { WalletCard } from '../../components/WalletCard';
import { AmountText } from '../../components/AmountText';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { notify } from '../../lib/confirm';
import { daysUntilDue } from '../../lib/queries';

export default function CardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, settings, addCard } = useBudget();
  const [showAdd, setShowAdd] = useState(false);

  const monthTotal = cards.reduce((sum, c) => sum + (cardTotals.get(c.id) ?? 0), 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title1, { color: theme.label }]}>Cards</Text>
          {cards.length > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryText, { color: theme.secondaryLabel }]}>
                {cards.length} {cards.length === 1 ? 'card' : 'cards'}
                {'   ·   '}
              </Text>
              <AmountText amount={monthTotal} currency={settings.currency} size={13} color={theme.secondaryLabel} />
              <Text style={[styles.summaryText, { color: theme.secondaryLabel }]}> this month</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => setShowAdd(true)}
          hitSlop={8}
          style={[styles.addButton, { borderColor: theme.separator }]}
        >
          <Ionicons name="add" size={22} color={theme.accent} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {cards.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="card-outline" size={30} color={theme.tertiaryLabel} />
            <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>
              No cards yet. Add one to track its balance and due date.
            </Text>
          </View>
        ) : (
          cards.map((c) => {
            const dueIn = daysUntilDue(c.dueDay);
            const dueSoon = dueIn !== null && dueIn <= 5;
            return (
              <View key={c.id} style={styles.cardBlock}>
                <WalletCard
                  card={c}
                  total={cardTotals.get(c.id) ?? 0}
                  currency={settings.currency}
                  onPress={() => router.push(`/card/${c.id}`)}
                />
                {dueIn !== null && (
                  <Text
                    style={[styles.dueHint, { color: dueSoon ? theme.negativeMuted : theme.tertiaryLabel }]}
                  >
                    {dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
                  </Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      <AddCardModal visible={showAdd} onClose={() => setShowAdd(false)} onSave={addCard} usedCount={cards.length} />
    </SafeAreaView>
  );
}

function AddCardModal({
  visible,
  onClose,
  onSave,
  usedCount,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { name: string; lastFour: string; color: string }) => Promise<void>;
  usedCount: number;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [lastFour, setLastFour] = useState('');

  const save = async () => {
    if (!name.trim() || !/^\d{4}$/.test(lastFour.trim())) {
      notify('Check the card details', 'Enter a card name and the last 4 digits (numbers only).');
      return;
    }
    await onSave({ name: name.trim(), lastFour: lastFour.trim(), color: CATEGORY_PALETTE[usedCount % CATEGORY_PALETTE.length] });
    setName('');
    setLastFour('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Scrolling sheet, not a plain View: on a short screen the keyboard
          otherwise sits over the Add Card button with no way to reach it. */}
      <KeyboardAwareScreen
        backgroundColor={theme.groupedBackground}
        contentContainerStyle={styles.modalContent}
      >
        <Text style={[type.title2, { color: theme.label, marginBottom: spacing.xl }]}>New Card</Text>
        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>CARD NAME</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="e.g. Chase Sapphire"
          placeholderTextColor={theme.tertiaryLabel}
          value={name}
          onChangeText={setName}
          maxLength={40}
        />
        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>LAST 4 DIGITS</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="1234"
          placeholderTextColor={theme.tertiaryLabel}
          keyboardType="number-pad"
          maxLength={4}
          value={lastFour}
          onChangeText={(text) => setLastFour(text.replace(/\D/g, ''))}
        />
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl }}>
          <Pressable style={[styles.button, { borderColor: theme.separator, borderWidth: 1 }]} onPress={onClose}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={save}>
            <Text style={{ color: theme.onAccent, fontWeight: '600' }}>Add Card</Text>
          </Pressable>
        </View>
      </KeyboardAwareScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  summaryText: { fontSize: 13 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 60 },
  cardBlock: { gap: spacing.sm },
  dueHint: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: 60, paddingHorizontal: spacing.xxl },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // Scroll content, so no flex: 1 here — that would pin the sheet to the
  // viewport height and stop it scrolling the fields clear of the keyboard.
  modalContent: { padding: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  input: { padding: spacing.md, borderRadius: radius.sm, fontSize: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});
