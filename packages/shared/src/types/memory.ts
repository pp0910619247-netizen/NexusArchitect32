/**
 * Storage tier of a memory record (AGENTS.md §5 sliding-window policy).
 *
 * - `CORE` — identity data that never expires.
 * - `ROLLING` — per-record TTL of 30 days from `createdAt` (no batch resets).
 */
export type MemoryTier = 'CORE' | 'ROLLING';

/**
 * A single on-device memory record. Memory never leaves the user's device.
 */
export interface MemoryRecord {
  /** Stable unique identifier of the record. */
  id: string;
  /** Whether the record is Core ( immortal) or Rolling (30-day TTL). */
  tier: MemoryTier;
  /** The remembered content (free text captured from conversation). */
  content: string;
  /** Unix timestamp (seconds) at which the record was created — starts the TTL clock. */
  createdAt: number;
  /**
   * Unix timestamp (seconds) at which the Rolling record expires, or `null`
   * for Core records (never expire). Evaluated per record, never in batch.
   */
  expiresAt: number | null;
  /** User-set pin; pinned records are exempt from expiry promotion/deletion flows. */
  pinned: boolean;
  /** Significance score in [0, 1]; records scoring ≥ threshold are promoted to Core before deletion. */
  significanceScore: number;
}
