import { describe, expect, it } from 'vitest';
import { dedupeKey, normalizeForDedupe, composeQuestion, newBuildContext } from '../src/worldbank/compose.js';
import { bitsNeeded, flagshipQuestion, toRoman } from '../src/worldbank/flagship.js';
import {
  ANSWER_CAP_PER_FILE,
  FLAGSHIP_INDEX,
  TOTAL,
  difficultyForIndex,
  newLadderState,
  planForIndex,
  subjectCountForIndex,
} from '../src/worldbank/ladder.js';
import { FILE_COUNT, fileNameFor, serializeQuestion } from '../src/worldbank/generate.js';
import { DISCIPLINE_IDS } from '../src/chain/disciplines.js';

const FIELD_ORDER = [
  'id',
  'disciplines',
  'primaryDiscipline',
  'subjectCount',
  'difficulty',
  'prompt',
  'options',
  'answerIndex',
  'explanation',
  'tags',
  'verifiedYear',
];

describe('world-v1 flagship (wk-000001)', () => {
  it('is human-impossible tier: difficulty 10, four subjects, answer at position 0', () => {
    const question = flagshipQuestion();
    expect(question.id).toBe('wk-000001');
    expect(question.difficulty).toBe(10);
    expect(question.subjectCount).toBe(4);
    expect(question.disciplines).toHaveLength(4);
    expect(question.primaryDiscipline).toBe(question.disciplines[0]);
    expect(question.answerIndex).toBe(0);
  });

  it('keeps every prompt inside the brief\'s 10..300 window and all four options distinct', () => {
    const question = flagshipQuestion();
    expect(question.prompt.th.length).toBeGreaterThanOrEqual(10);
    expect(question.prompt.th.length).toBeLessThanOrEqual(300);
    expect(question.prompt.en.length).toBeGreaterThanOrEqual(10);
    expect(question.prompt.en.length).toBeLessThanOrEqual(300);
    expect(new Set(question.options).size).toBe(4);
  });

  it('chains five layers: 3^7 = 2187 = MMCLXXXVII, 16 values = 4 bits', () => {
    expect(toRoman(3 ** 7)).toBe('MMCLXXXVII');
    expect(toRoman(1_187)).toBe('MCLXXXVII');
    expect(bitsNeeded(16)).toBe(4);
    expect(bitsNeeded(1)).toBe(0);
    expect(() => toRoman(0)).toThrow('ROMAN_OUT_OF_RANGE');
    expect(() => toRoman(4000)).toThrow('ROMAN_OUT_OF_RANGE');
    expect(() => bitsNeeded(0)).toThrow('BITS_OUT_OF_RANGE');
  });
});

describe('ladder allocator', () => {
  it('ramps easy to frontier across the 10,000 indices without ever going backwards', () => {
    expect(difficultyForIndex(1)).toBe(1);
    expect(difficultyForIndex(900)).toBe(2);
    expect(difficultyForIndex(901)).toBe(3);
    expect(difficultyForIndex(TOTAL - 1)).toBe(10);
    let previous = 0;
    for (let index = 1; index < TOTAL; index += 1) {
      const difficulty = difficultyForIndex(index);
      expect(difficulty).toBeGreaterThanOrEqual(previous);
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
      previous = difficulty;
    }
  });

  it('allocates 60/30/10 percent of subject counts inside every ten-question window', () => {
    const counts = { 2: 0, 3: 0, 4: 0 } as Record<number, number>;
    for (let index = 0; index < 1_000; index += 1) counts[subjectCountForIndex(index)]! += 1;
    expect(counts[2]).toBe(600);
    expect(counts[3]).toBe(300);
    expect(counts[4]).toBe(100);
  });

  it('is deterministic and caps answer positions at 40% per file', () => {
    const stateA = newLadderState(DISCIPLINE_IDS.length);
    const stateB = newLadderState(DISCIPLINE_IDS.length);
    const perFile = Array.from({ length: FILE_COUNT }, () => [0, 0, 0, 0]);
    for (let index = 0; index < 1_000; index += 1) {
      const planA = planForIndex(index, DISCIPLINE_IDS, stateA);
      const planB = planForIndex(index, DISCIPLINE_IDS, stateB);
      expect(planA).toEqual(planB);
      expect(planA.answerIndex).toBeGreaterThanOrEqual(0);
      expect(planA.answerIndex).toBeLessThanOrEqual(3);
      expect(planA.disciplines.length).toBe(planA.subjectCount);
      expect(new Set(planA.disciplines).size).toBe(planA.subjectCount);
      perFile[0]![planA.answerIndex] = perFile[0]![planA.answerIndex]! + 1;
    }
    const cap = 1_000 * ANSWER_CAP_PER_FILE;
    for (const count of perFile[0]!) expect(count).toBeLessThanOrEqual(cap);
    expect(planForIndex(FLAGSHIP_INDEX, DISCIPLINE_IDS, newLadderState(12)).difficulty).toBe(10);
  });

  it('names files exactly as the brief requires', () => {
    expect(fileNameFor(0)).toBe('questions-00001-01000.jsonl');
    expect(fileNameFor(9)).toBe('questions-09001-10000.jsonl');
    expect(FILE_COUNT).toBe(10);
  });
});

