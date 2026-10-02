// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ExplorerIndexer } from '../src/ExplorerIndexer.js';
import { EMPTY_EVENT_SNAPSHOT, FileEventAdapter } from '../src/FileEventAdapter.js';
import type { QuizExplorerBlock } from '../src/types.js';

describe('indexer explorer data', () => {
  it('returns safe empty data when problem bank is absent', async () => {
    const service = new ExplorerIndexer({
      problemBankRoot: 'missing-test-root',
      events: new FileEventAdapter(async () => EMPTY_EVENT_SNAPSHOT),
    });
    await expect(service.snapshot()).resolves.toMatchObject({
      problems: [],
      blocks: [],
      proposals: [],
      stats: { latestBlockHeight: 0, totalMiners: 0, impactTreasuryWei: 0n },
    });
  });

  it('exposes quiz-chain blocks from the bridge snapshot (commit-reveal)', async () => {
    const quizBlock: QuizExplorerBlock = { height: 1, blockHash: `0x${'b'.repeat(64)}`, parentHash: `0x${'0'.repeat(64)}`, timestamp: 1759100000000, difficultyBits: 12, isHard: false, isMilestone: false, attempts: 100, miner: 'local-miner', questionId: 'q-000001', disciplineId: 'math', disciplineTh: 'คณิตศาสตร์', disciplineEn: 'Mathematics', promptTh: '1+1=?', promptEn: '1+1=?', options: ['1', '2', '3', '4'], contentHash: `0x${'c'.repeat(64)}`, revealedAnswerIndex: 1, revealedAnswerText: '2', answerCommitment: `0x${'d'.repeat(64)}`, totalAnswers: 3, correctAnswers: 2 };
    const service = new ExplorerIndexer({
      problemBankRoot: 'missing-test-root',
      events: new FileEventAdapter(async () => ({ ...EMPTY_EVENT_SNAPSHOT, quizBlocks: [quizBlock] })),
    });
    await expect(service.getQuizBlock(1)).resolves.toEqual(quizBlock);
    await expect(service.getQuizBlock(2)).resolves.toBeUndefined();
    await expect(service.latestQuizBlocks(10)).resolves.toEqual([quizBlock]);
    await expect(service.snapshot().then((s) => s.quizBlocks)).resolves.toEqual([quizBlock]);
  });

  it('searches block, address, and transaction identifiers', async () => {
    const service = new ExplorerIndexer({
      problemBankRoot: 'missing-test-root',
      events: new FileEventAdapter(async () => ({ ...EMPTY_EVENT_SNAPSHOT, blocks: { '7': {
        timestamp: 0n,
        winner: null,
        winnerAmountWei: 0n,
        impactAmountWei: 0n,
        txHash: `0x${'a'.repeat(64)}`,
        miners: [],
        revealed: false,
        answerHash: null,
      } } })),
    });
    await expect(service.search('7')).resolves.toEqual({ kind: 'block', height: 7 });
    await expect(service.search(`0x${'1'.repeat(40)}`)).resolves.toEqual({ kind: 'address', address: `0x${'1'.repeat(40)}` });
    await expect(service.search(`0x${'a'.repeat(64)}`)).resolves.toEqual({ kind: 'transaction', hash: `0x${'a'.repeat(64)}` });
  });
});
