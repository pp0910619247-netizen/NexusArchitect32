import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hex } from 'viem';
import type { ProblemInput, PublicProblemFile } from './types.js';

/** Hash the canonical answer commitment: sha256(answerPlain + salt). */
export function commitAnswer(answerPlain: string, salt: string): Hex {
  if (answerPlain.length === 0 || salt.length === 0) {
    throw new Error('ANSWER_AND_SALT_REQUIRED');
  }
  return `0x${createHash('sha256').update(answerPlain + salt, 'utf8').digest('hex')}`;
}

export function assertValidProblem(input: ProblemInput): void {
  if (!Number.isSafeInteger(input.blockHeight) || input.blockHeight < 1) throw new Error('INVALID_BLOCK_HEIGHT');
  if (!['DETERMINISTIC', 'OPEN_ENDED'].includes(input.type)) throw new Error('INVALID_PROBLEM_TYPE');
  if (input.disciplines.length < 2 || input.disciplines.length > 4) throw new Error('INVALID_DISCIPLINES');
  if (input.disciplines.some((item) => item.trim().length === 0)) throw new Error('INVALID_DISCIPLINES');
  if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 10) throw new Error('INVALID_DIFFICULTY');
  if (input.statement.en.trim().length === 0 || input.statement.th.trim().length === 0) throw new Error('INVALID_STATEMENT');
}

export function toPublicProblem(input: ProblemInput): PublicProblemFile {
  assertValidProblem(input);
  return {
    blockHeight: input.blockHeight,
    type: input.type,
    disciplines: [...input.disciplines],
    difficulty: input.difficulty,
    statement: { ...input.statement },
    answerCommitHash: commitAnswer(input.answerPlain, input.salt),
  };
}

export function answerHashMatches(expected: Hex, supplied: Hex): boolean {
  const pattern = /^0x[0-9a-fA-F]{64}$/;
  if (!pattern.test(expected) || !pattern.test(supplied)) return false;
  const expectedBytes = Buffer.from(expected.slice(2), 'hex');
  const suppliedBytes = Buffer.from(supplied.slice(2), 'hex');
  return timingSafeEqual(expectedBytes, suppliedBytes);
}