import { getMemoryById, upsertCoreMemory } from './db';

/**
 * Core Memory identity records (AGENTS.md §5):
 * the owner's name and the AI's name are identity anchors — they live in
 * the Core tier, which never expires, and never leave this device.
 */
export const OWNER_NAME_MEMORY_ID = 'core:owner_name';
export const AI_NAME_MEMORY_ID = 'core:ai_name';

export interface IdentityNames {
  ownerName: string;
  aiName: string;
}

/** Persists both names as permanent Core Memory records. */
export async function saveIdentityNames(
  ownerName: string,
  aiName: string,
): Promise<void> {
  await Promise.all([
    upsertCoreMemory(OWNER_NAME_MEMORY_ID, ownerName.trim()),
    upsertCoreMemory(AI_NAME_MEMORY_ID, aiName.trim()),
  ]);
}

/** Reads the stored names; empty strings when not set yet. */
export async function loadIdentityNames(): Promise<IdentityNames> {
  const [owner, ai] = await Promise.all([
    getMemoryById(OWNER_NAME_MEMORY_ID),
    getMemoryById(AI_NAME_MEMORY_ID),
  ]);
  return { ownerName: owner?.content ?? '', aiName: ai?.content ?? '' };
}