describe('world-v1 composer', () => {
  it('produces a schema-perfect question with four distinct options and valid tags', () => {
    const state = newLadderState(DISCIPLINE_IDS.length);
    const ctx = newBuildContext();
    planForIndex(FLAGSHIP_INDEX, DISCIPLINE_IDS, state);
    const question = composeQuestion(planForIndex(1, DISCIPLINE_IDS, state), ctx);
    expect(Object.keys(question)).toEqual(FIELD_ORDER);
    expect(Object.keys(question.prompt)).toEqual(['th', 'en']);
    expect(Object.keys(question.explanation)).toEqual(['th', 'en']);
    expect(question.options).toHaveLength(4);
    expect(new Set(question.options).size).toBe(4);
    expect(question.answerIndex).toBeGreaterThanOrEqual(0);
    expect(question.answerIndex).toBeLessThanOrEqual(3);
    expect(question.prompt.th.length).toBeGreaterThanOrEqual(10);
    expect(question.prompt.th.length).toBeLessThanOrEqual(300);
    expect(question.prompt.en.length).toBeLessThanOrEqual(300);
    expect(question.tags.length).toBeGreaterThanOrEqual(1);
    expect(question.tags.length).toBeLessThanOrEqual(4);
    for (const tag of question.tags) {
      expect(tag).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(DISCIPLINE_IDS).not.toContain(tag);
    }
    expect(question.verifiedYear).toBe(2026);
    expect(JSON.parse(serializeQuestion(question)).id).toBe('wk-000002');
  });

  it('keeps dedupe keys unique across a run of consecutive questions (facts are reused)', () => {
    const state = newLadderState(DISCIPLINE_IDS.length);
    const ctx = newBuildContext();
    const keys = new Set<string>();
    for (let index = 1; index <= 200; index += 1) {
      const question = composeQuestion(planForIndex(index, DISCIPLINE_IDS, state), ctx);
      keys.add(dedupeKey(question.prompt, question.options));
    }
    expect(keys.size).toBe(200);
  });

  it('normalizes prompts and options for dedupe: digits, spaces and punctuation are ignored (edge case)', () => {
    expect(normalizeForDedupe('Which sequence? 3^7 -> MCLXXXVII!')).toBe('whichsequencemclxxxvii');
    expect(normalizeForDedupe('๒๑,๐๐๐ NEX')).toBe('nex');
    expect(dedupeKey({ th: '', en: 'A B' }, ['x', 'y', 'z', 'w'])).toBe(dedupeKey({ th: '', en: 'a-b' }, ['w', 'z', 'y', 'x']));
  });
});

describe('world-v1 full bank (acceptance criteria)', () => {
  it('composes 10,000 unique, sequential, schema-valid questions', async () => {
    const { buildBank } = await import('../src/worldbank/generate.js');
    const bank = buildBank();
    expect(bank).toHaveLength(TOTAL);
    expect(bank[0]!.id).toBe('wk-000001');
    expect(bank[TOTAL - 1]!.id).toBe('wk-010000');
    const ids = new Set<string>();
    const keys = new Set<string>();
    const perFile = Array.from({ length: FILE_COUNT }, () => [0, 0, 0, 0]);
    let previous = 0;
    for (let index = 0; index < bank.length; index += 1) {
      const question = bank[index]!;
      expect(question.id).toBe(`wk-${String(index + 1).padStart(6, '0')}`);
      ids.add(question.id);
      keys.add(dedupeKey(question.prompt, question.options));
      const fileIndex = Math.floor(index / 1_000);
      perFile[fileIndex]![question.answerIndex] = perFile[fileIndex]![question.answerIndex]! + 1;
      if (index > 0) {
        expect(question.difficulty).toBeGreaterThanOrEqual(previous);
        previous = question.difficulty;
      }
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
    }
    expect(ids.size).toBe(TOTAL);
    expect(keys.size).toBe(TOTAL);
    const cap = 1_000 * ANSWER_CAP_PER_FILE;
    for (const counts of perFile) for (const count of counts) expect(count).toBeLessThanOrEqual(cap);
  }, 60_000);
});
