// Maps a statement's OWN category ("Food & Drink", "Gasoline", "Bills &
// Utilities") onto the user's categories. Pure — no db, no expo — so it is
// fixture-tested next to the parsers.
//
// Issuers that put a category in their exports (Chase, Discover, Capital One,
// Apple Card all do in CSV) have already classified the merchant better than
// any keyword guess can, because they know the merchant's MCC code. So when a
// statement says which category a row is, that wins over the app's guesser —
// but it arrives in the ISSUER'S vocabulary, which never matches the user's
// category names exactly. This module does that translation.
//
// Matching is two layers:
//   1. Direct: the statement's word matches a user category name (loosely —
//      case, punctuation, "&" vs "and", trailing "s" all ignored).
//   2. Aliases: a table of what each issuer vocabulary term MEANS, tried
//      against the user's categories the same loose way. "Food & Drink" means
//      dining; whether the user's category is called "Dining", "Restaurants"
//      or "Eating Out", the alias list finds it.
// No match returns null and the caller falls back to the smart categorizer —
// a statement category never forces a category the user doesn't have.

/** Lowercase, strip punctuation, unify "&"/"and", drop plural "s" per word. */
export function normalizeCategoryName(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`; // groceries → grocery
      if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
      return w;
    })
    .join(' ');
}

/**
 * Issuer vocabulary → what the user's category might be called. Order within
 * each list matters: the first name the user actually has wins.
 */
const ALIASES: Record<string, string[]> = {
  // Eating
  'food and drink': ['dining', 'restaurant', 'food', 'eating out'],
  restaurant: ['dining', 'food'],
  dining: ['dining', 'restaurant', 'food'],
  'fast food': ['dining', 'restaurant', 'food'],
  coffee: ['dining', 'coffee', 'food'],
  // Groceries
  grocery: ['grocery', 'supermarket'],
  supermarket: ['grocery'],
  'grocery store': ['grocery'],
  wholesale: ['grocery', 'shopping'],
  'wholesale club': ['grocery', 'shopping'],
  // Fuel / car
  gas: ['gas', 'fuel', 'car', 'auto', 'transportation'],
  gasoline: ['gas', 'fuel', 'car', 'auto'],
  fuel: ['gas', 'car', 'auto'],
  automotive: ['gas', 'car', 'auto', 'car payment'],
  'auto and transport': ['gas', 'car', 'auto', 'transportation'],
  transportation: ['gas', 'transportation', 'car'],
  // Utilities / phone / internet
  'bill and utility': ['utility', 'bill'],
  utility: ['utility', 'bill'],
  'internet and cable': ['internet and subscription', 'internet', 'utility'],
  'cable and internet': ['internet and subscription', 'internet', 'utility'],
  phone: ['phone service', 'phone', 'utility'],
  telecommunication: ['phone service', 'phone', 'internet and subscription'],
  // Subscriptions / entertainment
  subscription: ['internet and subscription', 'subscription', 'entertainment'],
  streaming: ['internet and subscription', 'subscription', 'entertainment'],
  entertainment: ['entertainment', 'internet and subscription', 'other'],
  // Shopping
  shopping: ['shopping', 'clothing', 'other'],
  merchandise: ['shopping', 'clothing', 'other'],
  'department store': ['clothing', 'shopping'],
  clothing: ['clothing', 'shopping'],
  apparel: ['clothing', 'shopping'],
  // Health
  'health and wellnes': ['health', 'medical'],
  health: ['health', 'medical'],
  healthcare: ['health', 'medical'],
  pharmacy: ['health', 'medical', 'grocery'],
  'personal care': ['health', 'personal care', 'other'],
  // Home
  home: ['home', 'home repair', 'mortgage'],
  'home improvement': ['home repair', 'home'],
  // Travel
  travel: ['travel', 'vacation'],
  airfare: ['travel', 'vacation'],
  hotel: ['travel', 'vacation'],
  'travel and entertainment': ['travel', 'vacation', 'entertainment'],
  // Kids
  'education and childcare': ['family baby', 'family', 'child', 'education'],
  education: ['education', 'family', 'child'],
  // Fees — real spend, usually the user's catch-all
  'fee and adjustment': ['fee', 'other'],
  'fees and adjustments': ['fee', 'other'],
  'bank fee': ['fee', 'other'],
};

/**
 * Resolves a statement category to one of the user's category ids, or null.
 * `categories` come in the user's own order, which breaks alias ties.
 */
export function matchStatementCategory(
  raw: string,
  categories: { id: string; name: string }[]
): string | null {
  const wanted = normalizeCategoryName(raw);
  if (!wanted) return null;

  const normalized = categories.map((c) => ({ id: c.id, name: normalizeCategoryName(c.name) }));

  // Direct: exact loose-name match first, then containment either way
  // ("Family/Baby" vs a statement's "Baby").
  const exact = normalized.find((c) => c.name === wanted);
  if (exact) return exact.id;
  const contains = normalized.find(
    (c) => c.name.length >= 4 && wanted.length >= 4 && (c.name.includes(wanted) || wanted.includes(c.name))
  );
  if (contains) return contains.id;

  for (const alias of ALIASES[wanted] ?? []) {
    const hit = normalized.find((c) => c.name === alias || c.name.includes(alias));
    if (hit) return hit.id;
  }
  return null;
}
