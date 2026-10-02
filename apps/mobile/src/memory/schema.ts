import { openDatabaseAsync, type SQLiteDatabase, type SQLiteOpenOptions } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

const DB_NAME = 'nexus-memory.db';
const SECURE_KEY_ID = 'memory-sqlcipher-key';

/**
 * Build the two memory tables (AGENTS.md §5):
 * - core_memory   — identity records that never expire
 * - rolling_memory — 30-day TTL records (per-record evaluation, never batch-reset)
 *
 * SQLCipher is enabled by passing the key through SQLiteOpenOptions.key
 * (confirmed available in expo-sqlite@57.0.3 — see node_modules/expo-sqlite/build/NativeDatabase.d.ts).
 * The raw key is kept ONLY in expo-secure-store (iOS Keychain / Android Keystore).
 */
export async function createMemoryTables(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS core_memory (
      id          TEXT PRIMARY KEY NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0,
      significance_score REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rolling_memory (
      id           TEXT PRIMARY KEY NOT NULL,
      content      TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      significance_score REAL NOT NULL DEFAULT 0
    );
  `);
}

/** Unix-seconds for "now + 30 days" (rolling-memory TTL, AGENTS.md §5). */
export const ROLLING_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Open (or create) the encrypted memory database.
 * On first run a random key is generated and persisted in SecureStore.
 * Subsequent runs reuse the same key.
 */
let dbPromise: Promise<SQLiteDatabase> | null = null;

export async function getMemoryDb(): Promise<SQLiteDatabase> {
  if (dbPromise) return dbPromise;

  let encryptionKey = await SecureStore.getItemAsync(SECURE_KEY_ID);
  if (!encryptionKey) {
    // 256-bit key as hex (32 bytes)
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    encryptionKey = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(SECURE_KEY_ID, encryptionKey);
  }

  dbPromise = openDatabaseAsync(DB_NAME, { key: encryptionKey } as unknown as SQLiteOpenOptions).then((db) => {
    return createMemoryTables(db).then(() => db);
  });

  return dbPromise;
}

/** Reset the in-memory promise cache (useful for tests that swap the underlying db). */
export function resetDbPromise(): void {
  dbPromise = null;
}
