// SPDX-License-Identifier: MIT
/**
 * World-v1 difficulty ladder — the deterministic allocator that decides, for
 * every question number 1…10_000, its difficulty, subject count, disciplines,
 * and answer position BEFORE any content is composed.
 *
 * Design goals (owner's spec):
 *  • wk-000001 is the HUMAN-IMPOSSIBLE flagship (4 subjects, difficulty 10)
 *    — overridden in flagship.ts, reserved here as slot 0.
 *  • Difficulty then ramps easy → hard across the 10,000 so the mined chain
 *    "walks" easy → hard; near-equal indices are near-equal in difficulty.
 *  • Distribution targets: subjectCount 2/3/4 = 60/30/10%; difficulty 1–2
 *    ≤10%, 9–10 ≤15%, heavy 3–8; every discipline primary 700–900×12; answer
 *    position never above 40% within a file.
 *
 * The allocator is a pure function of the index: same index → same plan,
 * forever (reruns are byte-identical).
 */

export const TOTAL = 10_000;

/** Index 0 (wk-000001) is reserved for the flagship human-impossible item. */
export const FLAGSHIP_INDEX = 0;

/** Difficulty band weights across indices 1…9,999 (sum = 9,999). */
// 900  (d1+2) / 7,799 (d3–8) / 1,300 (d9+10)
const BAND_EASY = 900;
const BAND_MID = 7_799;
const BAND_HARD = 1_300;
export const BANDS: readonly number[] = Object.freeze([BAND_EASY, BAND_MID, BAND_HARD]);

/** Per-file answer-position caps (spec: no position >40% per file). */
export const ANSWER_CAP_PER_FILE = 0.4;

/** Difficulty for a given global index (0-based). Pure and deterministic. */
export function difficultyForIndex(index: number): number {
  if (index <= 900) {
    // 1–900: easy band d1–2, sliding 1 → 2.
    const t = (index - 1) / 899; // 0…1
    return t < 0.55 ? 1 : 2;
  }
  if (index <= 900 + BAND_MID) {
    // 901–8,700: mid band d3–8, six equal steps of 1,300.
    const local = index - 901; // 0…7,799
    return 3 + Math.min(5, Math.floor(local / 1_300));
  }
  // 8,701–9,999: hard band d9–10 (frontier tier), sliding 9 → 10.
  return index - 8_701 < 650 ? 9 : 10;
}

/** Subject count for a given index: 60% two, 30% three, 10% four subjects. */
export function subjectCountForIndex(index: number): number {
  // Deterministic ramp inside every 10-block window: 6 two-subject, 3 three,
  // 1 four-subject — gives 60/30/10% exactly at any scale.
  const position = ((index % 10) + 10) % 10;
  return position <= 5 ? 2 : position <= 8 ? 3 : 4;
}

/** Stable mulberry32 PRNG — identical output to the chain's hash.ts helper. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Numeric seed mixing (same shape as chain hash.ts mixSeeds). */
export function mixSeeds(a: number, b: number): number {
  return (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35)) >>> 0;
}

/** Insertion pick without Array.prototype.sort (deterministic order-safe). */
export function pickWeighted(counts: readonly number[], rng: () => number): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  let roll = Math.floor(rng() * total);
  for (let i = 0; i < counts.length; i += 1) {
    roll -= counts[i]!;
    if (roll < 0) return i;
  }
  return counts.length - 1;
}

/**
 * Selects the discipline set for an index from the running tallies.
 * `primaryTally`/`allTally` are mutated (owned by one build pass).
 * Guarantees: first discipline = primary, no duplicates, length = subjectCount.
 */
