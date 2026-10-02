import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AdminConsole } from './admin.js';
import type { QuizChain } from './quiz-chain.js';
import { getDiscipline } from './disciplines.js';
import type { PublicQuestion } from './types.js';
import { pickWinner } from './winner.js';

export interface ChainApiOptions {
  readonly chain: QuizChain;
  readonly admin: AdminConsole;
  /** Exposed so the current-question endpoint can serialize answers. */
  readonly questionFactory: { toPublic(question: unknown): PublicQuestion };
  /**
   * Seals the open block durably and opens the next one (same sequence as
   * the scheduler tick). Used by the admin dev-control endpoint and tests.
   */
  readonly sealAndAdvance: () => Promise<{ sealedHeight: number; nextHeight: number }>;
  /** Cumulative work string, exposed on the peer status endpoint. */
  readonly totalCumulativeWork?: () => string;
}

/** Formats a question for the Thai-first UI. */
export function formatQuestionTh(question: PublicQuestion): Record<string, unknown> {
  const discipline = safeDiscipline(question.discipline);
  return {
    id: question.id,
    disciplineId: question.discipline,
    disciplineTh: discipline.th,
    disciplineEn: discipline.en,
    difficulty: question.difficulty,
    promptTh: question.prompt.th,
    promptEn: question.prompt.en,
    options: question.options,
    contentHash: question.contentHash,
  };
}
function safeDiscipline(id: string): { th: string; en: string } {
  try {
    return getDiscipline(id);
  } catch {
    return { th: id, en: id };
  }
}

