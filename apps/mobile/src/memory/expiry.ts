import { getMemoryDb } from './schema';

/**
 * Significance threshold (AGENTS.md §5).
 * Rolling records scoring ≥ this value get promoted to Core before deletion.
 */
export const SIGNIFICANCE_PROMOTE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// ExpiryJob
// ---------------------------------------------------------------------------

/**
 * Stateless expiry evaluator. Each call processes a single rolling record
 * (no batch resets — per AGENTS.md §5 sliding-window policy).
 *
 * Rules applied in order:
 * 1. If pinned → skip (pinned records are exempt from expiry).
 * 2. If expired AND significance ≥ threshold → PromoteRecord: copy to core_memory,
 *    reset significance to 1.0, clear the rolling row's content so it won't
 *    be re-promoted, then fall through to deletion.
 * 3. If expired → DeleteRecord: remove the rolling row entirely.
 * 4. If not expired → NoOp.
 */
export type ExpiryDecision =
  | { action: 'no-op'; id: string; reason: string }
  | { action: 'promote-and-delete'; id: string; content: string; significanceScore: number }
  | { action: 'delete'; id: string };

/**
 * Evaluate a single rolling-memory row for expiry.
 * Does NOT mutate the database — returns the decision only.
 * Callers (tests or integration code) apply the side-effects.
 */
export function evaluateRollingRecord(row: {
  id: string;
  content: string;
  created_at: number;
  expires_at: number;
  pinned: number;
  significance_score: number;
}): ExpiryDecision {
  if (row.pinned === 1) {
    return { action: 'no-op', id: row.id, reason: 'pinned' };
  }

  if (row.expires_at > nowSec()) {
    return { action: 'no-op', id: row.id, reason: 'not yet expired' };
  }

  // Expired — check significance for promotion
  if (row.significance_score >= SIGNIFICANCE_PROMOTE_THRESHOLD) {
    return {
      action: 'promote-and-delete',
      id: row.id,
      content: row.content,
      significanceScore: row.significance_score,
    };
  }

  return { action: 'delete', id: row.id };
}

// ---------------------------------------------------------------------------
// Run against the live database
// ---------------------------------------------------------------------------

/**
 * Run the expiry pass over all non-pinned rolling records.
 *
 * Returns a summary of what happened.
 * Side-effects:
 * - Promoted records: copied into core_memory (id preserved, significance = 1.0,
 *   created_at preserved), then deleted from rolling_memory.
 * - Deleted records: removed from rolling_memory entirely.
 *
 * Pinned or unexpired records are untouched.
 */
export async function runExpiryPass(): Promise<{
  promoted: string[];
  deleted: string[];
  skipped: string[];
}> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<{
    id: string;
    content: string;
    created_at: number;
    expires_at: number;
    pinned: number;
    significance_score: number;
  }>('SELECT * FROM rolling_memory ORDER BY expires_at ASC');

  const promoted: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const decision = evaluateRollingRecord(row);

    switch (decision.action) {
      case 'no-op':
        skipped.push(row.id);
        break;

      case 'promote-and-delete': {
        // Promote: insert into core_memory
        const now = nowSec();
        await db.runAsync(
          `INSERT INTO core_memory (id, content, created_at, updated_at, pinned, significance_score)
           VALUES (?, ?, ?, ?, 0, 1.0)
           ON CONFLICT(id) DO UPDATE SET
             content    = excluded.content,
             updated_at = ?`,
          decision.id,
          decision.content,
          row.created_at, // preserve original creation time
          now,
          now,
        );
        // Then delete from rolling
        await db.runAsync('DELETE FROM rolling_memory WHERE id = ?', decision.id);
        promoted.push(decision.id);
        break;
      }

      case 'delete':
        await db.runAsync('DELETE FROM rolling_memory WHERE id = ?', decision.id);
        deleted.push(decision.id);
        break;
    }
  }

  return { promoted, deleted, skipped };
}
