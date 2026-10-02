/**
 * A bilingual (EN/TH) text value. UI strings must never be hardcoded in code —
 * they live in the i18n dictionaries instead.
 */
export interface LocalizedText {
  /** English content. */
  en: string;
  /** Thai content. */
  th: string;
}

/**
 * A problem from the Problem Bank revealed in a block.
 */
export interface Problem {
  /** Stable unique identifier (e.g. slug or UUID). */
  id: string;
  /** Height of the block that reveals this problem. */
  blockHeight: number;
  /**
   * `DETERMINISTIC` problems are machine-checkable;
   * `OPEN_ENDED` problems require human peer review (AGENTS.md §9).
   */
  type: 'DETERMINISTIC' | 'OPEN_ENDED';
  /** Academic/practical disciplines this problem belongs to (length 2–4). */
  disciplines: string[];
  /** Difficulty rating from 1 (easiest) to 10 (hardest). */
  difficulty: number;
  /** Problem statement in English and Thai. */
  statement: LocalizedText;
  /** SHA-256 commit hash of the reference answer, revealed later. */
  answerCommitHash: string;
  /** Unix timestamp (seconds) at which the answer was revealed. `0` if still committed. */
  revealedAt: number;
}
