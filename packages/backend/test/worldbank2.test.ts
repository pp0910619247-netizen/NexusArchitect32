import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeQuestion2, sourcesForSubject } from '../src/worldbank/v2/compose.js';
import { FORMULAS, countPrimesBelow, formulasForSubject } from '../src/worldbank/v2/derived.js';
import { buildBank2, defaultOutDir2, serializeQuestion2 } from '../src/worldbank/v2/generate.js';
import { newLadder2State, planForIndex2, subjectCountForIndex, tierForIndex } from '../src/worldbank/v2/ladder.js';
import {
  PREDICATES,
  buildBlockTable,
  countBlocks,
  enumerateCount,
  formatNumber,
  predicateOf,
  spaceTable,
} from '../src/worldbank/v2/numeric.js';
import { SPACE_MAX, TOTAL, type WorldQuestionV2 } from '../src/worldbank/v2/schema.js';
import { DIFFICULTY_BY_SUBJECT_COUNT, SUBJECTS, SUBJECT_IDS } from '../src/worldbank/v2/subjects.js';
import { fullSpaceEnumeration, validateBank2, validateEngine, validateQuestion2 } from '../src/worldbank/v2/validate.js';

const bankDir = defaultOutDir2();
const hasBank = existsSync(bankDir);

/** Composes the first `count` items with its own ladder state (one pass). */
function composePass(count: number): WorldQuestionV2[] {
  const state = newLadder2State(SUBJECT_IDS.length);
  const items: WorldQuestionV2[] = [];
  for (let index = 0; index < count; index += 1) items.push(composeQuestion2(index, state));
  return items;
}

