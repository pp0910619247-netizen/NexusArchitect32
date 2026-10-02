import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProblemApi } from '../src/problem-bank/app.js';
import { ProblemBank } from '../src/problem-bank/ProblemBank.js';
import { commitAnswer } from '../src/problem-bank/commitment.js';
import type { ProblemInput } from '../src/problem-bank/types.js';

const roots: string[] = [];
async function fixture(): Promise<{ bank: ProblemBank; input: ProblemInput; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexus-problem-bank-'));
  roots.push(root);
  const input: ProblemInput = { blockHeight: 7, type: 'DETERMINISTIC', disciplines: ['Physics', 'Mathematics'], difficulty: 3, statement: { en: 'Statement', th: 'คำถาม' }, answerPlain: 'correct answer', salt: 'unique-salt' };
  const bank = new ProblemBank({ rootDir: root });
  await bank.save(input);
  return { bank, input, root };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); vi.restoreAllMocks(); });

describe('answer commitment', () => {
  it('always equals sha256(answerPlain + salt)', async () => {
    const { bank, input } = await fixture();
    const publicData = await bank.getPublic(7);
    const privateData = await bank.getPrivate(7);
    expect(publicData?.answerCommitHash).toBe(commitAnswer(input.answerPlain, input.salt));
    expect(privateData?.answerCommitHash).toBe(commitAnswer(input.answerPlain, input.salt));
    expect(await readFile(path.join((await fixture()).root, 'problems/7.yaml'), 'utf8')).not.toContain('correct answer');
  });
  it('keeps answerPlain and salt outside the public file', async () => {
    const { bank, root } = await fixture();
    const content = await readFile(path.join(root, 'problems/7.yaml'), 'utf8');
    expect(content).not.toContain('answerPlain'); expect(content).not.toContain('salt'); expect(content).not.toContain('correct answer');
    expect(await bank.getPrivate(7)).toMatchObject({ answerPlain: 'correct answer', salt: 'unique-salt' });
  });
});

describe('Problem Bank API', () => {
  it('returns bilingual current problem without answer and caches reads', async () => {
    const { bank } = await fixture(); const getPublic = vi.spyOn(bank, 'getPublic');
    const app = await buildProblemApi({ bank, currentHeight: () => 7, isRevealed: () => true, now: () => 0 });
    const first = await app.inject({ method: 'GET', url: '/problems/current' }); const second = await app.inject({ method: 'GET', url: '/problems/current' });
    expect(first.statusCode).toBe(200); expect(first.json().statement).toEqual({ en: 'Statement', th: 'คำถาม' }); expect(first.json()).not.toHaveProperty('answerPlain'); expect(getPublic).toHaveBeenCalledTimes(1); expect(second.json()).toEqual(first.json()); await app.close();
  });
  it('reveals an answer only after reveal is confirmed', async () => {
    const { bank } = await fixture();
    const app = await buildProblemApi({ bank, currentHeight: () => 7, isRevealed: (height) => height < 7 });
    expect((await app.inject({ url: '/problems/7' })).json()).not.toHaveProperty('answerPlain');
    const revealed = await buildProblemApi({ bank, currentHeight: () => 7, isRevealed: () => true });
    expect((await revealed.inject({ url: '/problems/7' })).json().answerPlain).toBe('correct answer'); await app.close(); await revealed.close();
  });
  it('verifies hashes and handles invalid/missing input', async () => {
    const { bank, input } = await fixture(); const app = await buildProblemApi({ bank, currentHeight: () => 7, isRevealed: () => false });
    const response = await app.inject({ method: 'POST', url: '/verify', payload: { blockHeight: 7, answerCommitHash: commitAnswer(input.answerPlain, input.salt) } });
    expect(response.json()).toEqual({ correct: true });
    const wrong = await app.inject({ method: 'POST', url: '/verify', payload: { blockHeight: 7, answerCommitHash: `0x${'0'.repeat(64)}` } });
    expect(wrong.json()).toEqual({ correct: false });
    expect((await app.inject({ method: 'POST', url: '/verify', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ url: '/problems/999' })).statusCode).toBe(404); await app.close();
  });
  it('enforces 60 requests per minute per IP', async () => {
    const { bank } = await fixture(); const app = await buildProblemApi({ bank, currentHeight: () => 7, isRevealed: () => false });
    for (let index = 0; index < 60; index += 1) expect((await app.inject({ url: '/problems/7', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/problems/7', remoteAddress: '127.0.0.1' })).statusCode).toBe(429);
    expect((await app.inject({ url: '/problems/7', remoteAddress: '127.0.0.2' })).statusCode).toBe(200); await app.close();
  });
});

describe('offline CLI input', () => {
  it('writes private mode-0600 material and emits calldata through the same service', async () => {
    const { bank, root, input } = await fixture(); const result = await bank.save({ ...input, blockHeight: 8 });
    expect(result.calldata.startsWith('0x')).toBe(true); expect(result.calldata.length).toBe(138);
    const secretPath = path.join(root, 'private/problems/8.yaml');
    expect(await readFile(secretPath, 'utf8')).toContain('correct answer');
    await writeFile(secretPath, await readFile(secretPath, 'utf8'));
  });
});