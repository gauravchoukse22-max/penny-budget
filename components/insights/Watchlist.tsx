import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from '../Surface';
import { Button, Chip } from '../Button';
import { SectionLabel } from './common';
import { AmountText } from '../AmountText';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, hexToRgba } from '../../theme/colors';
import { addMonths, listTransactionsBetweenMonths } from '../../lib/queries';
import { parseWatchedCategories, serializeWatchedCategories, WATCHLIST_MAX } from '../../lib/insights-layout';

/**
 * Up to 3 categories the user chose to keep an eye on, each compared against
 * its own 3-month average. The choice persists in app_settings (device-local,
 * never synced — lib/insights-layout.ts explains why a reading preference
 * stays on the phone).
 */
export function Watchlist() {
  const theme = useTheme();
  const { selectedMonth, categories, transactions, settings, updateSettings } = useBudget();

  const watched = useMemo(
    // Filter against the live category list so a deleted category silently
    // drops off the watchlist instead of rendering a ghost row.
    () => parseWatchedCategories(settings.watchedCategories).filter((id) => categories.some((c) => c.id === id)),
    [settings.watchedCategories, categories]
  );
  const [picking, setPicking] = useState(false);

  // The 3 months BEFORE the selected month, in one query — the average each
  // watched category is judged against.
  const [prevSpend, setPrevSpend] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    listTransactionsBetweenMonths(addMonths(selectedMonth, -3), addMonths(selectedMonth, -1)).then((txs) => {
      if (!alive) return;
      const map = new Map<string, number>();
      for (const t of txs) {
        if (!t.categoryId) continue;
        map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
      }
      setPrevSpend(map);
    });
    return () => {
      alive = false;
    };
  }, [selectedMonth]);

  const thisMonthByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (!t.categoryId) continue;
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
    }
    return map;
  }, [transactions]);

  const toggleWatched = (id: string) => {
    const next = watched.includes(id) ? watched.filter((w) => w !== id) : [...watched, id].slice(0, WATCHLIST_MAX);
    updateSettings({ watchedCategories: serializeWatchedCategories(next) });
  };

  const showPicker = picking || watched.length === 0;

  return (
    <Surface>
      <View style={styles.headerRow}>
        <SectionLabel title="Watchlist" right="vs 3-Mo Avg" />
      </View>

      {showPicker ? (
        <View>
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            Pick up to {WATCHLIST_MAX} categories to keep an eye on.
          </Text>
          <View style={styles.chipWrap}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={watched.includes(c.id)}
                onPress={() => toggleWatched(c.id)}
                size="sm"
                selectedColor={c.color}
              />
            ))}
          </View>
          {watched.length > 0 && (
            <Button
              label="Done"
              onPress={() => setPicking(false)}
              variant="ghost"
              size="sm"
              style={styles.editLink}
              accessibilityLabel="Done choosing watchlist categories"
            />
          )}
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
          {watched.map((id) => {
            const category = categories.find((c) => c.id === id)!;
            const current = thisMonthByCat.get(id) ?? 0;
            const avg = (prevSpend.get(id) ?? 0) / 3;
            // The bar shows this month against whichever of the two is larger,
            // with a tick at the average — so "over your usual" is visible as
            // the fill crossing the tick, without a second bar to decode.
            const scale = Math.max(current, avg, 1);
            const over = avg > 0 && current > avg;
            return (
              <View key={id}>
                <View style={styles.watchTop}>
                  <Text style={[styles.watchName, { color: theme.label }]} numberOfLines={1}>
                    {category.name}
                  </Text>
                  <View style={styles.watchAmounts}>
                    <AmountText amount={current} currency={settings.currency} size={14} weight="semibold" color={over ? theme.negativeMuted : theme.label} />
                    <Text style={[styles.avgText, { color: theme.tertiaryLabel }]}>avg</Text>
                    <AmountText amount={avg} currency={settings.currency} size={12} color={theme.tertiaryLabel} />
                  </View>
                </View>
                <View style={[styles.track, { backgroundColor: theme.neutralTrack }]}>
                  <View
                    style={{
                      width: `${Math.max(3, (current / scale) * 100)}%`,
                      height: '100%',
                      borderRadius: radius.pill,
                      backgroundColor: over ? theme.negativeMuted : hexToRgba(category.color, 0.8),
                    }}
                  />
                  {avg > 0 && (
                    <View style={[styles.avgTick, { left: `${Math.min(99, (avg / scale) * 100)}%`, backgroundColor: theme.label }]} />
                  )}
                </View>
              </View>
            );
          })}
          <Button label="Edit watchlist" onPress={() => setPicking(true)} variant="ghost" size="sm" style={styles.editLink} />
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { fontSize: 12, marginTop: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  watchTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  watchName: { flex: 1, fontSize: 15, marginRight: spacing.md },
  watchAmounts: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  avgText: { fontSize: 11, marginLeft: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, overflow: 'visible' },
  avgTick: { position: 'absolute', top: -2, width: 2, height: 10, borderRadius: 1, opacity: 0.5 },
  editLink: { alignSelf: 'flex-start', marginTop: spacing.sm },
});
