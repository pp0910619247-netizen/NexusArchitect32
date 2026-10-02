// SPDX-License-Identifier: MIT
/**
 * world-v2 ladder — the deterministic allocator that fixes, for every item
 * index 0…9,999, its tier, subject count, subject set and answer position
 * BEFORE any content is composed.
 *
 * Owner's spec for the difficulty ramp:
 *   tier A (items 1–2,500):  4 subjects ×4 + 6 subjects ×6 in every 10 items
 *   tier B (2,501–5,000):    6 ×4 + 8 ×6
 *   tier C (5,001–7,500):    8 ×4 + 10 ×6
 *   tier D (7,501–10,000):  10 ×4 + 12 ×6
 *   → 4/6/8/10/12-subject totals are 1,000 / 2,500 / 2,500 / 2,500 / 1,500.
 *
 * Pure function of the index: same index → same plan, forever.
 */

import { ANSWER_CAP_PER_FILE, BLOCK_SIZE, TOTAL } from './schema.js';

export const TIER_SIZE = 2_500;
export const TIERS_PER_BLOCK_RATIO = 4; // of every 10 items, 4 take the lower count
export const TIER_LOW_HIGH: readonly (readonly [number, number])[] = Object.freeze([
  [4, 6],
  [6, 8],
  [8, 10],
  [10, 12],
]);
/** Items per file, used for the answer-position cap. */
export const FILE_SIZE = TOTAL / (TOTAL / 1_000);

export interface TierPlan {
  readonly tier: number; // 1…4
  readonly low: number;
  readonly high: number;
}

export function tierForIndex(index: number): TierPlan {
  const tier = Math.min(TIERS_PER_BLOCK_RATIO, Math.floor(index / TIER_SIZE) + 1);
  const [low, high] = TIER_LOW_HIGH[tier - 1]!;
  return { tier, low, high };
}

/** Subject count for an index: 4 of every 10 items use the tier's lower count. */
export function subjectCountForIndex(index: number): number {
  const plan = tierForIndex(index);
  const position = ((index % 10) + 10) % 10;
  return position < TIERS_PER_BLOCK_RATIO ? plan.low : plan.high;
}

/** Stable mulberry32 PRNG (same shape as the chain's helper). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixSeeds(a: number, b: number): number {
  return (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35)) >>> 0;
}

/** Weighted pick without sort (deterministic order). */
export function pickWeighted(counts: readonly number[], rng: () => number): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  let roll = Math.floor(rng() * total);
  for (let i = 0; i < counts.length; i += 1) {
    roll -= counts[i]!;
    if (roll < 0) return i;
  }
  return counts.length - 1;
}

export interface Ladder2Plan {
  readonly index: number;
  readonly tier: number;
  readonly subjectCount: number;
  /** Subject ids, [0] = primary. */
  readonly subjects: readonly string[];
  readonly answerIndex: number;
}

export interface Ladder2State {
  readonly primaryTally: number[];
  readonly memberTally: number[];
  readonly fileAnswerCounts: number[][];
}

export function newLadder2State(subjectCount: number): Ladder2State {
  return {
    primaryTally: Array.from({ length: subjectCount }, () => 0),
    memberTally: Array.from({ length: subjectCount }, () => 0),
    fileAnswerCounts: Array.from({ length: TOTAL / 1_000 }, () => [0, 0, 0, 0]),
  };
}

/**
 * Chooses the subject set for one item.
 * Guarantees: length = count, no duplicates, [0] is the primary subject, and
 * both primary and member usage stay balanced across all 12 subjects.
 */
export function subjectsForIndex(
  count: number,
  subjectIds: readonly string[],
  primaryTally: number[],
  memberTally: number[],
  rng: () => number,
): string[] {
  const targetPrimary = TOTAL / subjectIds.length;
  let primaryIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const offset = Math.floor(rng() * subjectIds.length);
  for (let step = 0; step < subjectIds.length; step += 1) {
    const i = (offset + step) % subjectIds.length;
    const tally = primaryTally[i]!;
    const score = tally + (tally < targetPrimary ? 0 : 1e9);
    if (score < bestScore) {
      bestScore = score;
      primaryIndex = i;
    }
  }
  primaryTally[primaryIndex] = (primaryTally[primaryIndex] ?? 0) + 1;

  const desiredMembers = Math.round((TOTAL * 7) / subjectIds.length); // ≈5,833 member slots each
  const chosen = [subjectIds[primaryIndex]!];
  const used = new Set(chosen);
  for (let k = 1; k < count; k += 1) {
    const weights = subjectIds.map((id, i) =>
      used.has(id) ? 0 : Math.max(1, Math.round(desiredMembers - memberTally[i]!)),
    );
    let pick = pickWeighted(weights, rng);
    if ((weights[pick] ?? 0) === 0) {
      for (let i = 0; i < weights.length; i += 1) {
        if ((weights[i] ?? 0) > 0) {
          pick = i;
          break;
        }
      }
    }
    used.add(subjectIds[pick]!);
    chosen.push(subjectIds[pick]!);
  }
  for (const id of chosen) {
    const i = subjectIds.indexOf(id);
    memberTally[i] = (memberTally[i] ?? 0) + 1;
  }
  return chosen;
}

export function fileForIndex(index: number): number {
  return Math.floor(index / FILE_SIZE);
}

/** Plans one index and mutates the shared tallies (one build pass owns them). */
export function planForIndex2(index: number, subjectIds: readonly string[], state: Ladder2State): Ladder2Plan {
  const plan = tierForIndex(index);
  const subjectCount = subjectCountForIndex(index);
  const rng = mulberry32(mixSeeds(0x57324756 /* W2VG */, index));
  const subjects = subjectsForIndex(subjectCount, subjectIds, state.primaryTally, state.memberTally, rng);

  const file = fileForIndex(index);
  const counts = state.fileAnswerCounts[file]!;
  const cap = Math.floor(FILE_SIZE * ANSWER_CAP_PER_FILE);
  let answerIndex = 0;
  let bestCount = Number.POSITIVE_INFINITY;
  const start = Math.floor(rng() * 4);
  for (let step = 0; step < 4; step += 1) {
    const candidate = (start + step) % 4;
    const value = counts[candidate]!;
    if (value < cap && value < bestCount) {
      bestCount = value;
      answerIndex = candidate;
    }
  }
  counts[answerIndex] = counts[answerIndex]! + 1;
  return { index, tier: plan.tier, subjectCount, subjects, answerIndex };
}

/** Block range helper: block b covers [b*BLOCK_SIZE + 1, (b+1)*BLOCK_SIZE]. */
export function blockRange(from: number, to: number): readonly [number, number] {
  return [from * BLOCK_SIZE + 1, (to + 1) * BLOCK_SIZE];
}
