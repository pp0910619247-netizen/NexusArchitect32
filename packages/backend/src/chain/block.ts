import { canonicalJson, leadingZeroBits, sha256Hex } from './hash.js';
import { answerCommitmentForQuestion } from './quiz-bank.js';
import type { AdminAction, ChainAnswer, MilestoneHash, PublicQuestion, QuizBlock, QuizQuestion } from './types.js';

export const GENESIS_PARENT_HASH = `0x${'0'.repeat(64)}`;

/**
 * Stable internal version so header hashing never changes silently. v2:
 * header gained the blind `answerCommitment` (anti-answer-leak upgrade).
 */
const HEADER_VERSION = 2;

/** Serializable header fields (everything except `hash`). */
export interface QuizBlockHeader {
  readonly height: number;
  readonly parentHash: string;
  readonly timestamp: number;
  readonly difficultyBits: number;
  readonly nonce: number;
  readonly miner: string;
  readonly question: PublicQuestion;
  readonly answers: readonly ChainAnswer[];
  readonly adminActions: readonly AdminAction[];
  readonly answerCommitment: string | null;
  /** Sealed blocks publish the answer (commit-reveal); always null in headers while a block is open. */
  readonly revealedAnswerIndex: number | null;
  readonly milestone: MilestoneHash | null;
}

/**
 * Header fields covered by the block hash. `attempts`, `miningMs` and `hash`
 * are post-hoc metadata and stay OUT of the hash so a sealed block's hash is
 * always recomputable from its header.
 */
export type QuizBlockHeaderInput = Pick<
  QuizBlock,
  'height' | 'parentHash' | 'timestamp' | 'difficultyBits' | 'nonce' | 'miner' | 'question' | 'answers' | 'adminActions' | 'answerCommitment' | 'revealedAnswerIndex' | 'milestone'
>;

/** Serializes a block header to its exact on-wire form (canonical JSON). */
export function serializeBlock(block: QuizBlockHeaderInput): string {
  return canonicalJson({
    height: block.height,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    difficultyBits: block.difficultyBits,
    nonce: block.nonce,
    miner: block.miner,
    question: block.question,
    answers: block.answers,
    adminActions: block.adminActions,
    answerCommitment: block.answerCommitment,
    revealedAnswerIndex: block.revealedAnswerIndex,
    milestone: block.milestone,
    v: HEADER_VERSION,
  });
}

/** Computes a block's hash from its serialized header. */
export function hashBlock(block: QuizBlockHeaderInput): string {
  return sha256Hex(serializeBlock(block));
}

/** Verifies a block's stored hash matches its header payload. */
export function blockHashMatches(block: QuizBlock): boolean {
  return block.hash === hashBlock(block);
}

/** PoW target: `difficultyBits` leading zero bits required. */
export function meetsDifficulty(hash: string, difficultyBits: number): boolean {
  return leadingZeroBits(hash) >= difficultyBits;
}

/** Milestone marker for a given height (block 1 and every 1,000 after). */
export function isMilestoneHeight(height: number): boolean {
  return height === 1 || height % 1_000 === 0;
}

/**
 * Minimal factory surface needed to recompute a height's bank question
 * (structurally satisfied by {@link QuestionFactory}).
 */
export interface QuestionIntegrityChecker {
  forHeight(height: number, isHard: boolean, actions: readonly AdminAction[]): QuizQuestion;
}

/**
 * Commit-reveal consistency (checked inside {@link questionIntegrityErrorsForBlock}):
 * a sealed block must publish `revealedAnswerIndex` equal to the FINAL graded
 * key recomputed from the bank + on-chain admin actions — so the answer made
 * public after sealing IS the answer committed before mining. Admin-added
 * alternatives stay publicly auditable through the on-chain actions.
 */

