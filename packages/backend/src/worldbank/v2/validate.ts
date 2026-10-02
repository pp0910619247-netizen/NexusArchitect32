// SPDX-License-Identifier: MIT
/**
 * world2:validate — checks the written bank against independent reasoning.
 *
 * Three layers, weakest to strongest:
 *  1. per item: rebuild the correct option from the declared clauses and
 *     recompute every value (count clauses from the block table, formula
 *     clauses from the derived table) — nothing in the file is trusted.
 *  2. engine anchors: the whole-space totals of the block table are compared
 *     with closed forms (prime count, φ-formula, palindrome/no-zero formulas,
 *     digit-sum polynomial) and, where no closed form exists, with a direct
 *     enumeration of a 2,000,000 prefix.
 *  3. sampled direct enumeration: count clauses are re-counted with a fresh
 *     loop over their own range under a step budget.
 *
 * Exit codes: 0 = every check passed, 1 = at least one check failed.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countPrimesBelow, FORMULAS, getFormula } from './derived.js';
import { defaultOutDir2, fileNameFor2 } from './generate.js';
import { BLOCK_SIZE, FILE_COUNT, QUESTIONS_PER_FILE, SPACE_MAX, TOTAL, type Clause, type WorldQuestionV2 } from './schema.js';
import {
  PREDICATES,
  blockRangeFor,
  countBlocks,
  enumerateCount,
  formatNumber,
  spaceTable,
  type Predicate,
} from './numeric.js';
import { DIFFICULTY_BY_SUBJECT_COUNT, SUBJECT_IDS } from './subjects.js';

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface EngineReport {
  readonly checks: readonly CheckResult[];
  readonly ok: boolean;
}

const PRIME_TOTAL_10M = 664_579; // π(10,000,000), a published value

function sumTable(predicate: Predicate, fromBlock = 0, toBlock = spaceTable().blockCount - 1): number {
  return countBlocks(predicate, fromBlock, toBlock);
}

/** Exact count of n ≤ limit whose decimal digit sum is prime. */
function digitSumPrimeUpTo(limit: number): number {
  const digits = String(limit).split('').map((character) => Number(character));
  const primes = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61]);
  let total = 0;
  for (let prefix = 0; prefix <= digits.length; prefix += 1) {
    // prefix digits fixed, next digit smaller than the limit's → remainder free
    const atEnd = prefix === digits.length;
    let prefixSum = 0;
    for (let i = 0; i < prefix; i += 1) prefixSum += digits[i]!;
    if (atEnd) {
      if (primes.has(prefixSum)) total += 1;
      break;
    }
    for (let digit = 0; digit < digits[prefix]!; digit += 1) {
      const sum = prefixSum + digit;
      const free = digits.length - prefix - 1;
      const ways = new Map<number, number>();
      ways.set(0, 1);
      for (let slot = 0; slot < free; slot += 1) {
        const next = new Map<number, number>();
        for (const [value, count] of ways) {
          for (let add = 0; add <= 9; add += 1) next.set(value + add, (next.get(value + add) ?? 0) + count);
        }
        for (const key of [...ways.keys()]) ways.delete(key);
        for (const [value, count] of next) ways.set(value, count);
      }
      for (const [value, count] of ways) if (primes.has(sum + value)) total += count;
    }
    if (prefix < digits.length - 1 && digits[0] === 0) break; // leading zero guard (unreachable for our inputs)
  }
  return total;
}

/** Exact count of n ≤ 9,999,999 (7 digits max) whose digit sum is prime. */
function digitSumPrimeSevenDigits(): number {
  let counts = [1];
  for (let slot = 0; slot < 7; slot += 1) {
    const next = new Array<number>(counts.length + 9).fill(0);
    for (let value = 0; value < counts.length; value += 1) {
      const count = counts[value]!;
      for (let add = 0; add <= 9; add += 1) next[value + add] = (next[value + add] ?? 0) + count;
    }
    counts = next;
  }
  const primes = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61]);
  let total = 0;
  for (let sum = 0; sum < counts.length; sum += 1) if (primes.has(sum)) total += counts[sum]!;
  return total;
}