/** Builds the HTTP API for the quiz chain (Thai-first responses). */
export async function buildChainApi(options: ChainApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { chain, admin } = options;

  app.get('/api/status', async () => {
    const stats = chain.stats;
    const last = chain.blocks.at(-1) ?? null;
    return {
      height: stats.height,
      totalBlocks: stats.totalBlocks,
      totalAttempts: stats.totalAttempts,
      totalMiningMs: stats.totalMiningMs,
      totalAnswers: stats.totalAnswerCount,
      correctAnswers: stats.correctAnswerCount,
      avgAttemptsPerBlock: stats.avgAttemptsPerBlock,
      avgBlockIntervalMs: stats.avgBlockIntervalMs,
      lastMilestoneHeight: chain.lastMilestoneHeight,
      openHeight: chain.openHeight,
      lastBlock: last
        ? {
            height: last.height,
            hash: last.hash,
            parentHash: last.parentHash,
            timestamp: last.timestamp,
            difficultyBits: last.difficultyBits,
            isHard: last.isHard,
            isMilestone: last.isMilestone,
            questionId: last.question.id,
            attempts: last.attempts,
          }
        : null,
    };
  });

  app.get('/api/blocks', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));
    const blocks = chain.blocks.slice(offset, offset + limit).map((block) => ({
      height: block.height,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      difficultyBits: block.difficultyBits,
      nonce: block.nonce,
      miner: block.miner,
      attempts: block.attempts,
      miningMs: block.miningMs,
      isHard: block.isHard,
      isMilestone: block.isMilestone,
      question: formatQuestionTh(block.question),
      /** Commit-reveal: the public answer of a SEALED block (never present while mining). */
      revealedAnswerIndex: block.revealedAnswerIndex,
      answerCount: block.answers.length,
      correctCount: block.answers.filter((a) => a.correct).length,
      adminActionCount: block.adminActions.length,
      milestone: block.milestone,
    }));
    return { blocks, total: chain.blocks.length };
  });

  app.get('/api/blocks/:height', async (request, reply) => {
    const params = request.params as { height: string };
    const height = Number(params.height);
    if (!Number.isSafeInteger(height) || height < 1) {
      return reply.code(400).send({ error: 'INVALID_BLOCK_HEIGHT' });
    }
    const block = chain.blocks.find((b) => b.height === height);
    if (!block)      return reply.code(404).send({ error: 'BLOCK_NOT_FOUND' });
    // Winner = the fastest correct answer of the block (40% of the post-treasury
    // reward). Derived here instead of stored so every reader agrees with
    // `pickWinner` in the explorer bridge.
    const winner = pickWinner(block.answers);
    return reply.send({
      ...block,
      question: formatQuestionTh(block.question),
      revealedAnswerIndex: block.revealedAnswerIndex,
      winnerMiner: winner?.miner ?? null,
      winnerAnsweredAt: winner?.answeredAt ?? null,
      answers: block.answers.map((a) => ({
        miner: a.miner,
        choice: a.choice,
        correct: a.correct,
        answeredAt: a.answeredAt,
        commitmentHash: a.commitmentHash,
      })),
    });
  });

  app.get('/api/question/current', async (_request, reply) => {
    const question = chain.openQuestion;
    if (!question) {
      return reply.code(404).send({
        error: 'NO_OPEN_BLOCK',
        messageTh: 'ขณะนี้ไม่มีบล็อกที่กำลังขุด — รอบล็อกถัดไปจะเริ่มเมื่อบล็อกก่อนหน้าถูกปิดแล้ว',
      });
    }
    return { blockHeight: chain.openHeight, question: formatQuestionTh(options.questionFactory.toPublic(question)) };
  });

  app.post('/api/answer', async (request, reply) => {
    const body = request.body as { blockHeight?: number; miner?: string; choice?: number } | null;
    if (!body || typeof body.blockHeight !== 'number' || typeof body.choice !== 'number' || typeof body.miner !== 'string' || body.miner.trim().length === 0) {
      return reply.code(400).send({ error: 'INVALID_ANSWER_INPUT' });
    }
    try {
      // Oracle-free response: the node records the answer but NEVER says
      // whether it is right while the block is still open — otherwise a miner
      // could submit all four choices and learn the key before the reveal
      // (the owner's rule: the AI must reason to the answer, not to a letter).
      // Correctness becomes public only with the sealed block (`GET /api/blocks/:height`).
      const answer = chain.submitAnswer({ blockHeight: body.blockHeight, miner: body.miner, choice: body.choice });
      return {
        ok: true,
        accepted: true,
        messageTh: 'บันทึกคำตอบแล้ว — ผลจะเปิดเผยเมื่อบล็อกนี้ปิดผนึก',
        commitmentHash: answer.commitmentHash,
      };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'ANSWER_REJECTED' });
    }
  });

  app.post('/api/admin/login', async (request, reply) => {
    const body = request.body as { username?: string; password?: string } | null;
    if (!body?.username || !body?.password) return reply.code(400).send({ error: 'MISSING_CREDENTIALS' });
    try {
      const session = await admin.login(body.username, body.password);
      return { token: session.token, expiresAt: session.expiresAt };
    } catch {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', messageTh: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  });

  app.post('/api/admin/answers/edit', async (request, reply) => {
    const body = request.body as { token?: string; questionId?: string; answerIndex?: number; alternatives?: number[] } | null;
    if (!body?.token || !body?.questionId || typeof body.answerIndex !== 'number') {
      return reply.code(400).send({ error: 'INVALID_EDIT_INPUT' });
    }
    try {
      const action = await admin.editAnswer(body.token, body.questionId, body.answerIndex, body.alternatives ?? []);
      chain.queueAdminAction(action);
      return { ok: true, actionId: action.id, actionHash: action.actionHash, messageTh: 'บันทึกคำตอบใหม่เรียบร้อย — จะถูกฝังในบล็อกถัดไป' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'EDIT_FAILED';
      const status = message === 'UNAUTHORIZED' ? 401 : 400;
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/api/admin/questions/add', async (request, reply) => {
    const body = request.body as { token?: string; question?: { discipline?: string; difficulty?: number; prompt?: { th?: string; en?: string }; options?: string[]; answerIndex?: number; alternatives?: number[] } } | null;
    if (!body?.token || !body?.question) return reply.code(400).send({ error: 'INVALID_ADD_INPUT' });
    const q = body.question;
    if (!q.prompt?.th || !q.prompt?.en || !q.options || q.options.length !== 4 || typeof q.answerIndex !== 'number') {
      return reply.code(400).send({ error: 'INVALID_QUESTION_PAYLOAD' });
    }
    try {
      const action = await admin.addQuestion(body.token, {
        discipline: q.discipline ?? 'math',
        difficulty: Math.min(10, Math.max(1, q.difficulty ?? 5)),
        prompt: { th: q.prompt.th, en: q.prompt.en },
        options: [q.options[0]!, q.options[1]!, q.options[2]!, q.options[3]!] as [string, string, string, string],
        answerIndex: q.answerIndex,
        alternatives: q.alternatives ?? [],
      });
      chain.queueAdminAction(action);
      return { ok: true, actionId: action.id, questionId: action.questionId, messageTh: 'เพิ่มคำถามใหม่แล้ว — จะถูกฝังในบล็อกถัดไป' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ADD_FAILED';
      const status = message === 'UNAUTHORIZED' ? 401 : 400;
      return reply.code(status).send({ error: message });
    }
  });

  app.get('/api/verify', async (request, reply) => {
    const result = chain.verifyChain();
    if (!result.valid) return reply.code(500).send({ valid: false, errors: result.errors });
    return { valid: true, errors: [], height: chain.height };
  });

  /** Peer protocol (read-only): height + cumulative work for fork choice. */
  app.get('/api/peer/status', async () => {
    return {
      height: chain.height,
      totalCumulativeWork: options.totalCumulativeWork ? options.totalCumulativeWork() : chain.snapshot().totalCumulativeWork,
      protocol: 1,
    };
  });

  /** Peer protocol (read-only): paged sealed blocks for initial sync. */
  app.get('/api/peer/blocks', async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(1_000, Math.max(1, Number(query.limit ?? 500)));
    const offset = Math.max(0, Number(query.offset ?? 0));
    return {
      blocks: chain.blocks.slice(offset, offset + limit),
      total: chain.blocks.length,
    };
  });

  /** Dev-control: close the open block now (same flow as the scheduler). */
  app.post('/api/admin/mine', async (request, reply) => {
    const body = request.body as { token?: string } | null;
    try {
      admin.requireSession(body?.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNAUTHORIZED';
      return reply.code(message === 'UNAUTHORIZED' ? 401 : 400).send({ error: message });
    }
    try {
      const result = await options.sealAndAdvance();
      return { ok: true, ...result, messageTh: `ปิดบล็อก #${result.sealedHeight} แล้ว — บล็อก #${result.nextHeight} เริ่มแล้ว` };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'MINE_FAILED' });
    }
  });

  return app;
}