describe('world-v2 subjects', () => {
  it('ships 12 new subjects with both languages and a monotone difficulty map', () => {
    expect(SUBJECT_IDS.length).toBe(12);
    expect(new Set(SUBJECT_IDS).size).toBe(12);
    for (const subject of SUBJECTS) {
      expect(subject.th.trim().length).toBeGreaterThan(0);
      expect(subject.en.trim().length).toBeGreaterThan(0);
      expect(subject.tag).toMatch(/^[a-z][a-z-]*$/);
    }
    const scores = [4, 6, 8, 10, 12].map((count) => DIFFICULTY_BY_SUBJECT_COUNT[count]!);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(scores[0]).toBe(1);
    expect(scores[scores.length - 1]).toBe(10);
  });

  it('gives every subject at least three native clause sources (edge)', () => {
    for (const subject of SUBJECT_IDS) {
      expect(sourcesForSubject(subject).length).toBeGreaterThanOrEqual(3);
      expect(formulasForSubject(subject).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('world-v2 ladder', () => {
  it('maps 10,000 indices to the 4 tiers with a 4:6 ratio in every 10-block', () => {
    const histogram: Record<number, number> = {};
    for (let index = 0; index < TOTAL; index += 1) {
      const count = subjectCountForIndex(index);
      histogram[count] = (histogram[count] ?? 0) + 1;
    }
    expect(histogram).toEqual({ 4: 1_000, 6: 2_500, 8: 2_500, 10: 2_500, 12: 1_500 });
    for (let index = 0; index < TOTAL; index += 10) {
      const block = Array.from({ length: 10 }, (_value, offset) => subjectCountForIndex(index + offset));
      const plan = tierForIndex(index);
      expect(block.filter((count) => count === plan.low).length).toBe(4);
      expect(block.filter((count) => count === plan.high).length).toBe(6);
    }
    expect(tierForIndex(0).tier).toBe(1);
    expect(tierForIndex(2_499).tier).toBe(1);
    expect(tierForIndex(2_500).tier).toBe(2);
    expect(tierForIndex(9_999).tier).toBe(4);
  });

  it('keeps primary subjects balanced and ends with a twelve-subject item', () => {
    const state = newLadder2State(SUBJECT_IDS.length);
    const primary: Record<string, number> = {};
    for (let index = 0; index < TOTAL - 1; index += 1) {
      const plan = planForIndex2(index, SUBJECT_IDS, state);
      const subject = plan.subjects[0]!;
      primary[subject] = (primary[subject] ?? 0) + 1;
    }
    const hardest = composeQuestion2(TOTAL - 1, state);
    primary[hardest.primarySubject] = (primary[hardest.primarySubject] ?? 0) + 1;
    for (const subject of SUBJECT_IDS) {
      const used = primary[subject] ?? 0;
      expect(used).toBeGreaterThan(700);
      expect(used).toBeLessThan(950);
    }
    expect(hardest.subjectCount).toBe(12);
    expect(hardest.clauses.length).toBe(12);
    expect(hardest.tier).toBe(4);
    expect(new Set(hardest.subjects).size).toBe(12);
  }, 30_000);
});

describe('world-v2 numeric engine', () => {
  it('matches an independent loop on a small space (edge)', () => {
    const max = 200_000;
    const table = buildBlockTable(max, 10_000);
    for (const predicate of PREDICATES) {
      expect(countBlocks(predicate, 0, table.blockCount - 1, table)).toBe(enumerateCount(predicate, 1, max));
    }
  });

  it('proves the 1…10,000,000 block table with closed forms and prefix enumeration', () => {
    const engine = validateEngine();
    expect(engine.checks.length).toBeGreaterThanOrEqual(9);
    expect(engine.checks.filter((check) => !check.ok)).toEqual([]);
    expect(engine.ok).toBe(true);
  });

  it('counts a full block and the whole space exactly', () => {
    expect(countBlocks('prime', 0, 0)).toBe(enumerateCount('prime', 1, 100_000));
    expect(countBlocks('multipleOf77', 0, 99)).toBe(Math.floor(SPACE_MAX / 77));
    expect(countBlocks('prime', 0, 9)).toBe(countPrimesBelow(1_000_000));
    expect(spaceTable().blockCount).toBe(SPACE_MAX / 100_000);
  });

  it('validates single-number predicates and number formatting', () => {
    expect(predicateOf(7, 'prime')).toBe(true);
    expect(predicateOf(1, 'prime')).toBe(false);
    expect(predicateOf(121, 'palindrome')).toBe(true);
    expect(predicateOf(120, 'palindrome')).toBe(false);
    expect(predicateOf(7, 'coprimeWith360')).toBe(true);
    expect(predicateOf(9, 'coprimeWith360')).toBe(false);
    expect(predicateOf(0, 'noZeroDigit')).toBe(false);
    expect(predicateOf(105, 'noZeroDigit')).toBe(false);
    expect(predicateOf(111, 'noZeroDigit')).toBe(true);
    expect(predicateOf(2 ** 16, 'popcountPrime')).toBe(false); // 65,536 has one 1-bit
    expect(predicateOf(2 ** 16 + 8, 'popcountPrime')).toBe(true); // 65,544 has two 1-bits
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(1_000)).toBe('1,000');
    expect(formatNumber(2_461_215)).toBe('2,461,215');
    expect(formatNumber(SPACE_MAX)).toBe('10,000,000');
  });
});

describe('world-v2 derived sources', () => {
  it('keeps every value and distractor inside the 1…10,000,000 space', () => {
    const seen = new Set<string>();
    for (const formula of FORMULAS) {
      expect(seen.has(formula.id)).toBe(false);
      seen.add(formula.id);
      expect(Number.isInteger(formula.value)).toBe(true);
      expect(formula.value).toBeGreaterThanOrEqual(1);
      expect(formula.value).toBeLessThanOrEqual(SPACE_MAX);
      expect(formula.subjects.length).toBeGreaterThanOrEqual(1);
      expect(formula.distractors.length).toBe(3);
      for (const wrong of formula.distractors) {
        expect(wrong).not.toBe(formula.value);
        expect(wrong).toBeGreaterThanOrEqual(1);
        expect(wrong).toBeLessThanOrEqual(SPACE_MAX);
      }
      expect(formula.text.th.trim().length).toBeGreaterThan(0);
      expect(formula.text.en.trim().length).toBeGreaterThan(0);
      expect(formula.method.th.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('world-v2 composer', () => {
  it('is deterministic: two passes over the first 1,000 items are identical', () => {
    const first = composePass(1_000);
    const second = composePass(1_000);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('builds four distinct options with exactly one correct in every clause', () => {
    const items = composePass(200);
    items.forEach((item, index) => {
      expect(validateQuestion2(item, index)).toEqual([]);
      for (const lang of ['th', 'en'] as const) {
        const correct = item.clauses
          .map((clause) =>
            clause.unit === undefined ? formatNumber(clause.value) : `${formatNumber(clause.value)} ${clause.unit[lang]}`,
          )
          .join(' · ');
        expect(item.options[lang][item.answerIndex]).toBe(correct);
        expect(new Set(item.options[lang]).size).toBe(4);
      }
    });
  });

  it('never repeats a value inside an item and always stays inside the space (edge)', () => {
    const items = composePass(500);
    for (const item of items) {
      const values = item.clauses.map((clause) => clause.value);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(SPACE_MAX);
      }
      expect(item.subjects).toEqual(item.clauses.map((clause) => clause.subject));
      expect(new Set(item.subjects).size).toBe(item.subjectCount);
      expect(item.prompt.th).toContain(item.clauses[0]!.text.th);
    }
  });

  it('reports a problem when an item is tampered with (edge)', () => {
    const item = composePass(1)[0]!;
    const tampered: WorldQuestionV2 = { ...item, clauses: item.clauses.map((clause, slot) => (slot === 0 ? { ...clause, value: clause.value + 1 } : clause)) };
    const issues = validateQuestion2(tampered, 0);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.problem.includes('count') || issue.problem.includes('formula value'))).toBe(true);
  });
});

describe.skipIf(!hasBank)('world-v2 written bank (acceptance)', () => {
  it('validates all 10,000 items, tier ratios and manifest hashes', () => {
    const report = validateBank2(bankDir);
    expect(report.issues.slice(0, 5)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.items).toBe(TOTAL);
    expect(report.files).toBe(10);
    expect(report.subjectCountHistogram).toEqual({ 4: 1_000, 6: 2_500, 8: 2_500, 10: 2_500, 12: 1_500 });
    expect(report.duplicatePrompts).toBe(0);
    expect(report.enumeration.clauses).toBeGreaterThan(0);
    expect(report.enumeration.steps).toBeLessThanOrEqual(report.enumeration.budget);
    for (const used of report.answerHistogram) expect(used).toBeGreaterThan(1_000);
  });

  it('regenerates the identical bank and keeps the ids sequential (determinism)', () => {
    const rebuilt = buildBank2();
    expect(rebuilt.length).toBe(TOTAL);
    expect(rebuilt[0]!.id).toBe('w2-000001');
    expect(rebuilt[TOTAL - 1]!.id).toBe('w2-010000');
    const firstFile = readFileSync(path.join(bankDir, 'questions-00001-01000.jsonl'), 'utf8').split('\n');
    const lastFile = readFileSync(path.join(bankDir, 'questions-09001-10000.jsonl'), 'utf8').trimEnd().split('\n');
    expect(firstFile[0]).toBe(serializeQuestion2(rebuilt[0]!));
    expect(firstFile[1]).toBe(serializeQuestion2(rebuilt[1]!));
    expect(lastFile[lastFile.length - 1]).toBe(serializeQuestion2(rebuilt[TOTAL - 1]!));
    expect(lastFile[lastFile.length - 5]).toBe(serializeQuestion2(rebuilt[TOTAL - 5]!));
  }, 60_000);
});

describe.skipIf(!hasBank)('world-v2 full-space enumeration (slow, explicit)', () => {
  it('re-counts the whole space for the palindrome predicate directly', () => {
    expect(fullSpaceEnumeration('palindrome')).toBe(countBlocks('palindrome', 0, 99));
  }, 120_000);
});
