import type { StatementPreview } from './statement-import';

// A one-shot hand-off between the Settings screen (which picks + parses the
// file) and the Import Preview route (which reviews + commits it). Router params
// can't carry an array of parsed rows cleanly, and the data is transient — it
// dies the moment the preview is committed or dismissed — so a tiny module
// singleton is the right amount of machinery here, not a context or the DB.

type PendingImport = { cardId: string; preview: StatementPreview };

let pending: PendingImport | null = null;

export function setPendingImport(value: PendingImport): void {
  pending = value;
}

/** Reads and clears the pending import so it can't be committed twice. */
export function takePendingImport(): PendingImport | null {
  const value = pending;
  pending = null;
  return value;
}
