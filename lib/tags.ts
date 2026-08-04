// Cross-category tags — "vacation", "work trip", "reimbursable".
//
// Pure: no db, no React, no native modules — scripts/test-tags.mjs imports it
// under plain Node. features/tags.ts does the storage, the transaction screens
// do the UI.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A category answers "what kind of spending is this?" and a transaction gets
// exactly one. A tag answers "what was this FOR?", and that question cuts
// across categories: a vacation is flights (Travel), dinners (Dining) and a
// pharmacy run (Health). Forcing it into a category means either inventing a
// "Vacation" category that competes with the real ones for the same money, or
// losing the question entirely. YNAB's flags and Simplifi's tags both exist for
// this. The payoff is the total: "we spent $2,140 on the Portugal trip" is not
// answerable from categories at all.
//
// ── Ids are derived from the NAME, never uuid() ─────────────────────────────
// Both members of a household will type "vacation" on their own phone. With a
// random id that is two rows, two chips in the picker and two totals that each
// look plausible — the duplicate-categories bug described in lib/models.ts,
// again. Deriving the id from the normalized name makes the two devices write
// the SAME row, and last-writer-wins then merges them instead of doubling them
// (AGENTS.md rule 2, same reasoning as `nw-<yearMonth>` in net_worth_snapshots).
//
// The cost is that a tag cannot be RENAMED in place: the id would have to
// change, which orphans every join row pointing at it. Rename was considered
// and left out rather than shipped half-working — it is delete-and-retag under
// another name, and doing it silently on the user's behalf would be three
// journaled operations racing the other device mid-edit. Deleting a tag and
// re-tagging is the honest version of the same thing.
//
// ── Why not a UNIQUE(name) column with a random id ──────────────────────────
// Tried on paper and rejected: the sync pull applies remote rows with
// `INSERT OR REPLACE INTO tags (...)` keyed on the PRIMARY KEY, so device A's
// "vacation" (id X) landing on device B, which already holds "vacation" under
// id Y, violates UNIQUE(name) and THROWS. That throw is inside the pull's
// withTransactionAsync, so it does not just skip the row — it stalls the whole
// household's sync. A derived primary key cannot disagree with its own natural
// key, which is exactly why net_worth_snapshots does the same thing.

/** Longest tag name we accept. Long enough for "reimbursable — client", short
 * enough that a row of chips on a transaction stays readable. */
export const MAX_TAG_NAME_LENGTH = 32;

/**
 * Most tags one transaction may carry.
 *
 * Not a storage limit — the join table would happily take twenty. It is a
 * legibility limit: the transaction row shows its tags as chips, and past a
 * handful they either overflow the row or shrink to unreadable. Five covers
 * every real use ("vacation" + "reimbursable" is the common case, two).
 */
export const MAX_TAGS_PER_TRANSACTION = 5;

export type TagNameError = 'empty' | 'too-long';

/**
 * The canonical form of a name as TYPED: trimmed, internal whitespace
 * collapsed, a leading "#" dropped.
 *
 * The "#" matters because users type it out of habit from every other tagging
 * UI, and without this "#vacation" and "vacation" are two different tags that
 * look identical in a list of chips.
 *
 * This is the DISPLAY form and it keeps the user's capitalisation — "Portugal"
 * should not come back as "portugal". Matching is done on tagNameKey().
 */
export function normalizeTagName(raw: string): string {
  // Trim BEFORE stripping the hash, not after: a name pasted or typed as
  // " #vacation" starts with a space, so an anchored ^#+ would not match it and
  // "#vacation" would survive as a second tag sitting next to "vacation" —
  // exactly the duplicate this normalisation exists to prevent. Trim again at
  // the end because "# vacation" leaves a leading space behind.
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
}

/** The form two names are compared by — case-insensitive, so "Vacation" typed
 * on one phone and "vacation" on the other are one tag rather than two. */
export function tagNameKey(raw: string): string {
  return normalizeTagName(raw).toLowerCase();
}

export function validateTagName(raw: string): TagNameError | null {
  const name = normalizeTagName(raw);
  if (name.length === 0) return 'empty';
  if (name.length > MAX_TAG_NAME_LENGTH) return 'too-long';
  return null;
}