function coprimeWith360Exact(): number {
  const divisors: readonly (readonly [number, number])[] = [
    [1, 1],
    [2, -1],
    [3, -1],
    [5, -1],
    [6, 1],
    [10, 1],
    [15, 1],
    [30, -1],
  ];
  let total = 0;
  for (const [divisor, sign] of divisors) total += sign * Math.floor(SPACE_MAX / divisor);
  return total;
}

function palindromeExact(): number {
  let total = 0;
  for (let length = 1; length <= 7; length += 1) {
    const half = Math.ceil(length / 2);
    total += 9 * 10 ** (half - 1);
  }
  return total;
}

function noZeroDigitExact(): number {
  let total = 0;
  for (let length = 1; length <= 7; length += 1) total += 9 ** length;
  return total;
}

/** Layer 2 — proves the block table itself. */
export function validateEngine(): EngineReport {
  const table = spaceTable();
  const checks: CheckResult[] = [];
  const anchor = (name: string, predicate: Predicate, expected: number, method: string): void => {
    const actual = sumTable(predicate);
    checks.push({
      name: `engine:${predicate}`,
      ok: actual === expected,
      detail: `${method} → expected ${expected}, table says ${actual}`,
    });
  };

  anchor('prime', 'prime', PRIME_TOTAL_10M, 'π(10,000,000)');
  anchor('multipleOf77', 'multipleOf77', Math.floor(SPACE_MAX / 77), '⌊10,000,000 / 77⌋');
  anchor('coprimeWith360', 'coprimeWith360', coprimeWith360Exact(), 'inclusion–exclusion over 360');
  anchor('palindrome', 'palindrome', palindromeExact(), 'Σ 9·10^(⌈L/2⌉−1) for L = 1…7');
  anchor('noZeroDigit', 'noZeroDigit', noZeroDigitExact(), 'Σ 9^L for L = 1…7');
  anchor('digitSumPrime', 'digitSumPrime', digitSumPrimeSevenDigits(), 'digit-sum polynomial over 7 digits');
  checks.push({
    name: 'engine:digitSumPrime (DP cross-check)',
    ok: digitSumPrimeUpTo(9_999_999) === digitSumPrimeSevenDigits(),
    detail: `tight digit DP ${digitSumPrimeUpTo(9_999_999)} vs polynomial ${digitSumPrimeSevenDigits()}`,
  });

  // No closed form for these two: enumerate a 2,000,000 prefix directly.
  for (const predicate of ['popcountPrime', 'hexHasLetter'] as const) {
    const blocks = 20;
    const enumerated = enumerateCount(predicate, 1, blocks * BLOCK_SIZE);
    const tablePrefix = sumTable(predicate, 0, blocks - 1);
    checks.push({
      name: `engine:${predicate}`,
      ok: enumerated === tablePrefix,
      detail: `direct enumeration of the first ${formatNumber(blocks * BLOCK_SIZE)} integers = ${enumerated}, table = ${tablePrefix}`,
    });
  }

  // Independent second implementation of the prime count below one million.
  const millionFromTable = sumTable('prime', 0, 9);
  const millionFromSieve = countPrimesBelow(1_000_000);
  checks.push({
    name: 'engine:prime below 1,000,000 (second implementation)',
    ok: millionFromTable === millionFromSieve,
    detail: `table ${millionFromTable} vs local sieve ${millionFromSieve}`,
  });

  checks.push({
    name: 'engine:block table shape',
    ok: table.blockCount === SPACE_MAX / BLOCK_SIZE && table.max === SPACE_MAX,
    detail: `${table.blockCount} blocks × ${formatNumber(table.blockSize)} = ${formatNumber(SPACE_MAX)}`,
  });

  return { checks, ok: checks.every((check) => check.ok) };
}

function countClauseValue(clause: Clause): number {
  if (clause.kind !== 'count') throw new Error(`NOT_A_COUNT_CLAUSE:${clause.source}`);
  const [from, to] = clause.range ?? [0, 0];
  const fromBlock = (from - 1) / BLOCK_SIZE;
  const toBlock = to / BLOCK_SIZE - 1;
  return countBlocks(clause.source as Predicate, fromBlock, toBlock);
}

