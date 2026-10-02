import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createMemoryTables, getMemoryDb, resetDbPromise } from '../memory/schema';
import { ROLLING_TTL_SECONDS } from '../memory/schema';
import { evaluateRollingRecord, runExpiryPass, SIGNIFICANCE_PROMOTE_THRESHOLD } from '../memory/expiry';
import { deleteMemoryRecord, deleteRollingMemory, getCoreMemory, getMemoryById, getRollingMemory, listAllMemory, listCoreMemory, listRollingMemory, setPinned, upsertCoreMemory, upsertRollingMemory } from '../memory/service';

const mocks = vi.hoisted(() => ({
  execAsync: vi.fn(),
  runAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  getAllAsync: vi.fn(),
  secureGetItem: vi.fn(),
  secureSetItem: vi.fn(),
  secureDeleteItem: vi.fn(),
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
  deleteDatabaseAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.secureGetItem,
  setItemAsync: mocks.secureSetItem,
  deleteItemAsync: mocks.secureDeleteItem,
}));

const mockDb = {
  execAsync: mocks.execAsync,
  runAsync: mocks.runAsync,
  getFirstAsync: mocks.getFirstAsync,
  getAllAsync: mocks.getAllAsync,
  closeAsync: vi.fn(),
} as unknown as SQLiteDatabase;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function armDb(key: string | null): void {
  (openDatabaseAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
  mocks.secureGetItem.mockResolvedValue(key);
  mocks.execAsync.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  armDb('k');
  resetDbPromise();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
});

function makeCoreRow(id: string, content: string) {
  const t = nowSec();
  return { id, content, created_at: t, updated_at: t, pinned: 0, significance_score: 1.0 };
}

function makeRollingRow(id: string, content: string) {
  const t = nowSec();
  return { id, content, created_at: t, expires_at: t + 2592000, pinned: 0, significance_score: 0.5 };
}

describe('createMemoryTables', () => {
  it('creates both tables (happy path)', async () => {
    mocks.execAsync.mockResolvedValueOnce(undefined);
    await createMemoryTables(mockDb);
    expect(mocks.execAsync).toHaveBeenCalledTimes(1);
    const sql = mocks.execAsync.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS core_memory');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rolling_memory');
  });
  it('safe to run twice (edge)', async () => {
    mocks.execAsync.mockResolvedValue(undefined);
    await createMemoryTables(mockDb);
    await createMemoryTables(mockDb);
    expect(mocks.execAsync).toHaveBeenCalledTimes(2);
  });
});
describe('getMemoryDb', () => {
  it('opens with key from SecureStore (happy path)', async () => {
    armDb('abcd1234');
    const db = await getMemoryDb();
    expect(db).toBe(mockDb);
  });
  it('generates 64-hex key when none exists (happy path)', async () => {
    armDb(null);
    mocks.secureSetItem.mockResolvedValueOnce(undefined);
    await getMemoryDb();
    expect(mocks.secureSetItem).toHaveBeenCalledTimes(1);
  });
  it('caches the open promise (edge)', async () => {
    armDb('k');
    const a = await getMemoryDb();
    const b = await getMemoryDb();
    expect(a).toBe(b);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
  });
});

describe('constants', () => {
  it('ROLLING_TTL_SECONDS is 30 days', () => {
    expect(ROLLING_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
  it('SIGNIFICANCE_PROMOTE_THRESHOLD is 0.7', () => {
    expect(SIGNIFICANCE_PROMOTE_THRESHOLD).toBe(0.7);
  });
});
describe('coreMemory', () => {
  it('upserts row (happy path)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValueOnce({ lastInsertRowId: 1, changes: 1 });
    await upsertCoreMemory('core-1', 'hello');
    expect(mocks.runAsync).toHaveBeenCalledTimes(1);
  });
  it('overwrites same id (edge)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    await upsertCoreMemory('c', 'v1');
    await upsertCoreMemory('c', 'v2');
    expect(mocks.runAsync).toHaveBeenCalledTimes(2);
  });
  it('maps row to CORE (happy path)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(makeCoreRow('c1', 'hi'));
    const rec = await getCoreMemory('c1');
    expect(rec?.tier).toBe('CORE');
    expect(rec?.expiresAt).toBeNull();
  });
  it('returns null when missing (edge)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(null);
    await expect(getCoreMemory('nope')).resolves.toBeNull();
  });
  it('lists CORE rows (happy path)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([makeCoreRow('c1', 'hi')]);
    const rows = await listCoreMemory();
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe('CORE');
  });
  it('lists empty CORE (edge)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([]);
    await expect(listCoreMemory()).resolves.toEqual([]);
  });
});


describe('rollingMemory', () => {
  it('upserts rolling row (happy path)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValueOnce({ lastInsertRowId: 1, changes: 1 });
    await upsertRollingMemory('r1', 'rolling hi');
    const args = mocks.runAsync.mock.calls[0] as unknown[];
    expect(args[0] as string).toContain('INSERT INTO rolling_memory');
    expect(args).toContain('rolling hi');
  });
  it('upserts twice on same id (edge)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    await upsertRollingMemory('r', 'a');
    await upsertRollingMemory('r', 'b');
    expect(mocks.runAsync).toHaveBeenCalledTimes(2);
  });
  it('maps row to ROLLING (happy path)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(makeRollingRow('r1', 'hi'));
    const rec = await getRollingMemory('r1');
    expect(rec?.tier).toBe('ROLLING');
  });
  it('returns null when missing (edge)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(null);
    await expect(getRollingMemory('nope')).resolves.toBeNull();
  });
  it('lists rows (happy path)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([makeRollingRow('r1', 'hi')]);
    const rows = await listRollingMemory();
    expect(rows).toHaveLength(1);
  });
  it('lists empty (edge)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([]);
    await expect(listRollingMemory()).resolves.toEqual([]);
  });
});

