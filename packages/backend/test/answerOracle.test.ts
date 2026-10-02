import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AdminConsole } from '../src/chain/admin.js';
import { QuestionFactory } from '../src/chain/question-factory.js';
import { buildChainApi } from '../src/chain/server.js';
import { QuizChain } from '../src/chain/quiz-chain.js';

/**
 * The node must not be a correctness oracle while a block is open: an instant
 * "correct/incorrect" answer would let a miner submit all four choices, learn
 * the key and get everything right before the reveal — defeating the owner's
 * rule that the AI has to reason its way to the answer.
 *
 * Result visibility is therefore: accepted (silent) while open → published
 * with the sealed block (`GET /api/blocks/:height`).
 */
describe('answer oracle closes until the block seals', () => {
  it('hides correctness in the POST response and in every public counter', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'answer-oracle-'));
    try {
      const admin = new AdminConsole({ password: 'pw', dataDir: dir });
      await admin.initialize();
      const chain = new QuizChain({ baseDifficultyBits: 6 });
      const questionFactory = new QuestionFactory();
      const app = await buildChainApi({
        chain,
        admin,
        questionFactory,
        sealAndAdvance: async () => {
          const sealed = chain.sealCurrentBlock();
          chain.startNextBlock('test');
          return { sealedHeight: sealed.height, nextHeight: chain.openHeight };
        },
      });
      await app.ready();

      try {
        chain.startNextBlock('genesis');
        const height = chain.openHeight;
        const correctChoice = chain.openQuestion?.answerIndex ?? 0;
        const wrongChoice = (correctChoice + 1) % 4;

        const before = (await app.inject({ method: 'GET', url: '/api/status' })).json() as Record<string, number>;
        expect(before.totalAnswers).toBe(0);
        expect(before.correctAnswers).toBe(0);

        // Happy path: the RIGHT choice is accepted without any verdict.
        const right = await app.inject({
          method: 'POST',
          url: '/api/answer',
          payload: { blockHeight: height, miner: 'probe-right', choice: correctChoice },
        });
        expect(right.statusCode).toBe(200);
        const rightBody = right.json() as Record<string, unknown>;
        expect(rightBody.ok).toBe(true);
        expect(rightBody.accepted).toBe(true);
        expect('correct' in rightBody).toBe(false);
        expect(rightBody.correct).toBeUndefined();
        // The Thai message must not grade the answer either.
        expect(String(rightBody.messageTh)).toMatch(/บันทึกคำตอบแล้ว/);
        expect(String(rightBody.messageTh)).not.toMatch(/ถูก/);

        // Edge: a wrong choice gets the identical silent treatment.
        const wrong = await app.inject({
          method: 'POST',
          url: '/api/answer',
          payload: { blockHeight: height, miner: 'probe-wrong', choice: wrongChoice },
        });
        expect(wrong.statusCode).toBe(200);
        expect('correct' in (wrong.json() as Record<string, unknown>)).toBe(false);

        // The public counters must not move while the block is open — polling
        // `/api/status` (or the dashboard) has to leak nothing.
        const during = (await app.inject({ method: 'GET', url: '/api/status' })).json() as Record<string, number>;
        expect(during.totalAnswers).toBe(0);
        expect(during.correctAnswers).toBe(0);

        // Sealing publishes the result — grading happens with the block.
        const sealedBlock = chain.sealCurrentBlock();
        chain.startNextBlock('test');
        expect(sealedBlock.height).toBe(height);

        const after = (await app.inject({ method: 'GET', url: '/api/status' })).json() as Record<string, number>;
        expect(after.totalAnswers).toBe(2);
        expect(after.correctAnswers).toBe(1);

        // Post-seal the block endpoint is the public place results live.
        const block = (await app.inject({ method: 'GET', url: `/api/blocks/${height}` })).json() as {
          answers?: { miner: string; choice: number; correct: boolean }[];
        };
        const graded = block.answers ?? [];
        expect(graded.find((a) => a.miner === 'probe-right')).toMatchObject({ correct: true, choice: correctChoice });
        expect(graded.find((a) => a.miner === 'probe-wrong')).toMatchObject({ correct: false });
      } finally {
        await app.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
