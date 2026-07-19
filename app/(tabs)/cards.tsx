import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { WalletCard } from '../../components/WalletCard';
import { confirmAction, notify } from '../../lib/confirm';
import { daysUntilDue } from '../../lib/queries';

export default function CardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, settings, addCard } = useBudget();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={[type.title1, { color: theme.label }]}>Cards</Text>
        <Pressable onPress={() => setShowAdd(true)} hitSlop={8}>
          <Ionicons name="add-circle" size={30} color={theme.accent} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {cards.length === 0 ? (
          <Text style={{ color: theme.tertiaryLabel, textAlign: 'center', marginTop: 40 }}>No cards yet — add your first card</Text>
        ) : (
          cards.map((c) => {
            const dueIn = daysUntilDue(c.dueDay);
            return (
              <View key={c.id}>
                <WalletCard
                  card={c}
                  total={cardTotals.get(c.id) ?? 0}
                  currency={settings.currency}
                  onPress={() => router.push(`/card/${c.id}`)}
                />
                {dueIn !== null && (
                  <Text style={[styles.dueHint, { color: dueIn <= 5 ? theme.systemRed : theme.tertiaryLabel }]}>
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
      <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>New Card</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Card name (e.g. Chase Sapphire)"
          placeholderTextColor={theme.tertiaryLabel}
          value={name}
          onChangeText={setName}
          maxLength={40}
        />
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Last 4 digits"
          placeholderTextColor={theme.tertiaryLabel}
          keyboardType="number-pad"
          maxLength={4}
          value={lastFour}
          onChangeText={(text) => setLastFour(text.replace(/\D/g, ''))}
        />
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          <Pressable style={[styles.button, { borderColor: theme.separator, borderWidth: 1 }]} onPress={onClose}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={save}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  content: { padding: spacing.lg, gap: 14, paddingBottom: 60 },
  dueHint: { fontSize: 12, fontWeight: '600', marginTop: 6, marginLeft: 4 },
  modalContent: { flex: 1, padding: 20, paddingTop: 40 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginBottom: 12 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});
