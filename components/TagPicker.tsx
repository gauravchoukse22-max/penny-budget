import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, IconButton } from './Button';
import { DismissKeyboard } from './DismissKeyboard';
import { confirmAction } from '../lib/confirm';
import { useTheme, spacing, radius, type, tint } from '../theme/colors';
import { deleteTag, ensureTag, listTags, type Tag } from '../features/tags';
import { MAX_TAGS_PER_TRANSACTION, MAX_TAG_NAME_LENGTH, dedupeTagIds, validateTagName } from '../lib/tags';

// The two halves of the tag UI, kept in one file for the same reason Button,
// Chip and IconButton share theirs: they render the same object and would
// otherwise drift into two different-looking tags.
//
//   • TagChips — read-only, for a transaction row or a detail screen.
//   • TagPicker — the modal that edits which tags a transaction carries.

// ── TagChips ────────────────────────────────────────────────────────────────

/**
 * A transaction's tags, inline and non-interactive.
 *
 * Deliberately NOT built on Chip from components/Button.tsx: Chip is a
 * selectable control and carries a button role, and putting one inside a
 * transaction row would announce a tappable thing to VoiceOver that does
 * nothing and would swallow the row's own press. This is a label.
 *
 * The colour is the tag's own (derived from its name in lib/tags.ts, so both
 * phones agree) as a tint rather than a solid fill — a row of solid colour
 * blocks competes with the category icon and the amount, which are what the
 * user is actually scanning for.
 */