/**
 * FNV-1a, 32-bit, as 8 hex chars.
 *
 * Hand-rolled because the id has to be identical on both phones and computed
 * synchronously while typing — expo-crypto's digest is async and its output is
 * far longer than an id needs to be. Runs over UTF-16 code units, which is what
 * every JS engine gives for charCodeAt, so iOS and Android agree.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul, not `*`: the product overflows 2^53 and plain multiplication
    // silently loses the low bits that carry the hash.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The ASCII-safe, human-readable half of an id. May be empty — a name with no
 * Latin letters or digits ("休暇", "🏖") slugs to nothing, which is fine
 * because the hash after it is what actually identifies the tag. */
function slugify(nameKey: string): string {
  return nameKey
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
}

/**
 * The tag's primary key, derived from its name.
 *
 * Shape is `tag-<slug>-<hash>`. The slug is there so a human reading the
 * database or a sync payload can tell which tag a row is; the hash is what
 * makes it correct. A slug alone would collide — every name without Latin
 * characters slugs to the empty string, so "休暇" and "🏖" would become the
 * SAME tag and silently merge two unrelated totals. The hash is taken over the
 * full name key, so distinct names stay distinct whatever alphabet they are in.
 *
 * ASCII-only by construction, because this id ends up as a CloudKit record
 * name when the native adapter ships (docs/cloudkit-setup.md) and those are
 * restricted to ASCII.
 */
export function tagId(name: string): string {
  const key = tagNameKey(name);
  return `tag-${slugify(key)}-${fnv1a32(key)}`;
}

/**
 * The join row's primary key, derived from BOTH sides.
 *
 * Required by AGENTS.md rule 2 and the single most important id in this
 * feature: two phones tagging the same transaction "vacation" is the expected
 * case, not an edge case, and with uuid() that is two join rows — so the tag's
 * total counts that transaction twice and the number on screen is simply
 * wrong, with nothing to indicate it.
 */
export function tagJoinId(transactionId: string, tagRowId: string): string {
  return `txtag-${transactionId}-${tagRowId}`;
}

/**
 * A tag's colour, derived from its name rather than chosen.
 *
 * Same convergence problem as the id: if each device picked a colour when it
 * first created the tag, the two rows would differ by colour and every sync
 * would flip it back and forth under last-writer-wins. Deriving it means both
 * phones independently arrive at the same one, so the colour never becomes
 * something for the two devices to argue about.
 *
 * Deliberately NOT theme/colors.ts's CATEGORY_PALETTE, even though the hues
 * overlap: importing that would pull react-native into this module and this
 * file has to stay runnable under plain Node for the harness.
 */
export const TAG_PALETTE = [
  '#5856D6', // indigo
  '#30ADE6', // light blue
  '#00C7BE', // teal
  '#34C759', // green
  '#FF9500', // orange
  '#FF2D55', // pink
  '#AF52DE', // purple
  '#A2845E', // brown
] as const;

export function tagColorFor(name: string): string {
  const hash = parseInt(fnv1a32(tagNameKey(name)), 16);
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

/** Whole cents. Tag totals sum arbitrary transactions across every month, so
 * they are the longest addition in the app — summing as floats drifts and
 * renders a trip total ending in a stray fraction of a cent. */
const cents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/** Ids in the order first seen, duplicates dropped.
 *
 * The picker can hand back the same tag twice (tapping fast, or a stale list
 * merged with a fresh one). Storing it twice is invisible — the join id is
 * derived, so the second write is the same row — but the COUNT the UI shows
 * against MAX_TAGS_PER_TRANSACTION would be wrong, and the user would be told
 * they are at the limit while holding three tags. */
export function dedupeTagIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface TaggedAmount {
  tagId: string;
  amount: number;
}

/**
 * Total spend per tag — the number the whole feature exists to produce.
 *
 * Sign is carried, not assumed: a refund on a tagged purchase is a negative
 * transaction, and dropping it would make the trip look more expensive than it
 * was. A tag whose refunds exceed its spend legitimately totals negative.
 *
 * One transaction carrying two tags counts in FULL under each. That is
 * deliberate and is what a tag means — "how much of this trip was also work?"
 * is a real question — but it also means tag totals do not sum to a budget and
 * must never be presented as if they do.
 */
export function tagTotals(rows: TaggedAmount[]): Map<string, number> {
  // Accumulated in a cents-only map and converted once at the end. Converting
  // as we go would re-multiply an already-cents running total by 100 on the
  // next row — the arithmetic stays in one unit until it leaves the function.
  const centsByTag = new Map<string, number>();
  for (const row of rows) {
    centsByTag.set(row.tagId, (centsByTag.get(row.tagId) ?? 0) + cents(row.amount));
  }
  const out = new Map<string, number>();
  for (const [id, total] of centsByTag) out.set(id, fromCents(total));
  return out;
}
