import { getDb } from '../lib/db';
import type { Transaction } from '../lib/models';

export type SearchFilters = {
  query?: string; // Text search for note
  minAmount?: number;
  maxAmount?: number;
  categoryId?: string | null; // null means search specifically for uncategorized
  cardId?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  limit?: number;
};

/**
 * A robust search engine for the transactions table.
 */
export async function searchTransactions(filters: SearchFilters): Promise<Transaction[]> {
  const db = await getDb();
  
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params: any[] = [];
  
  if (filters.query && filters.query.trim().length > 0) {
    sql += ' AND LOWER(note) LIKE ?';
    params.push(`%${filters.query.toLowerCase()}%`);
  }
  
  if (filters.minAmount !== undefined) {
    sql += ' AND amount >= ?';
    params.push(filters.minAmount);
  }
  
  if (filters.maxAmount !== undefined) {
    sql += ' AND amount <= ?';
    params.push(filters.maxAmount);
  }
  
  if (filters.categoryId !== undefined) {
    if (filters.categoryId === null) {
      sql += ' AND categoryId IS NULL';
    } else {
      sql += ' AND categoryId = ?';
      params.push(filters.categoryId);
    }
  }
  
  if (filters.cardId) {
    sql += ' AND cardId = ?';
    params.push(filters.cardId);
  }
  
  if (filters.startDate) {
    sql += ' AND date >= ?';
    params.push(filters.startDate);
  }
  
  if (filters.endDate) {
    sql += ' AND date <= ?';
    params.push(filters.endDate);
  }
  
  sql += ' ORDER BY date DESC, createdAt DESC';
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  return db.getAllAsync<Transaction>(sql, params);
}
