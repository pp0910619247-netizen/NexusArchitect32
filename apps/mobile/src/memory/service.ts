import type { MemoryRecord } from '@nexus/shared';
import { getMemoryDb, ROLLING_TTL_SECONDS } from './schema';

// ---------------------------------------------------------------------------
// Internal row shapes (mirror CREATE TABLE columns exactly)
// ---------------------------------------------------------------------------

interface CoreRow {
  id: string;
  content: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  significance_score: number;
}

interface RollingRow {
  id: string;
  content: string;
  created_at: number;
  expires_at: number;
  pinned: number;
  significance_score: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function coreRowToRecord(row: CoreRow): MemoryRecord {
  return {
    id: row.id,
    tier: 'CORE',
    content: row.content,
    createdAt: row.created_at,
    expiresAt: null,
    pinned: row.pinned === 1,
    significanceScore: row.significance_score,
  };
}

function rollingRowToRecord(row: RollingRow): MemoryRecord {
  return {
    id: row.id,
    tier: 'ROLLING',
    content: row.content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    pinned: row.pinned === 1,
    significanceScore: row.significance_score,
  };
}

async function resolveOrThrow(): Promise<ReturnType<typeof getMemoryDb> extends Promise<infer T> ? T : never> {
  return getMemoryDb();
}

// ---------------------------------------------------------------------------
// Core Memory
// ---------------------------------------------------------------------------

/**
 * Insert or overwrite a Core Memory record.
 * `created_at` is preserved on conflict (original creation time survives updates).
 */
export async function upsertCoreMemory(id: string, content: string): Promise<void> {
  const db = await resolveOrThrow();
  const now = nowSec();
  await db.runAsync(
    `INSERT INTO core_memory (id, content, created_at, updated_at, pinned, significance_score)
     VALUES (?, ?, ?, ?, 0, 1.0)
     ON CONFLICT(id) DO UPDATE SET
       content    = excluded.content,
       updated_at = ?`,
    id,
    content,
    now,
    now,
    now,
  );
}

export async function getCoreMemory(id: string): Promise<MemoryRecord | null> {
  const db = await resolveOrThrow();
  const row = await db.getFirstAsync<CoreRow>('SELECT * FROM core_memory WHERE id = ?', id);
  return row ? coreRowToRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Rolling Memory
// ---------------------------------------------------------------------------

/**
 * Insert a Rolling Memory record with an automatic 30-day expiry.
 * If `id` already exists the row is replaced entirely (new TTL).
 */
export async function upsertRollingMemory(id: string, content: string): Promise<void> {
  const db = await resolveOrThrow();
  const now = nowSec();
  const expiresAt = now + ROLLING_TTL_SECONDS;
  await db.runAsync(
    `INSERT INTO rolling_memory (id, content, created_at, expires_at, pinned, significance_score)
     VALUES (?, ?, ?, ?, 0, 0.5)
     ON CONFLICT(id) DO UPDATE SET
       content    = excluded.content,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
    id,
    content,
    now,
    expiresAt,
  );
}

export async function getRollingMemory(id: string): Promise<MemoryRecord | null> {
  const db = await resolveOrThrow();
  const row = await db.getFirstAsync<RollingRow>('SELECT * FROM rolling_memory WHERE id = ?', id);
  return row ? rollingRowToRecord(row) : null;
}

/** List all Rolling records, newest first. */
export async function listRollingMemory(): Promise<MemoryRecord[]> {
  const db = await resolveOrThrow();
  const rows = await db.getAllAsync<RollingRow>(
    'SELECT * FROM rolling_memory ORDER BY pinned DESC, created_at DESC',
  );
  return rows.map(rollingRowToRecord);
}

// ---------------------------------------------------------------------------
// Cross-tier helpers
// ---------------------------------------------------------------------------

/**
 * Look up a record by id regardless of tier.
 * Checks core_memory first, then rolling_memory.
 */
export async function getMemoryById(id: string): Promise<MemoryRecord | null> {
  const core = await getCoreMemory(id);
  if (core) return core;
  return getRollingMemory(id);
}

/**
 * List all memory records (Core + Rolling).
 * Pinned records first, then newest first within each tier.
 */
export async function listAllMemory(): Promise<MemoryRecord[]> {
  const [core, rolling] = await Promise.all([listCoreMemory(), listRollingMemory()]);
  return [...core, ...rolling];
}

// ---------------------------------------------------------------------------
// Pin / Unpin  (both tiers)
// ---------------------------------------------------------------------------

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const db = await resolveOrThrow();
  const value = pinned ? 1 : 0;
  await db.runAsync('UPDATE core_memory SET pinned = ? WHERE id = ?', value, id);
  await db.runAsync('UPDATE rolling_memory SET pinned = ? WHERE id = ?', value, id);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteMemoryRecord(id: string): Promise<void> {
  const db = await resolveOrThrow();
  await db.runAsync('DELETE FROM core_memory WHERE id = ?', id);
  await db.runAsync('DELETE FROM rolling_memory WHERE id = ?', id);
}

/** Convenience: remove a single Rolling record by id. */
export async function deleteRollingMemory(id: string): Promise<void> {
  const db = await resolveOrThrow();
  await db.runAsync('DELETE FROM rolling_memory WHERE id = ?', id);
}


export async function listCoreMemory(): Promise<MemoryRecord[]> {
  const db = await resolveOrThrow();
  const rows = await db.getAllAsync<CoreRow>(
    'SELECT * FROM core_memory ORDER BY pinned DESC, created_at DESC',
  );
  return rows.map(coreRowToRecord);
}
