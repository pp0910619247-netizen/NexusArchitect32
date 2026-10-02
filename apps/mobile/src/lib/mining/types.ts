/**
 * Mining tab contracts. The data source is injected so the screen works
 * offline today and talks to the quiz-chain node without UI changes.
 */

export type MiningSessionStatus = 'idle' | 'starting' | 'mining';

export type AnswerStatus = 'none' | 'submitting' | 'submitted' | 'failed';

/** Aggregated node status (`GET /api/status`), narrowed to what the UI shows. */
export interface ChainSummary {
  readonly height: number;
  /** Height of the currently open (being mined) block, or `null`. */
  readonly openHeight: number | null;
  /** Highest milestone height so far (0 when none). */
  readonly lastMilestoneHeight: number;
  readonly totalAttempts: number;
}

/** The quiz question revealed for the open block (`GET /api/question/current`). */
export interface QuizQuestionView {
  readonly id: string;
  readonly blockHeight: number;
  readonly disciplineId: string;
  readonly disciplineTh: string;
  readonly disciplineEn: string;
  readonly difficulty: number;
  readonly promptTh: string;
  readonly promptEn: string;
  readonly options: readonly string[];
}

/**
 * Result of posting one answer (`POST /api/answer`).
 *
 * Success never carries correctness: while a block is open the node accepts
 * the answer but stays silent about whether it is right (no oracle to probe —
 * see `resolveFeedbackKey`). The sealed block publishes the result.
 */
export type AnswerOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'rejected' | 'network' | 'error' };

/** Bridge to the quiz-chain node for status + question + answer traffic. */
export interface QuizChainDataSource {
  /** Node status summary. Throws on network/payload errors. */
  fetchSummary(): Promise<ChainSummary>;
  /**
   * The question for the open block, or `null` when no block is open
   * (HTTP 404 `NO_OPEN_BLOCK`). Throws on network/payload errors.
   */
  fetchCurrentQuestion(): Promise<QuizQuestionView | null>;
  /**
   * Submits the chosen option for the given block height. Throws on network
   * errors; returns `ok: false` when the node rejected the answer.
   */
  submitAnswer(blockHeight: number, choice: number): Promise<AnswerOutcome>;
}
