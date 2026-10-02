import type { TranslationKey } from '@nexus/shared';

/** Why the last submission failed. */
export type AnswerErrorKind = 'rejected' | 'network' | 'error';

export interface FeedbackInput {
  readonly answerStatus: 'none' | 'submitting' | 'submitted' | 'failed';
  readonly answerError: AnswerErrorKind | null;
}

/**
 * Picks the user-facing feedback translation key for the Mining screen.
 * Returns `null` when there is nothing to say (idle answer status).
 *
 * Deliberately carries NO correctness: the node never answers "right/wrong"
 * while the block is open (an instant oracle would let a miner submit all four
 * choices and learn the key). An accepted answer reads as "pending" until the
 * block seals; the sealed block then publishes the result publicly.
 */
export function resolveFeedbackKey(input: FeedbackInput): TranslationKey | null {
  const { answerStatus, answerError } = input;
  if (answerStatus === 'submitting') return 'mining.status.submitting';
  if (answerStatus === 'submitted') return 'mining.answerPending';
  if (answerStatus === 'failed' && answerError === 'rejected') return 'mining.answerRejected';
  if (answerStatus === 'failed' && answerError === 'network') return 'mining.answerNetwork';
  if (answerStatus === 'failed') return 'error.generic';
  return null;
}