export interface QuestionIssue {
  readonly id: string;
  readonly problem: string;
}

/** Layer 1 — re-derives one item from its declared provenance. */
export function validateQuestion2(item: WorldQuestionV2, index: number): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const fail = (problem: string): void => {
    issues.push({ id: item.id, problem });
  };

  if (item.id !== `w2-${String(index + 1).padStart(6, '0')}`) fail(`id mismatch for index ${index}`);
  if (item.subjects.length !== item.subjectCount) fail('subject list length ≠ subjectCount');
  if (new Set(item.subjects).size !== item.subjects.length) fail('duplicate subject in item');
  if (item.primarySubject !== item.subjects[0]) fail('primarySubject is not subjects[0]');
  for (const subject of item.subjects) if (!SUBJECT_IDS.includes(subject)) fail(`unknown subject ${subject}`);
  if (DIFFICULTY_BY_SUBJECT_COUNT[item.subjectCount] !== item.difficulty) fail('difficulty does not match subjectCount');
  const expectedTier = Math.floor(index / 2_500) + 1;
  if (item.tier !== expectedTier) fail(`tier ${item.tier} ≠ ${expectedTier} for index ${index}`);
  const ratioPosition = index % 10;
  const expectedCount = ratioPosition < 4 ? [4, 6, 8, 10][item.tier - 1] : [6, 8, 10, 12][item.tier - 1];
  if (item.subjectCount !== expectedCount) fail(`subjectCount ${item.subjectCount} ≠ ladder ${expectedCount}`);

  if (item.clauses.length !== item.subjectCount) fail('clause count ≠ subjectCount');
  item.clauses.forEach((clause, slot) => {
    if (clause.subject !== item.subjects[slot]) fail(`clause ${slot + 1} subject ≠ item subjects[${slot}]`);
    if (!Number.isInteger(clause.value) || clause.value < 1 || clause.value > SPACE_MAX) {
      fail(`clause ${slot + 1} value outside 1…${SPACE_MAX}`);
    }
    if (clause.text.th.trim().length === 0 || clause.text.en.trim().length === 0) fail(`clause ${slot + 1} text empty`);
    if (clause.kind === 'count') {
      if (!PREDICATES.includes(clause.source as Predicate)) {
        fail(`clause ${slot + 1} unknown predicate ${clause.source}`);
        return;
      }
      const [from, to] = clause.range ?? [0, 0];
      if (from !== (Math.floor((from - 1) / BLOCK_SIZE) * BLOCK_SIZE + 1) || to % BLOCK_SIZE !== 0) {
        fail(`clause ${slot + 1} range is not block aligned`);
        return;
      }
      if (from < 1 || to > SPACE_MAX) {
        fail(`clause ${slot + 1} range outside the space`);
        return;
      }
      const recomputed = countClauseValue(clause);
      if (recomputed !== clause.value) fail(`clause ${slot + 1} count ${clause.value} ≠ recomputed ${recomputed}`);
    } else if (clause.kind === 'formula') {
      const formula = FORMULAS.find((entry) => entry.id === clause.source);
      if (formula === undefined) {
        fail(`clause ${slot + 1} unknown formula ${clause.source}`);
        return;
      }
      if (!formula.subjects.includes(clause.subject)) fail(`clause ${slot + 1} formula not native to ${clause.subject}`);
      if (formula.value !== clause.value) fail(`clause ${slot + 1} formula value ${clause.value} ≠ ${formula.value}`);
      if (clause.range !== undefined) fail(`clause ${slot + 1} formula clause must not carry a range`);
    } else {
      fail(`clause ${slot + 1} unknown kind`);
    }
  });

  const values = item.clauses.map((clause) => clause.value);
  if (new Set(values).size !== values.length) fail('two clauses share the same value');

  const render = (value: number, unit: { th: string; en: string } | undefined, lang: 'th' | 'en'): string =>
    unit === undefined ? formatNumber(value) : `${formatNumber(value)} ${unit[lang]}`;
  for (const lang of ['th', 'en'] as const) {
    const correct = item.clauses.map((clause) => render(clause.value, clause.unit, lang)).join(' · ');
    if (item.options[lang].length !== 4) fail(`options.${lang} length ≠ 4`);
    if (item.options[lang][item.answerIndex] !== correct) fail(`options.${lang}[answer] is not the clause sequence`);
    if (new Set(item.options[lang]).size !== 4) fail(`options.${lang} contains duplicates`);
    for (const option of item.options[lang]) if (option.trim().length === 0) fail(`options.${lang} has an empty entry`);
    const others = item.options[lang].filter((_option, slot) => slot !== item.answerIndex);
    for (const option of others) {
      if (option === correct) fail(`options.${lang} has a second correct entry`);
      const tokens = option.split(' · ');
      const differing = tokens.filter((token, slot) => token !== render(item.clauses[slot]!.value, item.clauses[slot]!.unit, lang)).length;
      if (differing === 0) fail(`options.${lang} wrong option matches everywhere`);
      if (differing > 3) fail(`options.${lang} wrong option differs in ${differing} clauses (max 3)`);
    }
  }

  if (item.prompt.th.trim().length === 0 || item.prompt.en.trim().length === 0) fail('prompt missing a language');
  if (item.explanation.th.trim().length === 0 || item.explanation.en.trim().length === 0) fail('explanation missing a language');
  if (item.answerIndex < 0 || item.answerIndex > 3) fail('answerIndex outside 0…3');
  return issues;
}

