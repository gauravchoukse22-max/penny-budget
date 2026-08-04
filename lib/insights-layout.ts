// The Insights tab's card layout — which cards show, and in what order.
//
// Persisted as a JSON string in app_settings.insightsLayout. That table is
// device-local ON PURPOSE: it never syncs (it also holds the biometric lock and
// household id), and which insights someone wants to see is a personal reading
// preference, not shared budget data — Gary hiding the trend chart should not
// hide it on Disha's phone.

/** Every card the Insights tab can render. Adding a card here (and to the
 * registry below) is all an app update needs — see parseInsightsLayout for how
 * old saved layouts absorb new ids without crashing. */
export type InsightCardId =
  | 'headline'
  | 'money-map'
  | 'biggest-changes'
  | 'recurring-watch'
  | 'watchlist'
  | 'outlook'
  | 'spending-trend'
  | 'where-it-goes';

export type InsightCardPref = { id: InsightCardId; visible: boolean };

/** Registry: canonical order for brand-new installs, plus the names the edit
 * sheet shows. One entry per card, same order as DEFAULT_INSIGHTS_LAYOUT. */
export const INSIGHT_CARD_INFO: Array<{ id: InsightCardId; title: string; description: string }> = [
  { id: 'headline', title: 'Month Headline', description: 'One sentence: what you kept of what you made' },
  { id: 'money-map', title: 'Money Map', description: 'Where your income flowed this month' },
  { id: 'biggest-changes', title: 'Biggest Changes', description: 'Top category swings vs last month' },
  { id: 'recurring-watch', title: 'Recurring Watch', description: 'Likely subscriptions you are not tracking' },
  { id: 'outlook', title: 'Month-End Outlook', description: 'Which budgets are pacing over' },
  { id: 'watchlist', title: 'Watchlist', description: 'Up to 3 categories vs their 3-month average' },
  { id: 'spending-trend', title: 'Spending Trend', description: '6-month spend chart' },
  { id: 'where-it-goes', title: 'Where It Goes', description: 'Ranked category breakdown' },
];

const KNOWN_IDS = new Set<InsightCardId>(INSIGHT_CARD_INFO.map((c) => c.id));

/**
 * The default: five high-signal cards on, three off. Deliberately NOT
 * everything — a review screen that opens on eight stat blocks reads as noise,
 * and the point of the customizer is that the people who want the extra three
 * can switch them on rather than everyone scrolling past them.
 */
export const DEFAULT_INSIGHTS_LAYOUT: InsightCardPref[] = [
  { id: 'headline', visible: true },
  { id: 'money-map', visible: true },
  { id: 'biggest-changes', visible: true },
  { id: 'recurring-watch', visible: true },
  { id: 'outlook', visible: true },
  { id: 'watchlist', visible: false },
  { id: 'spending-trend', visible: false },
  { id: 'where-it-goes', visible: false },
];

/**
 * Reads a saved layout back, defensively, because the JSON outlives the build
 * that wrote it in both directions:
 * - unknown ids are dropped (a downgrade must not render a card it has no
 *   component for),
 * - known cards missing from the JSON are appended at the end, HIDDEN (an app
 *   update that adds a card must not crash an old layout — and must not barge
 *   into a list the user already curated),
 * - anything unparseable falls back to the default rather than a blank tab.
 */
export function parseInsightsLayout(json: string | null | undefined): InsightCardPref[] {
  if (!json) return DEFAULT_INSIGHTS_LAYOUT.map((p) => ({ ...p }));
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_INSIGHTS_LAYOUT.map((p) => ({ ...p }));
  }
  if (!Array.isArray(raw)) return DEFAULT_INSIGHTS_LAYOUT.map((p) => ({ ...p }));

  const prefs: InsightCardPref[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || !KNOWN_IDS.has(id as InsightCardId) || seen.has(id)) continue;
    seen.add(id);
    prefs.push({ id: id as InsightCardId, visible: !!(entry as { visible?: unknown }).visible });
  }
  for (const info of INSIGHT_CARD_INFO) {
    if (!seen.has(info.id)) prefs.push({ id: info.id, visible: false });
  }
  return prefs;
}

export function serializeInsightsLayout(prefs: InsightCardPref[]): string {
  return JSON.stringify(prefs.map((p) => ({ id: p.id, visible: p.visible })));
}

// ── Watchlist (which categories the Watchlist card tracks) ──────────────────
// Same storage story: a JSON array of category ids in app_settings, device-local.

export const WATCHLIST_MAX = 3;

/** Category ids the user chose to watch. Ids that no longer exist are filtered
 * by the card at render time (it has the live category list; this parser does
 * not), so a deleted category simply drops off the watchlist. */
export function parseWatchedCategories(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string').slice(0, WATCHLIST_MAX);
  } catch {
    return [];
  }
}

export function serializeWatchedCategories(ids: string[]): string {
  return JSON.stringify(ids.slice(0, WATCHLIST_MAX));
}
