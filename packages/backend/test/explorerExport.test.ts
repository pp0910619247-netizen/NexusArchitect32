import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportExplorerSnapshot, latestAnswers, summarizeChain } from '../src/chain/export-explorer.js';
import type { ChainAnswer, QuizBlock } from '../src/chain/types.js';

/** Minimal sealed block fixture — only the fields the exporter reads. */
function block(overrides: {
  height: number;
  timestamp: number;
  attempts: number;
  answers?: readonly Partial<ChainAnswer>[];
  milestone?: boolean;
}): QuizBlock {
  const answers: ChainAnswer[] = (overrides.answers ?? []).map((answer, index) => ({
    questionId: 'w2-000001',
    blockHeight: overrides.height,
    miner: answer.miner ?? `0xminer${overrides.height}`,
    choice: answer.choice ?? 0,
    correct: answer.correct ?? false,
    answeredAt: answer.answeredAt ?? overrides.timestamp + index,
    commitmentHash: answer.commitmentHash ?? `0xcommit${overrides.height}${index}`,
  }));
  return {
    height: overrides.height,
    parentHash: '0x'.padEnd(66, '0'),
    hash: `0xhash${overrides.height}`,
    timestamp: overrides.timestamp,
    difficultyBits: 12,
    nonce: 1,
    miner: '0xminer',
    attempts: overrides.attempts,
    miningMs: 10,
    isHard: false,
    isMilestone: Boolean(overrides.milestone),
    question: {
      id: 'w2-000001',
      slot: 1,
      discipline: 'chemistry',
      difficulty: 1,
      prompt: { th: 'โจทย์', en: 'prompt' },
      options: ['a', 'b', 'c', 'd'],
      alternatives: [],
      contentHash: '0xcontent',
    },
    answers,
    adminActions: [],
    answerCommitment: '0xcommit',
    revealedAnswerIndex: 0,
    milestone: overrides.milestone
      ? {
          blockHeight: overrides.height,
          milestoneHash: '0xms',
          spanFromBlockHash: '0xfrom',
          spanToBlockHash: '0xto',
          spanBlocks: 1000,
          totalCumulativeWork: '1',
          at: overrides.timestamp,
        }
      : null,
  } as QuizBlock;
}

describe('explorer snapshot export', () => {
  it('summarizes the chain for the stat bar', () => {
    const status = summarizeChain([
      block({ height: 1, timestamp: 1_000, attempts: 10, milestone: true, answers: [{ correct: true }, { correct: false }] }),
      block({ height: 2, timestamp: 3_000, attempts: 30, answers: [{ correct: true }] }),
      block({ height: 3, timestamp: 5_000, attempts: 20 }),
    ]);
    expect(status.height).toBe(3);
    expect(status.totalBlocks).toBe(3);
    expect(status.totalAttempts).toBe(60);
    expect(status.totalAnswers).toBe(3);
    expect(status.correctAnswers).toBe(2);
    expect(status.avgAttemptsPerBlock).toBe(20);
    expect(status.avgBlockIntervalMs).toBe(2_000);
    expect(status.difficultyBits).toBe(12);
    expect(status.lastMilestoneHeight).toBe(1);
    expect(status.lastBlockAt).toBe(5_000);
  });

  it('returns neutral aggregates for an empty chain and keeps the limit respected', () => {
    const status = summarizeChain([]);
    expect(status).toEqual({
      height: 0,
      totalBlocks: 0,
      totalAttempts: 0,
      totalAnswers: 0,
      correctAnswers: 0,
      avgAttemptsPerBlock: 0,
      avgBlockIntervalMs: null,
      difficultyBits: 0,
      lastMilestoneHeight: null,
      lastBlockAt: null,
    });
    expect(latestAnswers([], 5)).toEqual([]);

    const one = summarizeChain([block({ height: 1, timestamp: 1_000, attempts: 5 })]);
    expect(one.avgBlockIntervalMs).toBeNull(); // a single block has no interval
  });

  it('lists newest answers first and honours the limit', () => {
    const chain = [
      block({ height: 1, timestamp: 1_000, attempts: 1, answers: [{ correct: false }, { correct: true }] }),
      block({ height: 2, timestamp: 2_000, attempts: 1, answers: [{ correct: true }] }),
    ];
    const rows = latestAnswers(chain, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ height: 2, commitmentHash: '0xcommit20' });
    expect(rows[1]).toMatchObject({ height: 1, commitmentHash: '0xcommit11' });
    expect(latestAnswers(chain, 3)).toHaveLength(3);
  });

  it('writes a snapshot that carries status and recentAnswers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nexus-export-'));
    const chain = [
      block({ height: 1, timestamp: 1_000, attempts: 4, answers: [{ correct: true }] }),
      block({ height: 2, timestamp: 2_000, attempts: 6 }),
    ];
    await writeFile(
      path.join(dir, 'blocks.jsonl'),
      `${chain.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      'utf8',
    );
    const result = await exportExplorerSnapshot({ chainDataDir: dir, outFile: path.join(dir, 'out.json') });
    expect(result.blocks).toBe(2);

    const written = JSON.parse(await readFile(path.join(dir, 'out.json'), 'utf8')) as {
      latestBlockHeight: number;
      quizBlocks: unknown[];
      status: { totalAnswers: number; totalAttempts: number; height: number };
      recentAnswers: { height: number }[];
    };
    expect(written.latestBlockHeight).toBe(2);
    expect(written.quizBlocks).toHaveLength(2);
    expect(written.status).toMatchObject({ height: 2, totalAttempts: 10, totalAnswers: 1 });
    expect(written.recentAnswers).toEqual([
      expect.objectContaining({ height: 1, miner: '0xminer1', correct: true }),
    ]);
  });

  it("seals the block's fastest correct answer as the 40% winner", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nexus-export-winner-'));
    const chain = [
      block({
        height: 1,
        timestamp: 1_000,
        attempts: 3,
        answers: [
          { miner: '0xslow', correct: true, answeredAt: 1_900 },
          { miner: '0xwrong', correct: false, answeredAt: 1_100 },
          { miner: '0xfast', correct: true, answeredAt: 1_500 },
        ],
      }),
      block({ height: 2, timestamp: 2_000, attempts: 3, answers: [{ miner: '0xwrong', correct: false }] }),
    ];
    await writeFile(
      path.join(dir, 'blocks.jsonl'),
      `${chain.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      'utf8',
    );
    await exportExplorerSnapshot({ chainDataDir: dir, outFile: path.join(dir, 'out.json') });
    const written = JSON.parse(await readFile(path.join(dir, 'out.json'), 'utf8')) as {
      quizBlocks: { height: number; winnerMiner: string | null; winnerAnsweredAt: number | null }[];
    };
    expect(written.quizBlocks[0]).toMatchObject({ height: 1, winnerMiner: '0xfast', winnerAnsweredAt: 1_500 });
    // Edge: a block where nobody answered correctly has no winner at all.
    expect(written.quizBlocks[1]).toMatchObject({ height: 2, winnerMiner: null, winnerAnsweredAt: null });
  });
});