export interface BankReport {
  readonly ok: boolean;
  readonly items: number;
  readonly files: number;
  readonly issues: readonly QuestionIssue[];
  readonly enumeration: { readonly clauses: number; readonly steps: number; readonly budget: number };
  readonly duplicatePrompts: number;
  readonly answerHistogram: readonly number[];
  readonly subjectCountHistogram: Readonly<Record<number, number>>;
  readonly primarySubjectHistogram: Readonly<Record<string, number>>;
  readonly formulaUsage: Readonly<Record<string, number>>;
}

function parseBank(dir: string): WorldQuestionV2[] {
  const items: WorldQuestionV2[] = [];
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const name = fileNameFor2(fileIndex);
    const body = readFileSync(path.join(dir, name), 'utf8');
    for (const line of body.split('\n')) {
      if (line.trim().length === 0) continue;
      items.push(JSON.parse(line) as WorldQuestionV2);
    }
  }
  return items;
}

/** Layers 1 + 3 over the written bank, plus manifest and shape checks. */
export function validateBank2(dir: string): BankReport {
  const items = parseBank(dir);
  const issues: QuestionIssue[] = [];
  const budgetTotal = 30_000_000;
  let budget = budgetTotal;
  let enumeratedClauses = 0;
  let enumeratedSteps = 0;

  items.forEach((item, index) => {
    issues.push(...validateQuestion2(item, index));
    for (const clause of item.clauses) {
      if (clause.kind !== 'count') continue;
      const [from, to] = clause.range ?? [0, 0];
      const span = to - from + 1;
      if (span <= budget) {
        const direct = enumerateCount(clause.source as Predicate, from, to);
        budget -= span;
        enumeratedSteps += span;
        enumeratedClauses += 1;
        if (direct !== clause.value) issues.push({ id: item.id, problem: `clause ${clause.source} direct enumeration ${direct} ≠ ${clause.value}` });
      }
    }
  });

  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
    total: number;
    files: { name: string; sha256: string; count: number }[];
  };
  for (const file of manifest.files) {
    const body = readFileSync(path.join(dir, file.name), 'utf8');
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    if (digest !== file.sha256) issues.push({ id: file.name, problem: 'sha256 mismatch against manifest' });
    const lines = body.split('\n').filter((line) => line.trim().length > 0).length;
    if (lines !== QUESTIONS_PER_FILE || file.count !== QUESTIONS_PER_FILE) issues.push({ id: file.name, problem: `expected ${QUESTIONS_PER_FILE} items` });
  }
  if (items.length !== TOTAL) issues.push({ id: 'bank', problem: `expected ${TOTAL} items, found ${items.length}` });

  // Per-file answer-position cap (≤40%).
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const slice = items.slice(fileIndex * QUESTIONS_PER_FILE, (fileIndex + 1) * QUESTIONS_PER_FILE);
    for (let slot = 0; slot < 4; slot += 1) {
      const used = slice.filter((item) => item.answerIndex === slot).length;
      if (used > QUESTIONS_PER_FILE * 0.4) issues.push({ id: fileNameFor2(fileIndex), problem: `answer position ${slot} used ${used} times (>40%)` });
    }
  }

  const promptCounts = new Map<string, number>();
  const answerHistogram = [0, 0, 0, 0];
  const subjectCountHistogram: Record<number, number> = {};
  const primarySubjectHistogram: Record<string, number> = {};
  const formulaUsage: Record<string, number> = {};
  for (const item of items) {
    const key = item.prompt.en;
    promptCounts.set(key, (promptCounts.get(key) ?? 0) + 1);
    answerHistogram[item.answerIndex] = (answerHistogram[item.answerIndex] ?? 0) + 1;
    subjectCountHistogram[item.subjectCount] = (subjectCountHistogram[item.subjectCount] ?? 0) + 1;
    primarySubjectHistogram[item.primarySubject] = (primarySubjectHistogram[item.primarySubject] ?? 0) + 1;
    for (const clause of item.clauses) {
      if (clause.kind === 'formula') formulaUsage[clause.source] = (formulaUsage[clause.source] ?? 0) + 1;
    }
  }
  const duplicatePrompts = [...promptCounts.values()].filter((count) => count > 1).length;

  return {
    ok: issues.length === 0,
    items: items.length,
    files: FILE_COUNT,
    issues,
    enumeration: { clauses: enumeratedClauses, steps: enumeratedSteps, budget: budgetTotal },
    duplicatePrompts,
    answerHistogram,
    subjectCountHistogram,
    primarySubjectHistogram,
    formulaUsage,
  };
}

