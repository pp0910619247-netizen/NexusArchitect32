import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { TtlCache } from './cache.js';
import type { ProblemBank } from './ProblemBank.js';
import type { PublicProblemResponse } from './types.js';

export interface ProblemApiOptions {
  readonly bank: ProblemBank;
  readonly currentHeight: () => number | Promise<number>;
  readonly isRevealed: (height: number) => boolean | Promise<boolean>;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}
export async function buildProblemApi(options: ProblemApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const cache = new TtlCache<PublicProblemResponse>(options.cacheTtlMs ?? 60_000, options.now);
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });
  async function response(height: number, allowAnswer: boolean): Promise<PublicProblemResponse | undefined> {
    const key = `${height}:${allowAnswer}`;
    const cached = cache.get(key); if (cached) return cached;
    const problem = await options.bank.getPublic(height); if (!problem) return undefined;
    const privateData = allowAnswer ? await options.bank.getPrivate(height) : undefined;
    const result: PublicProblemResponse = privateData ? { ...problem, revealed: true, answerPlain: privateData.answerPlain } : { ...problem, revealed: false };
    cache.set(key, result); return result;
  }
  app.get('/problems/current', async (_request, reply) => {
    const result = await response(await options.currentHeight(), false);
    return result ?? reply.code(404).send({ error: 'PROBLEM_NOT_FOUND' });
  });
  app.get<{ Params: { height: string } }>('/problems/:height', async (request, reply) => {
    const height = Number(request.params.height);
    if (!Number.isSafeInteger(height) || height < 1) return reply.code(400).send({ error: 'INVALID_BLOCK_HEIGHT' });
    const result = await response(height, await options.isRevealed(height));
    return result ?? reply.code(404).send({ error: 'PROBLEM_NOT_FOUND' });
  });
  app.post<{ Body: { blockHeight?: number; answerCommitHash?: string } }>('/verify', async (request, reply) => {
    const { blockHeight, answerCommitHash } = request.body ?? {};
    if (typeof blockHeight !== 'number' || !Number.isSafeInteger(blockHeight) || blockHeight < 1 || typeof answerCommitHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(answerCommitHash)) return reply.code(400).send({ error: 'INVALID_VERIFY_INPUT' });
    return { correct: await options.bank.verify(blockHeight, answerCommitHash as `0x${string}`) };
  });
  return app;
}