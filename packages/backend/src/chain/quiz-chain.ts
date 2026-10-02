import {
  HARD_BLOCK_EVERY,
  HARD_BLOCK_EXTRA_DIFFICULTY_BITS,
  MAX_ADMIN_ACTIONS_PER_BLOCK,
  MAX_ANSWERS_PER_BLOCK,
  MILESTONE_EXTRA_DIFFICULTY_BITS,
} from './constants.js';
import { canonicalJson, sha256Hex } from './hash.js';
import { TOTAL_QUESTIONS } from './quiz-bank.js';
import { commitAnswerChoice, effectiveKey, isChoiceCorrect } from './answer-gate.js';
import {
  blockHashMatches,
  buildMilestone,
  GENESIS_PARENT_HASH,
  hashBlock,
  isMilestoneHeight,
  meetsDifficulty,
  questionIntegrityErrorsForBlock,
} from './block.js';
import { answerCommitmentForQuestion } from './quiz-bank.js';
import { defaultQuestionFactory } from './question-factory.js';
import type { QuestionFactory } from './question-factory.js';
import type {
  AdminAction,
  ChainAnswer,
  ChainStats,
  ChainSnapshot,
  MilestoneHash,
  PublicQuestion,
  QuizBlock,
  QuizQuestion,
} from './types.js';

/** Difficulty for a height: base 12 bits, +1 on ÷10, +3 more on ÷1,000. */
export function difficultyBitsForHeight(height: number, baseBits = 12): number {
  let bits = baseBits;
  if (height % HARD_BLOCK_EVERY === 0) bits += HARD_BLOCK_EXTRA_DIFFICULTY_BITS;
  if (isMilestoneHeight(height) && height !== 1) bits += MILESTONE_EXTRA_DIFFICULTY_BITS;
  return bits;
}

export interface MineOutcome {
  readonly block: QuizBlock;
  readonly attempts: number;
  readonly miningMs: number;
}

export interface SubmitAnswerInput {
  readonly blockHeight: number;
  readonly miner: string;
  readonly choice: number;
  readonly answeredAt?: number;
  /** Optional secret to blind the on-chain commitment. */
  readonly secret?: string;
}

export interface QuizChainOptions {
  /** Deterministic seed for question assignment. */
  seed?: number;
  /** Base PoW difficulty bits (default 12; keep low for dev/test). */
  baseDifficultyBits?: number;
  /** Question factory (defaults to the standard 100k bank factory). */
  questionFactory?: QuestionFactory;
  /** Injectable clock. */
  now?: () => number;
}

/**
 * The quiz chain: sequential SHA-256-mined blocks embedding one quiz question
 * each. Sequencing is strict — `startNextBlock()` throws while a block is
 * still open, so the next block cannot begin before the previous one is
 * sealed. Hard blocks (every 10th) and milestone blocks (every 1,000th) get
 * elevated difficulty. Milestones additionally publish a chain-history hash
 * every 1,000 blocks.
 */
export class QuizChain {
  readonly #blocks: QuizBlock[] = [];
  readonly #answers: ChainAnswer[] = [];
  readonly #adminActions: AdminAction[] = [];
  readonly #now: () => number;
  readonly #baseDifficultyBits: number;
  readonly #factory: QuestionFactory;
  #openQuestion: QuizQuestion | null = null;
  #openHeight = 0;
  #totalAttempts = 0;
  #totalMiningMs = 0;
  #lastMilestoneHeight = 0;
  #totalCumulativeWork = 0n;
  #pendingEditActions: AdminAction[] = [];

  constructor(options: QuizChainOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#baseDifficultyBits = options.baseDifficultyBits ?? 12;
    this.#factory = options.questionFactory ?? defaultQuestionFactory;
  }

  /** All sealed blocks in height order. */
  get blocks(): readonly QuizBlock[] {
    return this.#blocks;
  }

  /** Height of the latest sealed block (0 for an empty chain). */
  get height(): number {
    return this.#blocks.length;
  }

  /** Current open block's question, or null when no block is open. */
  get openQuestion(): QuizQuestion | null {
    return this.#openQuestion;
  }

  /** Height of the open block (0 when none). */
  get openHeight(): number {
    return this.#openHeight;
  }

  /** All recorded answers across sealed blocks (the open block's answers join at seal). */
  get answers(): readonly ChainAnswer[] {
    return this.#answers;
  }

  /** All on-chain admin actions (edited/added answers, questions). */
  get adminActions(): readonly AdminAction[] {
    return this.#adminActions;
  }

