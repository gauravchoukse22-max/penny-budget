// ---------------------------------------------------------------------------
// features/smart-categorizer.ts – ML-powered categorization engine for
// Penny Budget.
//
// Three strategies in priority order:
//   1. User-defined keyword rules       (source: 'rule')
//   2. Historical frequency matching     (source: 'history')
//   3. Naïve Bayes classifier            (source: 'naive_bayes')
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import { merchantRuleId } from '../lib/merchant-token';
import { queueSyncMutation } from './cloudkit-sync';
import type { Category } from '../lib/models';
import type { CategoryRule, SmartSuggestion } from './models';

// ---- Naive Bayes model type ------------------------------------------------

export type NaiveBayesModel = {
  /** Total number of training samples. */
  totalSamples: number;
  /** Number of samples per category. */
  categoryCounts: Record<string, number>;
  /** word → { categoryId → count } */
  wordCounts: Record<string, Record<string, number>>;
  /** Total word tokens per category. */
  categoryWordTotals: Record<string, number>;
  /** Size of the vocabulary (unique words across all categories). */
  vocabSize: number;
};

// ---- Category Rule CRUD ----------------------------------------------------

/** List every user-defined category rule. */
export async function listCategoryRules(): Promise<CategoryRule[]> {
  const db = await getDb();
  return db.getAllAsync<CategoryRule>(
    'SELECT * FROM category_rules ORDER BY keyword ASC',
  );
}

/** Create a new keyword → category mapping. */
export async function addCategoryRule(
  keyword: string,
  categoryId: string,
): Promise<CategoryRule> {
  const db = await getDb();
  const rule: CategoryRule = { id: uuid(), keyword, categoryId };
  await db.runAsync(
    'INSERT INTO category_rules (id, keyword, categoryId) VALUES (?, ?, ?)',
    [rule.id, rule.keyword, rule.categoryId],
  );
  await queueSyncMutation('CREATE', 'category_rules', rule.id, rule);
  return rule;
}

/**
 * Creates the rule for `keyword`, or repoints the existing one at a new
 * category. Returns the surviving rule, or null for an empty keyword.
 *
 * Used by the learning path (a keyword the user never typed, derived from a
 * statement description), which is why it upserts rather than inserts: the same
 * merchant turns up on every statement, and an insert-only path would grow one
 * duplicate rule per import until the arbitrary first match decided the
 * category. `keyword` is COLLATE NOCASE in the schema, so this finds
 * "STARBUCKS" when asked for "starbucks".
 */
export async function upsertCategoryRule(
  keyword: string,
  categoryId: string,
): Promise<CategoryRule | null> {
  const kw = keyword.trim();
  if (!kw) return null;
  const db = await getDb();

  const existing = await db.getFirstAsync<CategoryRule>(
    'SELECT * FROM category_rules WHERE keyword = ?',
    [kw],
  );
  if (existing) {
    if (existing.categoryId === categoryId) return existing;
    await db.runAsync('UPDATE category_rules SET categoryId = ? WHERE id = ?', [
      categoryId,
      existing.id,
    ]);
    const updated: CategoryRule = { ...existing, categoryId };
    await queueSyncMutation('UPDATE', 'category_rules', existing.id, updated);
    return updated;
  }

  // Derived id — see merchantRuleId. ON CONFLICT covers the one case a derived
  // id can collide: two keywords that differ only in punctuation slug to the
  // same string. Overwriting is the right resolution there, since the row is
  // then simply the rule for that slug.
  const rule: CategoryRule = { id: merchantRuleId(kw), keyword: kw, categoryId };
  await db.runAsync(
    `INSERT INTO category_rules (id, keyword, categoryId) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET keyword = excluded.keyword, categoryId = excluded.categoryId`,
    [rule.id, rule.keyword, rule.categoryId],
  );
  await queueSyncMutation('CREATE', 'category_rules', rule.id, rule);
  return rule;
}

/** Delete a category rule by ID. */
export async function removeCategoryRule(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM category_rules WHERE id = ?', [id]);
  await queueSyncMutation('DELETE', 'category_rules', id, { id });
}

// ---- Strategy 1: keyword rules --------------------------------------------

/**
 * Check every keyword rule against `note` and return the LONGEST match's
 * categoryId, or null.
 *
 * Longest, not first: import learning writes one rule per merchant token, so
 * "amazon" and "amazon fresh" can both exist and both match an Amazon Fresh
 * order. Taking whichever row SQLite happened to return first meant a
 * correction the user had just made lost at random to an older, broader rule —
 * the same statement would categorize differently on two devices.
 */
export async function getCategoryByRule(
  note: string,
): Promise<string | null> {
  const db = await getDb();
  const rules = await db.getAllAsync<CategoryRule>(
    'SELECT * FROM category_rules',
  );
  const lower = note.toLowerCase();
  let best: { keyword: string; categoryId: string } | null = null;
  for (const rule of rules) {
    const keyword = rule.keyword.toLowerCase();
    if (!keyword || !lower.includes(keyword)) continue;
    if (!best || keyword.length > best.keyword.length) {
      best = { keyword, categoryId: rule.categoryId };
    }
  }
  return best?.categoryId ?? null;
}

// ---- Strategy 2: historical frequency --------------------------------------

/**
 * Look up past transactions whose note matches `note` (case-insensitive) and
 * return the most frequently assigned categoryId.
 *
 * Returns null if fewer than 3 matching categorized transactions exist.
 */
