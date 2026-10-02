import { describe, expect, it } from 'vitest';
import { pickWinner } from '../src/chain/winner.js';
import type { ChainAnswer } from '../src/chain/types.js';

/** Answer fixture with sensible defaults for the fields under test. */
function answer(overrides: Partial<ChainAnswer> & { answeredAt: number }): ChainAnswer {
  return {
    questionId: 'w2-000001',
    blockHeight: 7,
    miner: `0xminer${overrides.answeredAt}`,
    choice: 0,
    correct: false,
    commitmentHash: '0xcommit',
    ...overrides,
  };
}

describe('pickWinner (40% fastest-correct winner)', () => {
  it('picks the fastest correct answer of the block (happy path)', () => {
    const winner = pickWinner([
      answer({ miner: '0xslow', correct: true, answeredAt: 2_000 }),
      answer({ miner: '0xfast', correct: true, answeredAt: 1_500 }),
      answer({ miner: '0xwrong', correct: false, answeredAt: 1_000 }),
    ]);
    expect(winner?.miner).toBe('0xfast');
    expect(winner?.answeredAt).toBe(1_500);
  });

  it('returns null when nobody answered correctly (edge)', () => {
    expect(
      pickWinner([
        answer({ correct: false, answeredAt: 1_000 }),
        answer({ correct: false, answeredAt: 2_000 }),
      ]),
    ).toBeNull();
    expect(pickWinner([])).toBeNull();
  });

  it('breaks an exact answeredAt tie by submission order (edge)', () => {
    const winner = pickWinner([
      answer({ miner: '0xfirst', correct: true, answeredAt: 3_000 }),
      answer({ miner: '0xsecond', correct: true, answeredAt: 3_000 }),
    ]);
    expect(winner?.miner).toBe('0xfirst');
  });

  it('never lets a fast wrong answer win (edge)', () => {
    const winner = pickWinner([
      answer({ miner: '0xwrong', correct: false, answeredAt: 1 }),
      answer({ miner: '0xright', correct: true, answeredAt: 9_999 }),
    ]);
    expect(winner?.miner).toBe('0xright');
  });
});