describe('crossTier', () => {
  it('prefers CORE (happy path)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(makeCoreRow('x', 'hi'));
    const rec = await getMemoryById('x');
    expect(rec?.tier).toBe('CORE');
  });
  it('falls back to ROLLING (happy path)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(null);
    mocks.getFirstAsync.mockResolvedValueOnce(makeRollingRow('x', 'hi'));
    const rec = await getMemoryById('x');
    expect(rec?.tier).toBe('ROLLING');
  });
  it('returns null when both miss (edge)', async () => {
    armDb('k');
    mocks.getFirstAsync.mockResolvedValueOnce(null);
    mocks.getFirstAsync.mockResolvedValueOnce(null);
    await expect(getMemoryById('ghost')).resolves.toBeNull();
  });
  it('concatenates CORE then ROLLING (happy path)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([makeCoreRow('c1', 'hi')]);
    mocks.getAllAsync.mockResolvedValueOnce([makeRollingRow('r1', 'hi')]);
    const all = await listAllMemory();
    expect(all.map((r) => r.id)).toEqual(['c1', 'r1']);
  });
  it('returns empty when both empty (edge)', async () => {
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([]);
    mocks.getAllAsync.mockResolvedValueOnce([]);
    await expect(listAllMemory()).resolves.toEqual([]);
  });
});

describe('pinDelete', () => {
  it('setPinned updates both tiers (happy path)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });
    await setPinned('x', true);
    expect(mocks.runAsync).toHaveBeenCalledTimes(2);
  });
  it('setPinned unpins with 0 (edge)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });
    await setPinned('x', false);
    expect(mocks.runAsync.mock.calls[0]).toContain(0);
  });
  it('deleteMemoryRecord deletes both tiers (happy path)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });
    await deleteMemoryRecord('x');
    expect(mocks.runAsync).toHaveBeenCalledTimes(2);
  });
  it('deleteMemoryRecord resolves when missing (edge)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 0 });
    await expect(deleteMemoryRecord('ghost')).resolves.toBeUndefined();
  });
  it('deleteRollingMemory deletes one row (happy path)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValueOnce({ lastInsertRowId: 0, changes: 1 });
    await deleteRollingMemory('r1');
    expect(mocks.runAsync).toHaveBeenCalledTimes(1);
  });
  it('deleteRollingMemory resolves when missing (edge)', async () => {
    armDb('k');
    mocks.runAsync.mockResolvedValueOnce({ lastInsertRowId: 0, changes: 0 });
    await expect(deleteRollingMemory('ghost')).resolves.toBeUndefined();
  });
});

describe('evaluateRollingRecord', () => {
  it('no-op for pinned (happy path)', () => {
    const t = nowSec();
    const d = evaluateRollingRecord({ id: 'p1', content: 'c', created_at: t - 40 * 86400, expires_at: t - 100, pinned: 1, significance_score: 0.9 });
    expect(d.action).toBe('no-op');
  });
  it('no-op when not expired (happy path)', () => {
    const t = nowSec();
    const d = evaluateRollingRecord({ id: 'f1', content: 'c', created_at: t, expires_at: t + 9999, pinned: 0, significance_score: 0.1 });
    expect(d.action).toBe('no-op');
  });
  it('promotes expired significant (happy path)', () => {
    const t = nowSec();
    const d = evaluateRollingRecord({ id: 's1', content: 'keep', created_at: t - 40 * 86400, expires_at: t - 1, pinned: 0, significance_score: 0.9 });
    expect(d.action).toBe('promote-and-delete');
  });
  it('promotes exactly at threshold (edge)', () => {
    const t = nowSec();
    const d = evaluateRollingRecord({ id: 'e1', content: 'c', created_at: t - 40 * 86400, expires_at: t - 1, pinned: 0, significance_score: 0.7 });
    expect(d.action).toBe('promote-and-delete');
  });
  it('deletes expired low-score (happy path)', () => {
    const t = nowSec();
    const d = evaluateRollingRecord({ id: 'd1', content: 'c', created_at: t - 40 * 86400, expires_at: t - 1, pinned: 0, significance_score: 0.2 });
    expect(d.action).toBe('delete');
  });
});

describe('runExpiryPass', () => {
  it('deletes expired low-score rows (happy path)', async () => {
    const t = nowSec();
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([{ id: 'old', content: 'c', created_at: t - 40 * 86400, expires_at: t - 10, pinned: 0, significance_score: 0.1 }]);
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });
    const res = await runExpiryPass();
    expect(res.deleted).toEqual(['old']);
    expect(res.promoted).toEqual([]);
  });
  it('promotes expired significant rows (happy path)', async () => {
    const t = nowSec();
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([{ id: 'sig', content: 'keep me', created_at: t - 40 * 86400, expires_at: t - 5, pinned: 0, significance_score: 0.95 }]);
    mocks.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    const res = await runExpiryPass();
    expect(res.promoted).toEqual(['sig']);
    expect(mocks.runAsync).toHaveBeenCalledTimes(2);
  });
  it('skips pinned and fresh rows (edge)', async () => {
    const t = nowSec();
    armDb('k');
    mocks.getAllAsync.mockResolvedValueOnce([{ id: 'pin', content: 'c', created_at: t - 40 * 86400, expires_at: t - 5, pinned: 1, significance_score: 0.9 }, { id: 'fresh', content: 'c', created_at: t, expires_at: t + 9999, pinned: 0, significance_score: 0.1 }]);
    const res = await runExpiryPass();
    expect(res.skipped).toEqual(['pin', 'fresh']);
    expect(mocks.runAsync).not.toHaveBeenCalled();
  });
});


