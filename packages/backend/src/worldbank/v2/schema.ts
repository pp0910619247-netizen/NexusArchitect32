// SPDX-License-Identifier: MIT
/**
 * world-v2 schema — a second, harder bank built for the owner's spec:
 *
 *  • 12 *new* subjects (physics/quantum is its own subject, not a school topic)
 *  • difficulty = how many subjects an item demands AT ONCE (4, 6, 8, 10, 12)
 *  • every clause answer is an INTEGER inside the search space 1…10,000,000
 *  • every answer is recomputable by machine (complete enumeration of the space,
 *    or an arithmetic definition) — no human judgement anywhere
 *  • TH and EN are stored as two complete renderings, never a translation pass
 *
 * Nothing here reads the clock, the network, or any file: the whole bank is a
 * pure function of the item index, so re-running the generator is byte-identical.
 */

export const SCHEMA_VERSION = 'world-v2';

/** Total items in the bank. */
export const TOTAL = 10_000;
/** Items per JSONL file. */
export const QUESTIONS_PER_FILE = 1_000;
/** Number of JSONL files. */
export const FILE_COUNT = TOTAL / QUESTIONS_PER_FILE;
/** Item id prefix (w2-000001 … w2-010000). */
export const ID_PREFIX = 'w2';
/** Year stamped on every verified item (chain era marker, not a fact source). */
export const VERIFIED_YEAR = 2026;

/**
 * The numeric search space every answer lives in: the owner asked the answer to
 * be a number the system can prove by searching 1…10,000,000.
 */
export const SPACE_MIN = 1;
export const SPACE_MAX = 10_000_000;
/** Size of one enumeration block (100 blocks cover the whole space). */
export const BLOCK_SIZE = 100_000;
export const BLOCK_COUNT = SPACE_MAX / BLOCK_SIZE;

/** Hard cap on how often one option position may be the answer inside a file. */
export const ANSWER_CAP_PER_FILE = 0.4;

export interface Bilingual {
  readonly th: string;
  readonly en: string;
}

/** Options are stored as two complete renderings (numbers + unit words). */
export interface OptionSet {
  readonly th: readonly string[];
  readonly en: readonly string[];
}

export type ClauseKind = 'count' | 'formula';

/** One verifiable sub-answer ("clause") of an item. */
export interface Clause {
  /** Subject id this clause belongs to. */
  readonly subject: string;
  readonly kind: ClauseKind;
  /** Predicate id (kind = count) or formula id (kind = formula). */
  readonly source: string;
  /** For kind = count: inclusive block range inside the space. */
  readonly range?: readonly [number, number];
  /** The correct integer — always recomputed by the validator, never trusted. */
  readonly value: number;
  /** Optional unit, exactly the piece that changes between TH and EN options. */
  readonly unit?: Bilingual;
  /** Clause text as shown inside the prompt. */
  readonly text: Bilingual;
}

export interface WorldQuestionV2 {
  readonly id: string;
  /** Subject ids used by the item; index 0 is the primary subject. */
  readonly subjects: readonly string[];
  readonly primarySubject: string;
  /** 4 / 6 / 8 / 10 / 12 — the difficulty axis of this bank. */
  readonly subjectCount: number;
  /** 1…4 (2,500 items each). */
  readonly tier: number;
  /** Display difficulty 1…10 derived from subjectCount. */
  readonly difficulty: number;
  readonly prompt: Bilingual;
  /** Four options; exactly one equals the clause values in order. */
  readonly options: OptionSet;
  readonly answerIndex: number;
  readonly explanation: Bilingual;
  readonly clauses: readonly Clause[];
  readonly tags: readonly string[];
  readonly verifiedYear: number;
}

export function itemId(index: number): string {
  return `${ID_PREFIX}-${String(index + 1).padStart(6, '0')}`;
}
