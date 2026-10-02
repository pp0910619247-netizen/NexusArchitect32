import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadQuestions } from '../src/worldbank/ai-eval.js';
import { defaultOutDir } from '../src/worldbank/generate.js';
import { buildStats, drawQuizSample, isLoopback, registerQuizApp, uiDictionary } from '../src/worldbank/quiz-app.js';

const bankDir = defaultOutDir();
const hasBank = existsSync(bankDir);
const remote = '10.1.2.3';

async function buildApp(allowRemote = false) {
  const app = Fastify();
  registerQuizApp(app, { bankDir, allowRemote });
  await app.ready();
  return app;
}

describe('loopback guard', () => {
  it('accepts IPv4/IPv6 loopback and rejects everything else', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.5')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('refuses a remote caller on every quiz route', async () => {
    const app = await buildApp();
    const stats = await app.inject({ url: '/api/quiz/stats', remoteAddress: remote });
    expect(stats.statusCode).toBe(403);
    expect(stats.json().error).toBe('QUIZ_LOOPBACK_ONLY');
    const page = await app.inject({ url: '/quiz', remoteAddress: remote });
    expect(page.statusCode).toBe(403);
    const reveal = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: { id: 'wk-000001' }, remoteAddress: remote });
    expect(reveal.statusCode).toBe(403);
    await app.close();
  });

  it('serves a loopback caller', async () => {
    const app = await buildApp();
    const page = await app.inject({ url: '/quiz' });
    expect(page.statusCode).toBe(200);
    await app.close();
  });
});

describe('quiz page', () => {
  it('renders both languages from the shared dictionaries', async () => {
    const app = await buildApp();
    const th = await app.inject({ url: '/quiz?lang=th' });
    const en = await app.inject({ url: '/quiz?lang=en' });
    expect(th.body).toContain(uiDictionary('th')['quiz.title']);
    expect(en.body).toContain(uiDictionary('en')['quiz.title']);
    expect(th.body).toContain('/api/quiz/sample');
    expect(en.body).toContain('/api/quiz/reveal');
    await app.close();
  });
});

describe('reveal endpoint validation', () => {
  it('rejects a malformed id and reports unknown items', async () => {
    const app = await buildApp();
    const bad = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: { id: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('INVALID_ITEM_ID');
    const empty = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: {} });
    expect(empty.statusCode).toBe(400);
    if (hasBank) {
      const missing = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: { id: 'wk-999999' } });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toBe('ITEM_NOT_FOUND');
    }
    await app.close();
  });

  it('handles a malformed sample count by falling back to the default', async () => {
    if (!hasBank) return;
    const app = await buildApp();
    const response = await app.inject({ url: '/api/quiz/sample?count=abc' });
    expect(response.statusCode).toBe(200);
    expect(response.json().count).toBe(100);
    await app.close();
  });
});

describe.skipIf(!hasBank)('sample payload (real 10,000-item bank)', () => {
  it('never ships the answer key to the browser', async () => {
    const app = await buildApp();
    const response = await app.inject({ url: '/api/quiz/sample?count=20' });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items.length).toBe(20);
    expect(payload.count).toBe(20);
    expect(JSON.stringify(payload).includes('answerIndex')).toBe(false);
    expect(JSON.stringify(payload).includes('explanation')).toBe(false);
    for (const item of payload.items) {
      expect(item.options.length).toBe(4);
      expect(item.prompt.en.length).toBeGreaterThan(0);
      expect(item.prompt.th.length).toBeGreaterThan(0);
      expect(item.difficulty).toBeGreaterThanOrEqual(1);
      expect(item.difficulty).toBeLessThanOrEqual(10);
    }
    await app.close();
  });

  it('reveals the bank answer for exactly the requested item', async () => {
    const app = await buildApp();
    const items = loadQuestions(bankDir);
    const sample = drawQuizSample(items, { count: 12 });
    for (const item of sample.items) {
      const truth = items.find((entry) => entry.question.id === item.id);
      expect(truth).toBeDefined();
      const response = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: { id: item.id } });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.answerIndex).toBe(truth?.question.answerIndex);
      expect(body.explanation.en.length).toBeGreaterThan(0);
      expect(body.explanation.th.length).toBeGreaterThan(0);
    }
    await app.close();
  });

  it('draws a deterministic sample that spreads across difficulties', async () => {
    const items = loadQuestions(bankDir);
    const first = drawQuizSample(items, { count: 100 });
    const second = drawQuizSample(items, { count: 100 });
    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    expect(first.items.length).toBe(100);
    const levels = new Set(first.items.map((item) => item.difficulty));
    expect(levels.size).toBe(10);
    expect(first.shortfalls.length).toBe(0);
  });

  it('reports bank percentages that add up', () => {
    const stats = buildStats(loadQuestions(bankDir));
    expect(stats.total).toBe(10000);
    const difficultySum = stats.byDifficulty.reduce((sum, row) => sum + row.percent, 0);
    expect(difficultySum).toBeGreaterThan(99.5);
    expect(difficultySum).toBeLessThan(100.5);
    const positionSum = stats.byAnswerPosition.reduce((sum, row) => sum + row.percent, 0);
    expect(positionSum).toBeGreaterThan(99.5);
    expect(positionSum).toBeLessThan(100.5);
    for (const row of stats.byAnswerPosition) {
      expect(row.count).toBeGreaterThan(0);
      expect(row.percent).toBeLessThan(40);
    }
    for (const row of stats.byDifficulty) expect(row.count).toBeGreaterThan(0);
  });
});

describe('missing bank handling (edge)', () => {
  it('answers 503 instead of crashing when the bank is absent', async () => {
    const app = Fastify();
    registerQuizApp(app, { bankDir: bankDir + '/definitely-not-here' });
    await app.ready();
    const sample = await app.inject({ url: '/api/quiz/sample?count=5' });
    expect(sample.statusCode).toBe(503);
    expect(sample.json().error).toBe('QUIZ_BANK_MISSING');
    const reveal = await app.inject({ method: 'POST', url: '/api/quiz/reveal', payload: { id: 'wk-000001' } });
    expect(reveal.statusCode).toBe(503);
    const stats = await app.inject({ url: '/api/quiz/stats' });
    expect(stats.statusCode).toBe(503);
    const page = await app.inject({ url: '/quiz' });
    expect(page.statusCode).toBe(200);
    await app.close();
  });
});
