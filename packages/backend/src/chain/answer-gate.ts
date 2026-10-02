import { canonicalJson, sha256Hex } from './hash.js';
import type { AdminAction, ChainAnswerKey, QuizQuestion } from './types.js';

/**
 * Builds the canonical answer commitment for a choice:
 * sha256(answerIndex:questionId:blockHeight:miner:secret)
 */
export function commitAnswerChoice(answerIndex: number, questionId: string, blockHeight: number, miner: string, secret: string): string {
  return sha256Hex(canonicalJson({ answerIndex, questionId, blockHeight, miner, secret }));
}

/** Effective key for a question considering admin-added alternative answers. */
export function effectiveKey(question: QuizQuestion, actions: readonly AdminAction[]): ChainAnswerKey {
  let answerIndex = question.answerIndex;
  let alternatives = [...question.alternatives];
  for (const action of actions) {
    if (action.kind !== 'EDIT_ANSWER' || action.questionId !== question.id) continue;
    if (action.newAnswer) {
      answerIndex = action.newAnswer.answerIndex;
      alternatives = [...action.newAnswer.alternatives];
    }
  }
  return { answerIndex, alternatives };
}

export function isChoiceCorrect(question: QuizQuestion, actions: readonly AdminAction[], choice: number): boolean {
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return false;
  const key = effectiveKey(question, actions);
  if (choice === key.answerIndex) return true;
  return key.alternatives.includes(choice);
}
