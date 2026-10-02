/**
 * Winner selection for one sealed quiz-chain block.
 *
 * The owner's reward order (see AGENTS.md §4) pays the single
 * "fastest / most accurate" correct answerer 40% of the post-treasury share
 * before the remaining 60% is split between every correct co-miner of that
 * block. This module is the one place that decides WHO that single winner is,
 * so the node API, the explorer bridge and the tests can never disagree.
 */
import type { ChainAnswer } from './types.js';

/**
 * The fastest correct answer inside a block. Ties on `answeredAt` are broken
 * by submission order (the earliest recorded answer wins), so the result is
 * fully deterministic across replays of the same block.
 *
 * @param answers - Answers recorded in the block, in submission order.
 * @returns The winning answer, or `null` when nobody answered correctly.
 */
export function pickWinner(answers: readonly ChainAnswer[]): ChainAnswer | null {
  let winner: ChainAnswer | null = null;
  for (const answer of answers) {
    if (!answer.correct) continue;
    if (winner === null || answer.answeredAt < winner.answeredAt) winner = answer;
  }
  return winner;
}
