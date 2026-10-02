/** Immutable public metadata stored in Git. */
export interface PublicProblemFile {
  readonly blockHeight: number;
  readonly type: 'DETERMINISTIC' | 'OPEN_ENDED';
  readonly disciplines: readonly string[];
  readonly difficulty: number;
  readonly statement: Readonly<{ en: string; th: string }>;
  readonly answerCommitHash: `0x${string}`;
}

/** Offline secrets stored outside Git. */
export interface PrivateProblemFile {
  readonly blockHeight: number;
  readonly answerPlain: string;
  readonly salt: string;
  readonly answerCommitHash: `0x${string}`;
}

export interface ProblemInput {
  readonly blockHeight: number;
  readonly type: 'DETERMINISTIC' | 'OPEN_ENDED';
  readonly disciplines: readonly string[];
  readonly difficulty: number;
  readonly statement: Readonly<{ en: string; th: string }>;
  readonly answerPlain: string;
  readonly salt: string;
  /** Stable identifier; retained for generated drafts and ignored by problem:add. */
  readonly id?: string;
  /** Open-ended drafts must provide exactly five human review criteria. */
  readonly rubric?: readonly RubricCriterion[];
  /** Open-ended drafts are never decided by automated scoring. */
  readonly peerReviewRequired?: boolean;
}

/** One criterion in a human peer-review rubric for an open-ended problem. */
export interface RubricCriterion {
  readonly id: string;
  readonly description: Readonly<{ en: string; th: string }>;
  readonly maxPoints: number;
}

export interface PublicProblemResponse extends PublicProblemFile {
  readonly revealed: boolean;
  readonly answerPlain?: string;
}

export interface VerifyInput {
  readonly blockHeight: number;
  readonly answerCommitHash: `0x${string}`;
}