export function disciplinesForIndex(
  index: number,
  subjectCount: number,
  disciplineIds: readonly string[],
  primaryTally: number[],
  allTally: number[],
  rng: () => number,
): string[] {
  // 1) primary: prefer under-represented disciplines, tie-broken by rotation.
  const target = 10_000 / disciplineIds.length;
  const scored = disciplineIds.map((id, i) => ({
    id,
    i,
    score: primaryTally[i]! + (primaryTally[i]! < target ? 0 : 1e9), // saturate filled ones
  }));
  let best = scored[0]!;
  for (const candidate of scored) if (candidate.score < best.score) best = candidate;
  const primaryIndex = best.i;
  primaryTally[primaryIndex] = (primaryTally[primaryIndex] ?? 0) + 1;

  // 2) partners: weighted by under-representation across ALL question slots.
  const chosen = [disciplineIds[primaryIndex]!];
  const used = new Set(chosen);
  for (let k = 1; k < subjectCount; k += 1) {
    const counts = disciplineIds.map((_, i) => (used.has(disciplineIds[i]!) ? 0 : Math.max(1, Math.round(target - allTally[i]!))));
    let partnerIndex = pickWeighted(counts, rng);
    if (counts[partnerIndex] === 0) {
      for (let i = 0; i < disciplineIds.length; i += 1) if (counts[i]! > 0) { partnerIndex = i; break; }
    }
    used.add(disciplineIds[partnerIndex]!);
    chosen.push(disciplineIds[partnerIndex]!);
  }
  for (const id of chosen) {
    const i = disciplineIds.indexOf(id);
    allTally[i] = (allTally[i] ?? 0) + 1;
  }
  return chosen;
}

/** One allocation decision for a question index. */
export interface LadderPlan {
  readonly index: number; // 0-based global index
  readonly difficulty: number; // 1–10
  readonly subjectCount: number; // 2–4
  readonly disciplines: readonly string[]; // disciplines[0] = primary
  readonly answerIndex: number; // 0–3
}

/** Allocation state carried across one full build pass. */
export interface LadderState {
  readonly primaryTally: number[];
  readonly allTally: number[];
  readonly fileAnswerCounts: number[][]; // [fileIndex][position0..3]
}

export function newLadderState(disciplineCount: number): LadderState {
  return {
    primaryTally: Array.from({ length: disciplineCount }, () => 0),
    allTally: Array.from({ length: disciplineCount }, () => 0),
    fileAnswerCounts: Array.from({ length: 10 }, () => [0, 0, 0, 0]),
  };
}

/** File index (0–9) for a global 0-based index: 1,000 questions per file. */
export function fileForIndex(index: number): number {
  return Math.floor(index / 1_000);
}

/**
 * Plans the allocation for one index. Mutates the shared state (tallies and
 * per-file answer counts) so successive calls stay balanced.
 * Index 0 → flagship placeholder (real plan comes from flagship.ts).
 */
export function planForIndex(
  index: number,
  disciplineIds: readonly string[],
  state: LadderState,
): LadderPlan {
  if (index === FLAGSHIP_INDEX) {
    return { index, difficulty: 10, subjectCount: 4, disciplines: ['philosophy', 'math', 'ict', 'science'], answerIndex: 2 };
  }
  const rng = mulberry32(mixSeeds(0x574f524c /* WORL */, index));
  const difficulty = difficultyForIndex(index);
  const subjectCount = subjectCountForIndex(index);
  const disciplines = disciplinesForIndex(index, subjectCount, disciplineIds, state.primaryTally, state.allTally, rng);

  // Answer position: least-used position in this file, tie-broken by rng.
  const file = fileForIndex(index);
  const counts = state.fileAnswerCounts[file]!;
  const cap = Math.floor(1_000 * ANSWER_CAP_PER_FILE); // 400 hard cap
  let position = 0;
  let bestCount = Number.POSITIVE_INFINITY;
  const start = Math.floor(rng() * 4);
  for (let offset = 0; offset < 4; offset += 1) {
    const candidate = (start + offset) % 4;
    const value = counts[candidate]!;
    if (value < cap && value < bestCount) { bestCount = value; position = candidate; }
  }
  counts[position] = counts[position]! + 1;
  return { index, difficulty, subjectCount, disciplines, answerIndex: position };
}
