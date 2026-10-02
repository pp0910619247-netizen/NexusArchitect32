/**
 * Quiz-chain constants. Values here implement the owner's spec:
 * - one block (one question) per ~60 minutes with a random offset,
 * - strict sequencing (a new block cannot start until the previous one is
 *   sealed),
 * - every 10th block is hard,
 * - a special hash milestone fires every 1,000 blocks,
 * - 12 core disciplines, questions ordered easy → hard.
 */

/** Default base gap between block starts, in milliseconds (60 minutes = 1 h). */
export const BLOCK_INTERVAL_MS_DEFAULT = 3_600_000;

/** Random offset on top of the base interval, in milliseconds (0–10 min). */
export const BLOCK_JITTER_MS_DEFAULT = 600_000;

/** Blocks between hard blocks: block 10, 20, 30, … use hard difficulty. */
export const HARD_BLOCK_EVERY = 10;

/** Blocks between hash milestones: block 1,000, 2,000, … gets a milestone hash. */
export const MILESTONE_EVERY = 1_000;

/** Extra PoW leading-zero bits required on hard (÷10) blocks. */
export const HARD_BLOCK_EXTRA_DIFFICULTY_BITS = 1;

/** Extra PoW leading-zero bits required on milestone (÷1,000) blocks. */
export const MILESTONE_EXTRA_DIFFICULTY_BITS = 3;

/** Cap on how many answers may be recorded inside one block. */
export const MAX_ANSWERS_PER_BLOCK = 512;

/** Cap on how many admin actions may be recorded inside one block. */
export const MAX_ADMIN_ACTIONS_PER_BLOCK = 64;

/** Minimum block interval accepted by the engine safety guard (ms). */
export const MIN_BLOCK_INTERVAL_MS = 1_000;
