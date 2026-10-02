import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { MemoryRecord } from '@nexus/shared';

/**
 * On-device SQLite storage (AGENTS.md §2 Local DB).
 * All memory stays on the device — nothing is ever synced to a server.
 *
 * Tables:
 * - settings       key/value app preferences (language, voice, wallet…)
 * - memory_records MemoryRecord rows (Core never expires; Rolling has per-record TTL)
 * - verified_models last successful list-models verification per AI provider
 */

export interface VerifiedModelsRecord {
  provider: string;
  models: string[];
  /** Epoch milliseconds of the successful verification. */
  verifiedAt: number;
}

interface MemoryRow {
  id: string;
  tier: string;
  content: string;
  created_at: number;
  expires_at: number | null;
  pinned: number;
  significance_score: number;
}

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function initDb(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('nexus.db');
  await db.execAsync(
    `PRAGMA journal_mode = WAL;
     CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY NOT NULL,
       value TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS memory_records (
       id TEXT PRIMARY KEY NOT NULL,
       tier TEXT NOT NULL,
       content TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       expires_at INTEGER,
       pinned INTEGER NOT NULL DEFAULT 0,
       significance_score REAL NOT NULL DEFAULT 0
     );
     CREATE TABLE IF NOT EXISTS verified_models (
       provider TEXT PRIMARY KEY NOT NULL,
       models_json TEXT NOT NULL,
       verified_at INTEGER NOT NULL
     );`,
  );
  return db;
}

/** Lazily opens the database (idempotent — safe from concurrent callers). */
export function getDb(): Promise<SQLiteDatabase> {
  dbPromise ??= initDb();
  return dbPromise;
}

/* ---------------------------------- settings ---------------------------------- */

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/* ---------------------------------- memory ------------------------------------ */

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    tier: row.tier === 'CORE' ? 'CORE' : 'ROLLING',
    content: row.content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    pinned: row.pinned === 1,
    significanceScore: row.significance_score,
  };
}

/**
 * Creates (or updates the content of) a Core Memory record.
 * Core records never expire: `expires_at` stays NULL forever (§5).
 * The original `created_at` is preserved on updates.
 */
export async function upsertCoreMemory(id: string, content: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO memory_records (id, tier, content, created_at, expires_at, pinned, significance_score)
     VALUES (?, 'CORE', ?, ?, NULL, 0, 1)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content`,
    id,
    content,
    now,
  );
}

export async function getMemoryById(id: string): Promise<MemoryRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MemoryRow>(
    'SELECT * FROM memory_records WHERE id = ?',
    id,
  );
  return row ? rowToMemory(row) : null;
}

/** Lists all records: pinned first, then newest first. */
export async function listMemoryRecords(): Promise<MemoryRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MemoryRow>(
    'SELECT * FROM memory_records ORDER BY pinned DESC, created_at DESC',
  );
  return rows.map(rowToMemory);
}

export async function setMemoryPinned(id: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE memory_records SET pinned = ? WHERE id = ?', pinned ? 1 : 0, id);
}

export async function deleteMemoryRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM memory_records WHERE id = ?', id);
}

/* ------------------------------ verified models ------------------------------ */

export async function saveVerifiedModels(provider: string, models: string[]): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO verified_models (provider, models_json, verified_at)
     VALUES (?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       models_json = excluded.models_json,
       verified_at = excluded.verified_at`,
    provider,
    JSON.stringify(models),
    Date.now(),
  );
}

export async function getVerifiedModels(provider: string): Promise<VerifiedModelsRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    provider: string;
    models_json: string;
    verified_at: number;
  }>('SELECT * FROM verified_models WHERE provider = ?', provider);
  if (!row) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.models_json);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return {
      provider: row.provider,
      models: parsed.filter((m): m is string => typeof m === 'string'),
      verifiedAt: row.verified_at,
    };
  } catch {
    return null;
  }
}
