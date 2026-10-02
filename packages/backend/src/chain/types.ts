/** Domain types for the quiz chain engine. */

/** One core discipline (of the 12 required by the owner's spec). */
export interface Discipline {
  readonly id: string;
  readonly th: string;
  readonly en: string;
}

/** The correct key of a question: primary index plus accepted alternatives. */
export interface ChainAnswerKey {
  readonly answerIndex: number;
  readonly alternatives: readonly number[];
}

/** A multiple-choice question stored in the quiz bank. */
export interface QuizQuestion {
  /** Stable id, e.g. `q-000001`. */
  readonly id: string;
  /** Bank slot index (0-based). Deterministic banks derive all fields from it. */
  readonly slot: number;
  /** Discipline id — one of the 12 core disciplines. */
  readonly discipline: string;
  /** Difficulty 1 (easiest) … 10 (hardest). */
  readonly difficulty: number;
  /** Question text, Thai and English. */
  readonly prompt: { readonly th: string; readonly en: string };
  /** Exactly four options in display order; index 3 is always the answer. */
  readonly options: readonly [string, string, string, string];
  /** Index of the correct option (0–3). Kept OFF the public payload. */
  readonly answerIndex: number;
  /** Additional accepted option indices (admin-added answers). */
  readonly alternatives: readonly number[];
  /**
   * SHA-256 of the canonical PUBLIC question payload (slot, discipline,
   * difficulty, prompt, options) — never the answer. Anyone holding the
   * published question can recompute it, and it reveals nothing about the
   * key (brute-forcing 4 candidate keys against a published hash would).
   */
  readonly contentHash: string;
  /**
   * Blind commitment to the answer key: sha256 of the canonical
   * {slot, answerIndex, alternatives, v} payload. Internal — never published
   * with the question; sealed into blocks as the block's answerCommitment.
   */
  readonly answerCommitment: string;
}

/** Question embedded in a mined block (never includes the answer). */
export interface PublicQuestion {
  readonly id: string;
  readonly discipline: string;
  readonly difficulty: number;
  readonly prompt: { readonly th: string; readonly en: string };
  readonly options: readonly string[];
  /** Public content hash (does not cover the answer key). */
  readonly contentHash: string;
}

/** One recorded answer attempt inside a block. */
export interface ChainAnswer {
  readonly questionId: string;
  readonly blockHeight: number;
  readonly miner: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly answeredAt: number;
  /** SHA-256(commitAnswer(choice, blockHeight, questionId, miner, secret)). */
  readonly commitmentHash: string;
}

/** Admin action recorded on-chain (add/edit answers, mined via PoW). */
export interface AdminAction {
  readonly id: string;
  readonly kind: 'EDIT_ANSWER' | 'ADD_QUESTION';
  readonly questionId: string;
  readonly oldAnswer: ChainAnswerKey | null;
  readonly newAnswer: ChainAnswerKey | null;
  /** For ADD_QUESTION: the full admin-authored question (answer included in hash). */
  readonly newQuestion: AdminQuestionInput | null;
  readonly by: string;
  readonly at: number;
  /** SHA-256 of the canonical action payload (covers the full new content). */
  readonly actionHash: string;
}

/** Admin-authored question payload for ADD_QUESTION. */
export interface AdminQuestionInput {
  readonly discipline: string;
  readonly difficulty: number;
  readonly prompt: { readonly th: string; readonly en: string };
  readonly options: readonly [string, string, string, string];
  readonly answerIndex: number;
  readonly alternatives?: readonly number[];
}

/** Special hash event fired every 1,000 blocks. */
export interface MilestoneHash {
  readonly blockHeight: number;
  /** SHA-256 over the full chain history up to this block. */
  readonly milestoneHash: string;
  /** Hash of the first block of the span covered by this milestone. */
  readonly spanFromBlockHash: string;
  /** Hash of the block that triggered the milestone. */
  readonly spanToBlockHash: string;
  /** Number of blocks covered (usually 1,000; 1 for the milestone at block 1). */
  readonly spanBlocks: number;
  readonly totalCumulativeWork: string;
  readonly at: number;
}

/** Full block of the quiz chain. */
export interface QuizBlock {
  readonly height: number;
  /** `0x000…0` for the genesis (height 1). */
  readonly parentHash: string;
  readonly hash: string;
  readonly timestamp: number;
  /** Number of PoW leading zero bits this block had to satisfy. */
  readonly difficultyBits: number;
  readonly nonce: number;
  readonly miner: string;
  /** Total PoW hashes tried while mining this block. */
  readonly attempts: number;
  readonly miningMs: number;
  /** Whether this block used the elevated (÷10 / ÷1,000) difficulty. */
  readonly isHard: boolean;
  readonly isMilestone: boolean;
  readonly question: PublicQuestion;
  readonly answers: readonly ChainAnswer[];
  readonly adminActions: readonly AdminAction[];
  /**
   * Blind commitment to the FINAL graded answer key of this block's question
   * (bank answer + admin overrides at seal time). Lets any verifier or peer
   * confirm the embedded key is the genuine bank/admin one without learning
   * the key itself. `null` only for legacy/pre-upgrade blocks.
   */
  readonly answerCommitment: string | null;
  /**
   * The REVEALED correct option (0–3) of the FINAL graded key — published
   * only once the block is sealed (commit-reveal: hidden while open, public
   * knowledge afterwards). `null` only for legacy/pre-upgrade blocks.
   */
  readonly revealedAnswerIndex: number | null;
  readonly milestone: MilestoneHash | null;
}

/** Mutable per-chain aggregates. */
export interface ChainStats {
  readonly height: number;
  readonly totalBlocks: number;
  readonly totalAttempts: number;
  readonly totalMiningMs: number;
  readonly totalAnswerCount: number;
  readonly correctAnswerCount: number;
  readonly lastBlockAt: number | null;
  readonly avgBlockIntervalMs: number | null;
  readonly avgAttemptsPerBlock: number;
}

/** A snapshot of the whole chain for persistence/inspection. */
export interface ChainSnapshot {
  readonly blocks: readonly QuizBlock[];
  readonly stats: ChainStats;
  /** Highest milestone emitted so far (0 when none). */
  readonly lastMilestoneHeight: number;
  /** Cumulative PoW attempts across all mined blocks. */
  readonly totalCumulativeWork: string;
}