/**
 * Anti-tamper checks for a block's question and answer key, recomputed from
 * the deterministic bank:
 * - the published `question.contentHash` must equal the bank's public hash
 *   for that height (catches a swapped/edited question payload),
 * - the block's blind `answerCommitment` must equal the commitment of the
 *   FINAL graded key (bank answer + admin edits committed up to and
 *   including this block) — catchable WITHOUT knowing the key because the
 *   verifier recomputes it from the same public bank + on-chain actions.
 *
 * `priorActions` = admin actions committed in all earlier blocks, in order.
 * Errors use the same `CODE@height` convention as verifyChain.
 */
export function questionIntegrityErrorsForBlock(
  block: QuizBlock,
  priorActions: readonly AdminAction[],
  factory: QuestionIntegrityChecker,
): string[] {
  const errors: string[] = [];
  if (!/^q-\d{6}$/.test(block.question.id)) {
    errors.push(`QUESTION_NOT_FROM_BANK@${block.height}`);
    return errors;
  }
  if (block.answerCommitment === null) {
    errors.push(`ANSWER_COMMITMENT_MISSING@${block.height}`);
    return errors;
  }
  if (!/^0x[0-9a-f]{64}$/.test(block.answerCommitment)) {
    errors.push(`ANSWER_COMMITMENT_MALFORMED@${block.height}`);
    return errors;
  }
  const actionsThroughBlock = [...priorActions, ...block.adminActions];
  const expected = factory.forHeight(block.height, block.isHard, actionsThroughBlock);
  if (block.question.contentHash !== expected.contentHash) {
    errors.push(`QUESTION_CONTENT_MISMATCH@${block.height}`);
  }
  const expectedCommitment = answerCommitmentForQuestion(expected.slot, expected.answerIndex, expected.alternatives);
  if (block.answerCommitment !== expectedCommitment) {
    errors.push(`ANSWER_COMMITMENT_MISMATCH@${block.height}`);
  }
  // Commit-reveal: the PUBLIC answer must equal the key bound by the sealed
  // commitment (admin alternatives are auditable via the on-chain actions).
  if (block.revealedAnswerIndex === null) {
    errors.push(`REVEAL_MISSING@${block.height}`);
  } else if (block.revealedAnswerIndex !== expected.answerIndex) {
    errors.push(`REVEAL_MISMATCH@${block.height}`);
  }
  return errors;
}

/** Minimal block reference used by history hashing. */
export interface BlockHashRef {
  readonly height: number;
  readonly hash: string;
}

/**
 * Chain history digest: hashes the chain of block hashes from genesis to
 * `upToHeight`. O(n) but only recomputed at milestone heights.
 */
export function chainHistoryHash(blocks: readonly BlockHashRef[], upToHeight: number): string {
  let digest = GENESIS_PARENT_HASH;
  for (const block of blocks) {
    if (block.height > upToHeight) break;
    digest = sha256Hex(`${digest}:${block.hash}`);
  }
  return digest;
}

/** Milestone record tying a height to the full chain history. */
export function buildMilestone(block: QuizBlock, totalCumulativeWork: string, priorBlocks: readonly QuizBlock[]): MilestoneHash {
  const historyHash = chainHistoryHash([...priorBlocks, block], block.height);
  const firstOfSpan = priorBlocks.length > 0 ? priorBlocks[0]! : null;
  return {
    blockHeight: block.height,
    milestoneHash: sha256Hex(`MILESTONE:${historyHash}:${totalCumulativeWork}`),
    spanFromBlockHash: firstOfSpan?.hash ?? GENESIS_PARENT_HASH,
    spanToBlockHash: historyHash,
    spanBlocks: block.height,
    totalCumulativeWork,
    at: block.timestamp,
  };
}

/** Rebuilds the header view of a block (used by tests/inspection). */
export function toHeader(block: QuizBlock): QuizBlockHeader {
  return {
    height: block.height,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    difficultyBits: block.difficultyBits,
    nonce: block.nonce,
    miner: block.miner,
    question: block.question,
    answers: block.answers,
    adminActions: block.adminActions,
    answerCommitment: block.answerCommitment,
    revealedAnswerIndex: block.revealedAnswerIndex,
    milestone: block.milestone,
  };
}
