import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { defaultOutDir } from '../src/worldbank/generate.js';
import { registerQuizApp } from '../src/worldbank/quiz-app.js';
import {
  CompareInputError,
  compareWithReference,
  parsePlayerAnswers,
  readAiReference,
} from '../src/worldbank/quiz-compare.js';

const bankDir = defaultOutDir();
const hasBank = existsSync(bankDir);

/** Builds a throwaway directory holding an AI answer sheet. */
function referenceDir(parts: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-quiz-ref-'));
  for (const [name, content] of Object.entries(parts)) {
    writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

describe('readAiReference', () => {
  it('merges answers-*.json parts and keeps the first pick per id', () => {
    const dir = referenceDir({
      'answers-01.json': [{ id: 'wk-000001', pick: 3, feel: 'hard' }],
      'answers-02.json': [{ id: 'wk-000002', pick: 0 }, { id: 'wk-000001', pick: 1 }],
    });
    const reference = readAiReference(dir);
    expect(reference.picks.size).toBe(2);
    expect(reference.picks.get('wk-000001')?.pick).toBe(3);
    expect(reference.picks.get('wk-000001')?.feel).toBe('hard');
    expect(reference.sources).toEqual(['answers-01.json', 'answers-02.json']);
  });

  it('skips malformed entries and ignores the answer key file (edge)', () => {
    const dir = referenceDir({
      'answers-01.json': [
        { id: 'wk-000003', pick: 2 },
        { id: 'not-an-id', pick: 1 },
        { id: 'wk-000004', pick: 9 },
        { id: 'wk-000005' },
        'nope',
      ],
      'quiz-100.key.json': { 'wk-000003': { answerIndex: 0 } },
      'broken.json': '{ not json',
    });
    const reference = readAiReference(dir);
    expect(reference.picks.size).toBe(1);
    expect(reference.picks.has('wk-000003')).toBe(true);
    expect(reference.skipped).toBe(4);
    expect(reference.sources).toEqual(['answers-01.json']);
  });

  it('returns an empty sheet for a missing directory', () => {
    const reference = readAiReference(path.join(tmpdir(), 'nexus-quiz-ref-does-not-exist-' + Date.now()));
    expect(reference.picks.size).toBe(0);
    expect(reference.sources).toEqual([]);
  });
});

describe('parsePlayerAnswers', () => {
  it('accepts a valid list and removes duplicates', () => {
    expect(parsePlayerAnswers([{ id: 'wk-000001', pick: 0 }, { id: 'wk-000001', pick: 2 }])).toEqual([{ id: 'wk-000001', pick: 0 }]);
  });

  it('rejects malformed payloads (edge)', () => {
    expect(() => parsePlayerAnswers({})).toThrow(CompareInputError);
    expect(() => parsePlayerAnswers([{ id: 'wk-1', pick: 0 }])).toThrow(/INVALID_ANSWERS/);
    expect(() => parsePlayerAnswers([{ id: 'wk-000001', pick: 4 }])).toThrow(/INVALID_ANSWERS/);
    expect(() => parsePlayerAnswers([null])).toThrow(/INVALID_ANSWERS/);
    const tooMany = Array.from({ length: 201 }, (_value, index) => ({ id: 'wk-000001', pick: 0, pad: index }));
    expect(() => parsePlayerAnswers(tooMany)).toThrow(/TOO_MANY_ANSWERS/);
  });
});

describe('compareWithReference (unit)', () => {
  const items = [
    { index: 0, question: { id: 'wk-000001', difficulty: 1, answerIndex: 2, explanation: { en: 'because', th: 'เพราะ' } } },
    { index: 1, question: { id: 'wk-000002', difficulty: 9, answerIndex: 1, explanation: { en: 'why', th: 'ทำไม' } } },
    { index: 2, question: { id: 'wk-000003', difficulty: 5, answerIndex: 0, explanation: { en: 'because', th: 'เพราะ' } } },
  ] as unknown as Parameters<typeof compareWithReference>[2];

  it('splits both-correct, AI-ahead, player-ahead, no-reference and unknown', () => {
    const reference = { picks: new Map([['wk-000001', { id: 'wk-000001', pick: 2 }], ['wk-000002', { id: 'wk-000002', pick: 0 }]]), sources: ['answers-01.json'], skipped: 0 };
    const result = compareWithReference(
      [
        { id: 'wk-000001', pick: 2 },
        { id: 'wk-000002', pick: 1 },
        { id: 'wk-000003', pick: 0 },
        { id: 'wk-000099', pick: 0 },
      ],
      reference,
      items,
    );
    expect(result.rows.map((row) => row.verdict)).toEqual(['both-correct', 'player-correct-only', 'no-reference', 'unknown-item']);
    expect(result.summary).toMatchObject({
      total: 4,
      compared: 2,
      bothCorrect: 1,
      aiAhead: 0,
      playerAhead: 1,
      bothWrong: 0,
      noReference: 1,
      unknown: 1,
      agreement: 1,
      agreementPercent: 50,
      aiAccuracy: 50,
      playerAccuracy: 100,
    });
    expect(result.summary.missed).toEqual([]);
    expect(result.summary.aiMissed).toEqual(['wk-000002']);
    expect(result.reference).toEqual({ items: 2, sources: ['answers-01.json'], skipped: 0 });
  });

  it('flags items the AI got right and the player missed, with bank truth (not AI truth)', () => {
    const reference = { picks: new Map([['wk-000002', { id: 'wk-000002', pick: 1 }]]), sources: [], skipped: 0 };
    const result = compareWithReference([{ id: 'wk-000002', pick: 0 }], reference, items);
    expect(result.rows.at(0)).toMatchObject({ verdict: 'ai-correct-only', aiPick: 1, playerPick: 0, keyIndex: 1 });
    expect(result.summary.missed).toEqual(['wk-000002']);
    expect(result.summary.bothWrong).toBe(0);
    const byDifficulty = result.summary.byDifficulty.at(0);
    expect(byDifficulty).toEqual({ label: 'd9', count: 1, percent: 0 });
  });

  it('treats a wrong AI pick as wrong instead of as truth (edge)', () => {
    const reference = { picks: new Map([['wk-000002', { id: 'wk-000002', pick: 3 }]]), sources: [], skipped: 0 };
    const result = compareWithReference([{ id: 'wk-000002', pick: 0 }], reference, items);
    expect(result.rows.at(0)?.verdict).toBe('both-wrong');
    expect(result.summary.missed).toEqual([]);
    expect(result.summary.bothWrong).toBe(1);
  });

  it('reports an empty round without dividing by zero (edge)', () => {
    const result = compareWithReference([], { picks: new Map(), sources: [], skipped: 0 }, items);
    expect(result.rows).toEqual([]);
    expect(result.summary.agreementPercent).toBe(0);
    expect(result.summary.aiAccuracy).toBe(0);
    expect(result.summary.byDifficulty).toEqual([]);
  });
});

describe('POST /api/quiz/compare', () => {
  it('rejects a bad payload and a missing AI sheet', async () => {
    const app = Fastify();
    registerQuizApp(app, { bankDir, referenceDir: referenceDir({ 'answers-01.json': [{ id: 'wk-000001', pick: 0 }] }) });
    await app.ready();
    const bad = await app.inject({ method: 'POST', url: '/api/quiz/compare', payload: { answers: [{ id: 'nope', pick: 0 }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('INVALID_ANSWERS');
    await app.close();

    if (!hasBank) return;
    const empty = Fastify();
    registerQuizApp(empty, { bankDir, referenceDir: referenceDir({}) });
    await empty.ready();
    const missing = await empty.inject({ method: 'POST', url: '/api/quiz/compare', payload: { answers: [{ id: 'wk-000001', pick: 0 }] } });
    expect(missing.statusCode).toBe(503);
    expect(missing.json().error).toBe('AI_REFERENCE_MISSING');
    await empty.close();
  });

  it('refuses a remote caller', async () => {
    const app = Fastify();
    registerQuizApp(app, { bankDir, referenceDir: referenceDir({ 'answers-01.json': [{ id: 'wk-000001', pick: 0 }] }) });
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/quiz/compare', payload: { answers: [{ id: 'wk-000001', pick: 0 }] }, remoteAddress: '10.1.2.3' });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe.skipIf(!hasBank)('POST /api/quiz/compare against the real bank', () => {
  it('scores a round from the frozen sheet and never returns the whole key', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nexus-quiz-ref-real-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'answers-01.json'),
      JSON.stringify([
        { id: 'wk-000006', pick: 2, feel: 'easy' },
        { id: 'wk-000146', pick: 2, feel: 'easy' },
      ]),
      'utf8',
    );
    const app = Fastify();
    registerQuizApp(app, { bankDir, referenceDir: dir });
    await app.ready();
    const sample = await app.inject({ url: '/api/quiz/sample?count=100' });
    const payload = sample.json();
    expect(payload.referenceMatches).toBe(2);
    expect(payload.referenceItems).toBe(2);
    const response = await app.inject({
      method: 'POST',
      url: '/api/quiz/compare',
      payload: { answers: [{ id: 'wk-000006', pick: 2 }, { id: 'wk-000146', pick: 0 }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rows.at(0)).toMatchObject({ id: 'wk-000006', verdict: 'both-correct', aiPick: 2, playerPick: 2, keyIndex: 2 });
    expect(body.rows.at(1)?.verdict).toBe('ai-correct-only');
    expect(body.rows.at(1)?.keyIndex).toBe(2);
    expect(body.summary.missed).toEqual(['wk-000146']);
    expect(body.summary.compared).toBe(2);
    expect(JSON.stringify(body).includes('"wk-000243"')).toBe(false);
    await app.close();
  });
});