  /** Aggregated chain statistics. */
  get stats(): ChainStats {
    const intervals: number[] = [];
    for (let i = 1; i < this.#blocks.length; i += 1) {
      const prev = this.#blocks[i - 1]!;
      const curr = this.#blocks[i]!;
      intervals.push(curr.timestamp - prev.timestamp);
    }
    const avgInterval = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
    // Aggregates cover SEALED blocks only: answers recorded for the still-open
    // block are graded in memory but must stay out of any public counter, or
    // polling `/api/status` (or the dashboard) would reveal a right answer the
    // moment it is submitted. They join the counters when the block seals.
    const sealedAnswers = this.#answers.filter((answer) => answer.blockHeight <= this.height);
    const correctCount = sealedAnswers.filter((answer) => answer.correct).length;
    return {
      height: this.height,
      totalBlocks: this.#blocks.length,
      totalAttempts: this.#totalAttempts,
      totalMiningMs: this.#totalMiningMs,
      totalAnswerCount: sealedAnswers.length,
      correctAnswerCount: correctCount,
      lastBlockAt: this.#blocks.length > 0 ? this.#blocks[this.#blocks.length - 1]!.timestamp : null,
      avgBlockIntervalMs: avgInterval,
      avgAttemptsPerBlock: this.#blocks.length > 0 ? Math.round(this.#totalAttempts / this.#blocks.length) : 0,
    };
  }

  /** Highest milestone height emitted so far (0 when none). */
  get lastMilestoneHeight(): number {
    return this.#lastMilestoneHeight;
  }

  /** Cumulative PoW work (hash attempts) across all mined blocks. */
  get totalCumulativeWork(): string {
    return this.#totalCumulativeWork.toString();
  }

  /**
   * Opens the next block. Throws when another block is still open (strict
   * sequencing: no new block until the previous one is sealed) or when the
   * bank is exhausted.
   */
  startNextBlock(miner = 'genesis'): PublicQuestion {
    if (this.#openQuestion !== null) {
      throw new Error('BLOCK_ALREADY_OPEN');
    }
    const height = this.height + 1;
    if (height > TOTAL_QUESTIONS) {
      throw new Error('BANK_EXHAUSTED');
    }
    const isHard = height % HARD_BLOCK_EVERY === 0;
    const question = this.#factory.forHeight(height, isHard, this.#pendingEditActions);
    this.#openHeight = height;
    this.#openQuestion = question;
    this.#openMiner = miner;
    return this.#factory.toPublic(question);
  }

  #openMiner = 'genesis';