export function TagChips({
  tags,
  size = 'md',
  style,
}: {
  tags: Pick<Tag, 'id' | 'name' | 'color'>[];
  /** `sm` is for dense transaction rows. */
  size?: 'sm' | 'md';
  style?: React.ComponentProps<typeof View>['style'];
}) {
  const theme = useTheme();
  if (tags.length === 0) return null;
  const small = size === 'sm';
  return (
    <View style={[styles.chipWrap, style]}>
      {tags.map((tag) => (
        <View
          key={tag.id}
          style={[
            styles.tagChip,
            {
              backgroundColor: tint(tag.color, 0.16),
              borderColor: tint(tag.color, 0.45),
              paddingHorizontal: small ? 6 : 8,
              paddingVertical: small ? 1 : 3,
            },
          ]}
        >
          <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
          <Text
            numberOfLines={1}
            style={{ color: theme.label, fontSize: small ? 11 : 12, fontWeight: '600' }}
          >
            {tag.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── TagPicker ───────────────────────────────────────────────────────────────

export interface TagPickerProps {
  visible: boolean;
  onClose: () => void;
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

/**
 * Pick, create and delete tags.
 *
 * Creating a tag writes it to the database immediately, before the transaction
 * that prompted it is saved. That is intentional: tags are a shared vocabulary
 * for the whole household, not a property of one transaction, and a tag typed
 * on a transaction the user then abandons is still a tag they meant to have.
 * The alternative — holding new tags in memory until save — loses them on every
 * cancelled edit and makes "vacation" get retyped (and re-derived, and
 * re-synced) repeatedly.
 *
 * Selection is NOT written here. The caller owns it and persists it on save, so
 * backing out of a transaction edit does not leave it re-tagged.
 */
export function TagPicker({ visible, onClose, selectedTagIds, onChange }: TagPickerProps) {
  const theme = useTheme();
  const [tags, setTags] = useState<Tag[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setTags(await listTags());
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const selected = new Set(selectedTagIds);
  const atLimit = selected.size >= MAX_TAGS_PER_TRANSACTION;

  const toggle = (tagId: string) => {
    if (selected.has(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
      return;
    }
    // The cap is enforced here rather than by disabling every unselected chip:
    // a screen of dimmed chips looks broken, whereas a chip that refuses with a
    // visible reason is understandable. The reason is the footer line below.
    if (atLimit) return;
    onChange(dedupeTagIds([...selectedTagIds, tagId]));
  };

  const create = async () => {
    const problem = validateTagName(draft);
    if (problem !== null) return;
    setBusy(true);
    try {
      const tag = await ensureTag(draft);
      setDraft('');
      await load();
      // Select it straight away — the user typed a name in order to apply it,
      // and making them then find it in the list is a second step for nothing.
      // Unless they are already at the cap, in which case the tag is still
      // created (it is now in the vocabulary) but not applied.
      if (tag && !selected.has(tag.id) && !atLimit) onChange(dedupeTagIds([...selectedTagIds, tag.id]));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tag: Tag) => {
    const confirmed = await confirmAction({
      title: `Delete "${tag.name}"?`,
      // Says what is and is not destroyed. Deleting a tag removing transactions
      // is the thing a user reasonably fears here, and it does not.
      message: 'It will be removed from every transaction that has it. The transactions themselves are not affected.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    await deleteTag(tag.id);
    onChange(selectedTagIds.filter((id) => id !== tag.id));
    await load();
  };

  const draftProblem = draft.trim().length > 0 ? validateTagName(draft) : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* A modal sheet with a text input and no scroll view at the top level —
          exactly what DismissKeyboard exists for. */}
      <DismissKeyboard style={{ backgroundColor: theme.groupedBackground }}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={[type.title2, { color: theme.label }]}>Tags</Text>
            <IconButton icon="close" accessibilityLabel="Close" size="sm" onPress={onClose} />
          </View>

          <Text style={[styles.hint, { color: theme.secondaryLabel }]}>
            A tag cuts across categories — tag a flight, a dinner and a taxi "vacation" and see the whole trip in one
            total, without moving any of them out of their own category.
          </Text>

          <View style={styles.createRow}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              placeholder="New tag name"
              placeholderTextColor={theme.tertiaryLabel}
              value={draft}
              onChangeText={setDraft}
              maxLength={MAX_TAG_NAME_LENGTH + 8}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={create}
              accessibilityLabel="New tag name"
            />
            <Button
              label="Add"
              variant="tonal"
              size="md"
              loading={busy}
              disabled={draftProblem !== null || draft.trim().length === 0}
              onPress={create}
            />
          </View>
          {draftProblem === 'too-long' && (
            <Text style={[styles.problem, { color: theme.systemRed }]}>
              Tag names are at most {MAX_TAG_NAME_LENGTH} characters.
            </Text>
          )}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            {tags.length === 0 ? (
              // An empty state that says what a tag IS, not just that there are
              // none — this is the first time most users will meet the concept.
              <View style={styles.empty}>
                <Ionicons name="pricetags-outline" size={34} color={theme.tertiaryLabel} />
                <Text style={[styles.emptyTitle, { color: theme.label }]}>No tags yet</Text>
                <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
                  Try "vacation", "work trip" or "reimbursable".
                </Text>
              </View>
            ) : (
              tags.map((tag) => (
                <View key={tag.id} style={styles.tagRow}>
                  <Chip
                    label={tag.name}
                    icon="pricetag"
                    selected={selected.has(tag.id)}
                    onPress={() => toggle(tag.id)}
                    style={styles.rowChip}
                  />
                  <IconButton
                    icon="trash-outline"
                    variant="destructive"
                    size="sm"
                    accessibilityLabel={`Delete tag ${tag.name}`}
                    onPress={() => remove(tag)}
                  />
                </View>
              ))
            )}
          </ScrollView>

          <Text style={[styles.footer, { color: atLimit ? theme.systemAmber : theme.tertiaryLabel }]}>
            {atLimit
              ? `${MAX_TAGS_PER_TRANSACTION} tags is the maximum — remove one to add another.`
              : `${selected.size} of ${MAX_TAGS_PER_TRANSACTION} selected`}
          </Text>
          <Button label="Done" variant="primary" size="lg" full onPress={onClose} />
        </View>
      </DismissKeyboard>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: spacing.xl, paddingTop: 40, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { fontSize: 13, lineHeight: 18 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, height: 46, paddingHorizontal: spacing.md, borderRadius: radius.sm, fontSize: 15 },
  problem: { fontSize: 12, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingVertical: spacing.sm, gap: spacing.sm },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // The chip takes the row and the delete button sits at the end, so the tap
  // target for selecting is large and the destructive one stays small.
  rowChip: { flex: 1, justifyContent: 'flex-start' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xxl },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  footer: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 140,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
});