export async function getLearnedCategory(
  note: string,
): Promise<string | null> {
  const db = await getDb();
  const keyword = `%${note.toLowerCase()}%`;

  const rows = await db.getAllAsync<{ categoryId: string; cnt: number }>(
    `SELECT categoryId, COUNT(*) as cnt
     FROM transactions
     WHERE categoryId IS NOT NULL AND LOWER(note) LIKE ?
     GROUP BY categoryId
     ORDER BY cnt DESC`,
    [keyword],
  );

  if (rows.length === 0) return null;

  // Total matches across all categories must be >= 3
  const totalMatches = rows.reduce((s, r) => s + r.cnt, 0);
  if (totalMatches < 3) return null;

  return rows[0].categoryId;
}

// ---- Strategy 3: Naïve Bayes -----------------------------------------------

/** Tokenize a note string into lowercase alpha-numeric words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/**
 * Build a Naïve Bayes model from all categorized transactions.
 *
 * Each transaction's `note` is tokenized into lowercase words.  Word
 * frequencies are tracked per category to enable probabilistic classification.
 */
export async function buildNaiveBayesModel(): Promise<NaiveBayesModel> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ note: string; categoryId: string }>(
    `SELECT note, categoryId FROM transactions
     WHERE categoryId IS NOT NULL AND note IS NOT NULL AND note != ''`,
  );

  const categoryCounts: Record<string, number> = {};
  const wordCounts: Record<string, Record<string, number>> = {};
  const categoryWordTotals: Record<string, number> = {};
  const vocabSet = new Set<string>();

  for (const row of rows) {
    const catId = row.categoryId;
    categoryCounts[catId] = (categoryCounts[catId] ?? 0) + 1;

    const words = tokenize(row.note);
    categoryWordTotals[catId] = (categoryWordTotals[catId] ?? 0) + words.length;

    for (const word of words) {
      vocabSet.add(word);
      if (!wordCounts[word]) wordCounts[word] = {};
      wordCounts[word][catId] = (wordCounts[word][catId] ?? 0) + 1;
    }
  }

  return {
    totalSamples: rows.length,
    categoryCounts,
    wordCounts,
    categoryWordTotals,
    vocabSize: vocabSet.size,
  };
}

/**
 * Classify `note` using the pre-built Naïve Bayes model.
 *
 * Uses Laplace smoothing (α = 1) so unseen words don't zero-out any category.
 * Returns `{ categoryId, confidence }` or null if the model has fewer than 5
 * total training samples.
 */
export function getNaiveBayesSuggestion(
  note: string,
  model: NaiveBayesModel,
): { categoryId: string; confidence: number } | null {
  if (model.totalSamples < 5) return null;

  const words = tokenize(note);
  if (words.length === 0) return null;

  const alpha = 1; // Laplace smoothing
  const categories = Object.keys(model.categoryCounts);
  const logScores: Record<string, number> = {};

  for (const catId of categories) {
    // Prior: P(category)
    let logP = Math.log(
      model.categoryCounts[catId] / model.totalSamples,
    );

    // Likelihood: P(word | category) with Laplace smoothing
    const totalWordsInCat = model.categoryWordTotals[catId] ?? 0;
    for (const word of words) {
      const wordCountInCat = model.wordCounts[word]?.[catId] ?? 0;
      logP += Math.log(
        (wordCountInCat + alpha) / (totalWordsInCat + alpha * model.vocabSize),
      );
    }

    logScores[catId] = logP;
  }

  // Convert log-probabilities to normalized probabilities via log-sum-exp
  const maxLog = Math.max(...Object.values(logScores));
  let sumExp = 0;
  for (const catId of categories) {
    sumExp += Math.exp(logScores[catId] - maxLog);
  }

  let bestCatId = categories[0];
  let bestProb = 0;
  for (const catId of categories) {
    const prob = Math.exp(logScores[catId] - maxLog) / sumExp;
    if (prob > bestProb) {
      bestProb = prob;
      bestCatId = catId;
    }
  }

  return { categoryId: bestCatId, confidence: bestProb };
}

// ---- Master function -------------------------------------------------------

/**
 * Suggest a category for a transaction note, trying all strategies in order:
 *   1. User keyword rules (highest confidence)
 *   2. Historical frequency
 *   3. Naïve Bayes classifier
 *
 * Returns a SmartSuggestion with source attribution and explanation, or null
 * if none of the strategies can produce a suggestion.
 */
export async function suggestCategory(
  note: string,
): Promise<SmartSuggestion | null> {
  if (!note || note.trim().length === 0) return null;

  // 1. Rule-based
  const ruleMatch = await getCategoryByRule(note);
  if (ruleMatch) {
    return {
      categoryId: ruleMatch,
      confidence: 1.0,
      source: 'rule',
      explanation: `Matched a user-defined keyword rule for "${note}".`,
    };
  }

  // 2. History-based
  const historyMatch = await getLearnedCategory(note);
  if (historyMatch) {
    return {
      categoryId: historyMatch,
      confidence: 0.8,
      source: 'history',
      explanation: `Based on how you've categorized similar "${note}" transactions in the past.`,
    };
  }

  // 3. Naïve Bayes
  const model = await buildNaiveBayesModel();
  const bayesResult = getNaiveBayesSuggestion(note, model);
  if (bayesResult) {
    return {
      categoryId: bayesResult.categoryId,
      confidence: bayesResult.confidence,
      source: 'naive_bayes',
      explanation: `ML prediction based on word patterns (${Math.round(bayesResult.confidence * 100)}% confidence).`,
    };
  }

  return null;
}