  /**
   * Mines and seals the open block: verifies the question payload, records
   * answers, applies queued admin actions, solves PoW and appends the block.
   */
  sealCurrentBlock(): QuizBlock {
    if (this.#openQuestion === null) {
      throw new Error('NO_OPEN_BLOCK');
    }
    const height = this.#openHeight;
    const question = this.#openQuestion;
    const miner = this.#openMiner;
    const startedAt = this.#now();
    const difficultyBits = difficultyBitsForHeight(height, this.#baseDifficultyBits);
    const isHard = height % HARD_BLOCK_EVERY === 0;

    // Admin actions queued since the last block are committed here.
    const blockActions = this.#pendingEditActions.slice(0, MAX_ADMIN_ACTIONS_PER_BLOCK);
    this.#pendingEditActions = this.#pendingEditActions.slice(blockActions.length);
    // Answers recorded during the open window, re-graded against the final
    // key (bank answer + admin overrides committed in THIS block).
    const answers: readonly ChainAnswer[] = this.#answers
      .filter((answer) => answer.blockHeight === height)
      .map((answer) => ({
        ...answer,
        correct: isChoiceCorrect(question, [...this.#adminActions, ...blockActions], answer.choice),
      }));

    const parentHash = this.#blocks.length > 0 ? this.#blocks[this.#blocks.length - 1]!.hash : GENESIS_PARENT_HASH;
    const isMilestoneBlock = isMilestoneHeight(height) && height !== 1;
    const publicQuestion = this.#factory.toPublic(question);

    // Blind commitment to the FINAL graded key (bank answer + admin edits
    // committed in this block) — the exact key every answer was graded
    // against. It lives in the header (so PoW seals it) but never reveals
    // the key; verifiers recompute it from the same bank + on-chain actions.
    const finalKey = effectiveKey(question, [...this.#adminActions, ...blockActions]);
    const answerCommitment = answerCommitmentForQuestion(question.slot, finalKey.answerIndex, finalKey.alternatives);

    // Milestone payload depends only on prior history + this block's height
    // and timestamp, so it can be built BEFORE mining and hashed as part of
    // the header — one PoW pass, no re-mine.
    let milestone: MilestoneHash | null = null;
    if (isMilestoneBlock) {
      const preBlock: QuizBlock = {
        height,
        parentHash,
        hash: '',
        timestamp: startedAt,
        difficultyBits,
        nonce: 0,
        miner,
        attempts: 0,
        miningMs: 0,
        isHard,
        isMilestone: true,
        question: publicQuestion,
        answers,
        adminActions: blockActions,
        answerCommitment,
        revealedAnswerIndex: finalKey.answerIndex,
        milestone: null,
      };
      milestone = buildMilestone(preBlock, this.#totalCumulativeWork.toString(), this.#blocks);
    }

    // Solve PoW: hash the header until the difficulty is met.
    let nonce = 0;
    let attempts = 0;
    let hash = '';
    for (;;) {
      const candidate: QuizBlock = {
        height,
        parentHash,
        hash: '',
        timestamp: startedAt,
        difficultyBits,
        nonce,
        miner,
        attempts: 0,
        miningMs: 0,
        isHard,
        isMilestone: isMilestoneBlock,
        question: publicQuestion,
        answers,
        adminActions: blockActions,
        answerCommitment,
        revealedAnswerIndex: finalKey.answerIndex,
        milestone,
      };
      hash = hashBlock(candidate);
      attempts += 1;
      if (meetsDifficulty(hash, difficultyBits)) break;
      nonce += 1;
      if (nonce > 50_000_000) throw new Error('POW_TIMEOUT');
    }

    const miningMs = Math.max(0, this.#now() - startedAt);
    this.#totalAttempts += attempts;
    this.#totalMiningMs += miningMs;
    this.#totalCumulativeWork += BigInt(attempts);

    const finalBlock: QuizBlock = {
      height,
      parentHash,
      hash,
      timestamp: startedAt,
      difficultyBits,
      nonce,
      miner,
      attempts,
      miningMs,
      isHard,
      isMilestone: isMilestoneBlock,
      question: publicQuestion,
      answers,
      adminActions: blockActions,
      answerCommitment,
      revealedAnswerIndex: finalKey.answerIndex,
      milestone,
    };
    if (!blockHashMatches(finalBlock)) throw new Error('BLOCK_HASH_MISMATCH');

    this.#blocks.push(finalBlock);
    this.#adminActions.push(...blockActions);
    this.#openQuestion = null;
    this.#openHeight = 0;
    this.#openMiner = 'genesis';
    if (milestone) this.#lastMilestoneHeight = height;
    return finalBlock;
  }

  /**
   * Records an answer for the open block. The answer is checked against the
   * effective key (bank answer + admin-added alternatives). Answers recorded
   * after the block is sealed are rejected.
   */
  submitAnswer(input: SubmitAnswerInput): ChainAnswer {
    if (this.#openQuestion === null) {
      throw new Error('NO_OPEN_BLOCK');
    }
    if (input.blockHeight !== this.#openHeight) {
      throw new Error('BLOCK_HEIGHT_MISMATCH');
    }
    if (this.#answers.filter((answer) => answer.blockHeight === this.#openHeight).length >= MAX_ANSWERS_PER_BLOCK) {
      throw new Error('TOO_MANY_ANSWERS');
    }
    // Grading uses committed actions PLUS pending ones so an admin answer
    // edit takes effect immediately for the open block (it is committed to
    // the chain when this block seals).
    const correct = isChoiceCorrect(this.#openQuestion, [...this.#adminActions, ...this.#pendingEditActions], input.choice);
    const answer: ChainAnswer = {
      questionId: this.#openQuestion.id,
      blockHeight: this.#openHeight,
      miner: input.miner,
      choice: input.choice,
      correct,
      answeredAt: input.answeredAt ?? this.#now(),
      commitmentHash: commitAnswerChoice(
        input.choice,
        this.#openQuestion.id,
        this.#openHeight,
        input.miner,
        input.secret ?? 'default-secret',
        ),
    };
    this.#answers.push(answer);
    return answer;
  }
  /** Queues an admin action (answer edit / new question) for the next block. */
  queueAdminAction(action: Omit<AdminAction, 'actionHash'> & { actionHash?: string }): AdminAction {
    const withHash: AdminAction = {
      ...action,
      actionHash: action.actionHash ?? sha256Hex(canonicalJson(action)),
    };
    this.#pendingEditActions.push(withHash);
    return withHash;
  }

  /** Verifies a full chain: heights, parent links, PoW, hashes, milestones. */
  verifyChain(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    let prevHash = GENESIS_PARENT_HASH;
    let cumulative = 0n;
    let expectedHeight = 1;
    const priorActions: AdminAction[] = [];
    for (const block of this.#blocks) {
      if (block.height !== expectedHeight) errors.push(`HEIGHT_MISMATCH@${block.height}`);
      expectedHeight += 1;
      const expectedBits = difficultyBitsForHeight(block.height, this.#baseDifficultyBits);
      if (block.parentHash !== prevHash) errors.push(`PARENT_HASH_MISMATCH@${block.height}`);
      if (!blockHashMatches(block)) errors.push(`BLOCK_HASH_MISMATCH@${block.height}`);
      if (!meetsDifficulty(block.hash, expectedBits)) errors.push(`POW_INSUFFICIENT@${block.height}`);
      // Question + blind answer commitment must match the deterministic bank
      // (recomputed with the actions committed up to and including this block).
      errors.push(...questionIntegrityErrorsForBlock(block, priorActions, this.#factory));
      cumulative += BigInt(block.attempts);
      if (block.milestone && block.milestone.blockHeight !== block.height) errors.push(`MILESTONE_HEIGHT_MISMATCH@${block.height}`);
      if (isMilestoneHeight(block.height) && block.height !== 1 && !block.milestone) errors.push(`MILESTONE_MISSING@${block.height}`);
      priorActions.push(...block.adminActions);
      prevHash = block.hash;
    }
    if (cumulative.toString() !== this.#totalCumulativeWork.toString()) errors.push('CUMULATIVE_WORK_MISMATCH');
    return { valid: errors.length === 0, errors };
  }

  /** Full snapshot for persistence or the API/UI. */
  snapshot(): ChainSnapshot {
    return {
      blocks: [...this.#blocks],
      stats: this.stats,
      lastMilestoneHeight: this.#lastMilestoneHeight,
      totalCumulativeWork: this.#totalCumulativeWork.toString(),
    };
  }

  /**
   * Restores in-memory state from durable blocks (the single source of
   * truth): replays answers and admin actions out of the block bodies and
   * recomputes cumulative work and the milestone cursor. Callers must run
   * {@link verifyChain} afterwards and treat a failure as fatal.
   */
  restoreFromBlocks(blocks: readonly QuizBlock[]): void {
    if (this.#blocks.length > 0 || this.#answers.length > 0 || this.#adminActions.length > 0 || this.#pendingEditActions.length > 0) {
      throw new Error('RESTORE_ONLY_ON_EMPTY_CHAIN');
    }
    this.#blocks.push(...blocks);
    for (const block of this.#blocks) {
      this.#answers.push(...block.answers);
      this.#adminActions.push(...block.adminActions);
      this.#totalAttempts += block.attempts;
      this.#totalMiningMs += block.miningMs;
      this.#totalCumulativeWork += BigInt(block.attempts);
      if (block.milestone !== null) this.#lastMilestoneHeight = block.height;
    }
  }

  /**
   * Atomically replaces the whole chain with another verified chain — the
   * fork-choice commit point used by peer sync. Replays answers/admin
   * actions/cumulative work from the new blocks and closes the open block
   * (the caller re-opens the next one from the new tip). Queued admin
   * actions survive the swap and land in the next block either way.
   * Callers must have validated `blocks` with {@link verifyChain}-equivalent
   * logic BEFORE calling this; the method itself does not re-verify.
   */
  replaceFromBlocks(blocks: readonly QuizBlock[]): void {
    this.#blocks.length = 0;
    this.#answers.length = 0;
    this.#adminActions.length = 0;
    this.#totalAttempts = 0;
    this.#totalMiningMs = 0;
    this.#totalCumulativeWork = 0n;
    this.#lastMilestoneHeight = 0;
    // The previously open window belongs to the discarded fork.
    this.#openQuestion = null;
    this.#openHeight = 0;
    this.#openMiner = 'genesis';
    this.#blocks.push(...blocks);
    for (const block of this.#blocks) {
      this.#answers.push(...block.answers);
      this.#adminActions.push(...block.adminActions);
      this.#totalAttempts += block.attempts;
      this.#totalMiningMs += block.miningMs;
      this.#totalCumulativeWork += BigInt(block.attempts);
      if (block.milestone !== null) this.#lastMilestoneHeight = block.height;
    }
  }
}
