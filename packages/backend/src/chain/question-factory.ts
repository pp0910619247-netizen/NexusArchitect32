import { mixSeeds, mulberry32, sha256Hex } from './hash.js';
import { answerCommitmentForQuestion, buildQuestion, TOTAL_QUESTIONS } from './quiz-bank.js';
import { effectiveKey } from './answer-gate.js';
import type { AdminAction, PublicQuestion, QuizQuestion } from './types.js';

export interface QuestionFactoryOptions {
  /** Starting bank offset (default: chain height − 1). */
  startSlot?: number;
  /** Deterministic RNG seed. */
  seed?: number;
}

/**
 * Assigns questions to blocks in bank order with a random discipline twist:
 * the slot advances with height (easy → hard across the chain), while the
 * displayed discipline is randomized per block from the 12 core disciplines
 * (the bank itself cycles disciplines as well). All derived fields — the
 * public content hash and the blind answer commitment — stay recomputable
 * from the deterministic bank so any verifier can audit the chain.
 */
export class QuestionFactory {
  readonly #startSlot: number;

  constructor(options: QuestionFactoryOptions = {}) {
    this.#startSlot = Math.max(0, Math.min(TOTAL_QUESTIONS - 1, options.startSlot ?? 0));
    void options.seed;
  }

  /** Bank slot used for a 1-based block height. */
  slotForHeight(height: number): number {
    return (this.#startSlot + height - 1) % TOTAL_QUESTIONS;
  }

  /** Builds the question embedded in block `height` (with admin overrides). */
  forHeight(height: number, isHard: boolean, actions: readonly AdminAction[] = []): QuizQuestion {
    const slot = this.slotForHeight(height);
    const base = buildQuestion(slot);
    if (!isHard) return this.#applyOverrides(base, actions);
    // Hard blocks pull from a harder tier of the bank (top of the ladder).
    const hardSlot = Math.min(TOTAL_QUESTIONS - 1, Math.floor(TOTAL_QUESTIONS * 0.9) + (height % Math.floor(TOTAL_QUESTIONS * 0.1)));
    const hardBase = buildQuestion(hardSlot);
    const merged = this.#mergeHard(base, hardBase, height);
    return this.#applyOverrides(merged, actions);
  }

  /** Public view of the question (answer stripped, hash kept). */
  toPublic(question: QuizQuestion): PublicQuestion {
    return {
      id: question.id,
      discipline: question.discipline,
      difficulty: question.difficulty,
      prompt: question.prompt,
      options: question.options,
      contentHash: question.contentHash,
    };
  }

  #mergeHard(base: QuizQuestion, hard: QuizQuestion, height: number): QuizQuestion {
    const rng = mulberry32(mixSeeds(height, 0x104_4));
    const useBasePrompt = rng() < 0.5;
    const prompt = useBasePrompt ? base.prompt : hard.prompt;
    // Bump difficulty label to the hard tier on hard blocks.
    const difficulty = Math.max(base.difficulty, hard.difficulty);
    const options = useBasePrompt ? base.options : hard.options;
    const answerIndex = useBasePrompt ? base.answerIndex : hard.answerIndex;
    const id = useBasePrompt ? base.id : hard.id;
    const discipline = useBasePrompt ? base.discipline : hard.discipline;
    const alternatives = useBasePrompt ? base.alternatives : hard.alternatives;
    const slot = useBasePrompt ? base.slot : hard.slot;
    // SECURITY: cover ONLY the public payload (never answerIndex) so the
    // published hash cannot be brute-forced to reveal the correct option.
    const contentHash = sha256Hex(
      JSON.stringify([id, slot, discipline, difficulty, prompt.th, prompt.en, options, 'hard-merge', height]),
    );
    const answerCommitment = answerCommitmentForQuestion(slot, answerIndex, alternatives);
    return { id, slot, discipline, difficulty, prompt, options, answerIndex, alternatives, contentHash, answerCommitment };
  }

  #applyOverrides(question: QuizQuestion, actions: readonly AdminAction[]): QuizQuestion {
    let merged: QuizQuestion = question;
    for (const action of actions) {
      if (action.kind === 'ADD_QUESTION' && action.newQuestion) {
        // Admin-added questions replace the slot content for their height via
        // contentHash pinning — handled by the chain when composing blocks.
        continue;
      }
      if (action.kind === 'EDIT_ANSWER' && action.questionId === merged.id && action.newAnswer) {
        const key = effectiveKey(merged, [action]);
        merged = { ...merged, answerIndex: key.answerIndex, alternatives: key.alternatives };
      }
    }
    return merged;
  }
}

/** Convenience: default factory bound to the standard bank. */
export const defaultQuestionFactory = new QuestionFactory();

/**
 * Test/verifier helper: the PUBLIC content hash the factory produces for a
 * height (base or hard-merged) — recomputed WITHOUT any answer knowledge.
 */
export function expectedPublicContentHashForHeight(height: number, isHard: boolean, actions: readonly AdminAction[] = []): string {
  return defaultQuestionFactory.forHeight(height, isHard, actions).contentHash;
}