/** Whole-space check used by tests: table total vs a fresh full enumeration (slow). */
export function fullSpaceEnumeration(predicate: Predicate): number {
  return enumerateCount(predicate, 1, SPACE_MAX);
}

/** Range helper re-exported so tests can build block-aligned ranges. */
export function rangeOf(fromBlock: number, span: number): readonly [number, number] {
  const [from, to] = blockRangeFor(fromBlock, span);
  return [from * BLOCK_SIZE + 1, (to + 1) * BLOCK_SIZE];
}

export function getFormulaById(id: string): { value: number } {
  return getFormula(id);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

function main(): void {
  let dir = defaultOutDir2();
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--dir' && process.argv[i + 1]) dir = path.resolve(process.argv[i + 1]!);
  }
  const started = Date.now();
  const engine = validateEngine();
  const bank = validateBank2(dir);
  console.log(`world-v2 validate: ${dir}`);
  for (const check of engine.checks) console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
  console.log(`  items: ${bank.items} in ${bank.files} files`);
  console.log(`  direct enumeration re-checked ${bank.enumeration.clauses} count clauses (${bank.enumeration.steps} steps)`);
  console.log(`  answer positions: ${bank.answerHistogram.join(' / ')}`);
  console.log(`  subject counts: ${JSON.stringify(bank.subjectCountHistogram)}`);
  console.log(`  primary subjects: ${JSON.stringify(bank.primarySubjectHistogram)}`);
  console.log(`  duplicate prompts: ${bank.duplicatePrompts}`);
  if (bank.issues.length > 0) {
    for (const issue of bank.issues.slice(0, 20)) console.log(`  FAIL ${issue.id}: ${issue.problem}`);
    console.log(`  … ${bank.issues.length} issue(s) total`);
  }
  const ok = engine.ok && bank.ok;
  console.log(`validate ${ok ? 'PASSED' : 'FAILED'} in ${Date.now() - started} ms`);
  process.exit(ok ? 0 : 1);
}

if (isMainModule()) main();
