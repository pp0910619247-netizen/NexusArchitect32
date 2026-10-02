// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { ProblemGenerator, cosineSimilarity, toProblemAddYaml } from '../src/generator/ProblemGenerator.js';
import type { PublicProblemFile } from '../src/problem-bank/types.js';

const existing: PublicProblemFile = { blockHeight: 1, type: 'DETERMINISTIC', disciplines: ['Physics', 'Chemistry'], difficulty: 3, statement: { en: 'A prior question about energy and matter.', th: 'คำถามเดิม' }, answerCommitHash: `0x${'0'.repeat(64)}` };
const rubric = Array.from({ length: 5 }, (_, index) => ({ id: `r${index + 1}`, description: { en: `Criterion ${index + 1}`, th: `เกณฑ์ ${index + 1}` }, maxPoints: 5 }));

const llm = (overrides: Partial<{ generate: ReturnType<typeof vi.fn>; backTranslate: ReturnType<typeof vi.fn> }> = {}) => ({
  generate: overrides.generate ?? vi.fn(async () => ({ statement: { en: 'A new integrated question combining physics and chemistry.', th: 'คำถามใหม่ที่ผสานฟิสิกส์และเคมี' }, answerPlain: '42' })),
  backTranslate: overrides.backTranslate ?? vi.fn(async () => ({ en: 'A new integrated question combining physics and chemistry.' })),
});

const answerVerifier = { verify: vi.fn(async () => true) };
const baseOptions = {
  llm: llm(), similarity: { maxSimilarity: async () => 0 }, safety: { isSafe: () => true },
  answerVerifier, random: () => 0.5, salt: () => 'salt',
};

describe('ProblemGenerator', () => {
  it('selects 2-4 unique disciplines and avoids recent pairings', () => {
    const generator = new ProblemGenerator({ ...baseOptions, llm: llm() });
    const selected = generator.chooseDisciplines([['Physics', 'Chemistry'], ['Biology', 'Economics']]);
    expect(selected.length).toBeGreaterThanOrEqual(2); expect(selected.length).toBeLessThanOrEqual(4); expect(new Set(selected).size).toBe(selected.length);
  });

  it('validates deterministic output and serializes problem:add YAML', async () => {
    const generator = new ProblemGenerator({ ...baseOptions, similarity: { maxSimilarity: async () => 0.2 } });
    const result = await generator.generate({ blockHeight: 4, difficulty: 4, disciplines: ['Physics', 'Chemistry'], existing: [existing] });
    expect(result.type).toBe('DETERMINISTIC'); expect(result.answerPlain).toBe('42');
    expect(toProblemAddYaml(result)).toContain('answerPlain: "42"');
  });

  it('forces open-ended difficulty 9-10 and supplies five rubric criteria', async () => {
    const generator = new ProblemGenerator({ ...baseOptions, llm: { ...llm(), generate: vi.fn(async () => ({ statement: { en: 'Design a sustainable energy system.', th: 'ออกแบบระบบพลังงานหมุนเวียนที่ยั่งยืน' }, answerPlain: 'A reviewed design.', rubric })), backTranslate: vi.fn(async () => ({ en: 'Design a sustainable energy system.' })) } });
    const result = await generator.generate({ blockHeight: 5, difficulty: 9, disciplines: ['Physics', 'Chemistry'], existing: [] });
    expect(result.type).toBe('OPEN_ENDED'); expect(result.peerReviewRequired).toBe(true); expect(result.rubric).toHaveLength(5);
  });

  it('rejects unsafe, duplicate, and mistranslated candidates before retrying', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ statement: { en: 'A weapon question.', th: 'คำถามอาวุธ' }, answerPlain: 'x' })
      .mockResolvedValueOnce({ statement: { en: 'A new question about matter.', th: 'คำถามใหม่เกี่ยวกับสสาร' }, answerPlain: 'x' });
    const generator = new ProblemGenerator({ ...baseOptions, llm: { ...llm(), generate }, similarity: { maxSimilarity: async () => 0.95 }, maxAttempts: 2 });
    await expect(generator.generate({ blockHeight: 6, difficulty: 3, disciplines: ['Physics', 'Chemistry'], existing: [existing] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('rejects a deterministic answer that cannot be verified', async () => {
    const generator = new ProblemGenerator({ ...baseOptions, answerVerifier: { verify: async () => false }, maxAttempts: 1 });
    await expect(generator.generate({ blockHeight: 7, difficulty: 3, disciplines: ['Physics', 'Chemistry'], existing: [] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
  });

  it('rejects missing or mismatched translations', async () => {
    const missing = new ProblemGenerator({ ...baseOptions, llm: { ...llm(), generate: vi.fn(async () => ({ statement: { en: 'Complete statement.', th: '' }, answerPlain: 'x' })) }, maxAttempts: 1 });
    await expect(missing.generate({ blockHeight: 8, difficulty: 3, disciplines: ['Physics', 'Chemistry'], existing: [] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
    const mismatch = new ProblemGenerator({ ...baseOptions, llm: { ...llm(), backTranslate: vi.fn(async () => ({ en: 'Completely unrelated words.' })) }, maxAttempts: 1 });
    await expect(mismatch.generate({ blockHeight: 9, difficulty: 3, disciplines: ['Physics', 'Chemistry'], existing: [] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
  });

  it('uses the default safety policy for prohibited topics', async () => {
    const unsafe = new ProblemGenerator({ ...baseOptions, safety: { isSafe: (text) => !text.toLowerCase().includes('malware') }, llm: { ...llm(), generate: vi.fn(async () => ({ statement: { en: 'Analyze malware behavior.', th: 'วิเคราะห์มัลแวร์' }, answerPlain: 'x' })) }, maxAttempts: 1 });
    await expect(unsafe.generate({ blockHeight: 10, difficulty: 3, disciplines: ['Physics', 'Chemistry'], existing: [] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
  });

  it('rejects an open-ended response without five valid rubric criteria', async () => {
    const generator = new ProblemGenerator({ ...baseOptions, llm: { ...llm(), generate: vi.fn(async () => ({ statement: { en: 'Design a long-term circular energy system.', th: 'ออกแบบระบบพลังงานหมุนเวียนระยะยาว' }, answerPlain: 'Peer-reviewed proposal', rubric: rubric.slice(0, 4) })) }, maxAttempts: 1 });
    await expect(generator.generate({ blockHeight: 11, difficulty: 10, disciplines: ['Physics', 'Chemistry'], existing: [] })).rejects.toThrow('GENERATOR_RETRY_LIMIT');
  });

  it('selects directly from unseen 2-4 discipline combinations', () => {
    const recent = Array.from({ length: 50 }, (_, index) => index === 49 ? ['Physics', 'Chemistry'] : ['Biology', 'Economics']);
    const generator = new ProblemGenerator({ ...baseOptions, random: () => 0 });
    expect(generator.chooseDisciplines(recent).sort()).not.toEqual(['Biology', 'Economics']);
  });

  it('calculates cosine similarity deterministically', () => { expect(cosineSimilarity('same words here', 'same words here')).toBeCloseTo(1); expect(cosineSimilarity('alpha', 'beta')).toBe(0); });
});
