// SPDX-License-Identifier: MIT
/**
 * world-v2 numeric engine — the "AI must search 1…10,000,000" core.
 *
 * Every count answer is the number of integers inside a declared block range
 * that satisfy a declared predicate. The block table below is built by walking
 * the ENTIRE space 1…10,000,000 once (complete enumeration), so the counts are
 * exact. `enumerateCount` re-derives any range with a fresh direct loop, which
 * is what the validator uses to check the table instead of trusting it.
 *
 * Predicates are arithmetic only (no strings, no locale, no clock): identical
 * results on every machine and every run.
 */

import { BLOCK_COUNT, BLOCK_SIZE, SPACE_MAX, SPACE_MIN } from './schema.js';

export const PREDICATES = [
  'prime',
  'digitSumPrime',
  'palindrome',
  'coprimeWith360',
  'popcountPrime',
  'multipleOf77',
  'hexHasLetter',
  'noZeroDigit',
] as const;

export type Predicate = (typeof PREDICATES)[number];

export interface PredicateMeta {
  /** Subjects that can natively use this counting clause. */
  readonly subjects: readonly string[];
  readonly text: {
    readonly th: string; // uses {from} and {to}
    readonly en: string;
  };
  /** Small plausible offsets used to build the wrong options. */
  readonly distractors: readonly number[];
  /** Method note shown in the explanation. */
  readonly method: { readonly th: string; readonly en: string };
}

const COUNT_METHOD = {
  th: 'นับทุกจำนวนเต็มในช่วงที่ระบุด้วยการตรวจครบทั้งช่วง (complete enumeration)',
  en: 'counted every integer in the declared range with a complete enumeration',
} as const;

export const PREDICATE_META: Readonly<Record<Predicate, PredicateMeta>> = Object.freeze({
  prime: {
    subjects: ['math', 'computing', 'physics'],
    text: {
      th: 'จำนวนเฉพาะ n ในช่วง {from} ถึง {to}',
      en: 'number of primes n in [{from}, {to}]',
    },
    distractors: [7, -13, 101],
    method: COUNT_METHOD,
  },
  digitSumPrime: {
    subjects: ['math', 'philosophyLogic'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่ผลรวมเลขโดดเป็นจำนวนเฉพาะ',
      en: 'number of n in [{from}, {to}] whose digit sum is prime',
    },
    distractors: [11, -29, 53],
    method: COUNT_METHOD,
  },
  palindrome: {
    subjects: ['artsLanguage', 'math'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่อ่านกลับหลังได้เหมือนเดิม',
      en: 'number of palindromic n in [{from}, {to}]',
    },
    distractors: [9, -17, 41],
    method: COUNT_METHOD,
  },
  coprimeWith360: {
    subjects: ['economics', 'engineering', 'math'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่ไม่มีตัวประกอบร่วมกับ 360',
      en: 'number of n in [{from}, {to}] coprime with 360',
    },
    distractors: [60, -120, 240],
    method: COUNT_METHOD,
  },
  popcountPrime: {
    subjects: ['computing', 'engineering', 'physics'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่จำนวนบิต 1 ในเลขฐานสองเป็นจำนวนเฉพาะ',
      en: 'number of n in [{from}, {to}] whose binary 1-bit count is prime',
    },
    distractors: [64, -128, 256],
    method: COUNT_METHOD,
  },
  multipleOf77: {
    subjects: ['economics', 'math'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่เป็นพหุคูณของ 77',
      en: 'number of n in [{from}, {to}] that are multiples of 77',
    },
    distractors: [13, -77, 154],
    method: COUNT_METHOD,
  },
  hexHasLetter: {
    subjects: ['computing'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่เลขฐานสิบหกมีตัวอักษร A–F',
      en: 'number of n in [{from}, {to}] whose hexadecimal form contains A–F',
    },
    distractors: [512, -1024, 2048],
    method: COUNT_METHOD,
  },
  noZeroDigit: {
    subjects: ['computing', 'artsLanguage'],
    text: {
      th: 'จำนวน n ในช่วง {from} ถึง {to} ที่ไม่มีเลข 0 ในหลักใดเลย',
      en: 'number of n in [{from}, {to}] with no zero digit at all',
    },
    distractors: [81, -243, 729],
    method: COUNT_METHOD,
  },
});

/** Appends the thousands separators used in both languages. */
export function formatNumber(value: number): string {
  const text = String(Math.trunc(value));
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const fromEnd = text.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += ',';
    out += text[i];
  }
  return out;
}

function digitSum(value: number): number {
  let sum = 0;
  let rest = value;
  while (rest > 0) {
    sum += rest % 10;
    rest = Math.floor(rest / 10);
  }
  return sum;
}

function isSmallPrime(value: number): boolean {
  if (value < 2) return false;
  for (let i = 2; i * i <= value; i += 1) if (value % i === 0) return false;
  return true;
}

function isPalindrome(value: number): boolean {
  let rest = value;
  let reversed = 0;
  while (rest > 0) {
    reversed = reversed * 10 + (rest % 10);
    rest = Math.floor(rest / 10);
  }
  return reversed === value;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function popcount(value: number): number {
  let bits = 0;
  let rest = value;
  while (rest > 0) {
    bits += rest & 1;
    rest >>>= 1;
  }
  return bits;
}

function hexHasLetter(value: number): boolean {
  let rest = value;
  while (rest > 0) {
    if (rest % 16 > 9) return true;
    rest = Math.floor(rest / 16);
  }
  return false;
}

function hasZeroDigit(value: number): boolean {
  let rest = value;
  while (rest > 0) {
    if (rest % 10 === 0 && rest >= 10) return true;
    rest = Math.floor(rest / 10);
  }
  return false;
}

/** Single-number predicate check (exported for the validator and tests). */
export function predicateOf(value: number, predicate: Predicate): boolean {
  switch (predicate) {
    case 'prime':
      return value >= 2 && !isComposite(value);
    case 'digitSumPrime':
      return isSmallPrime(digitSum(value));
    case 'palindrome':
      return isPalindrome(value);
    case 'coprimeWith360':
      return gcd(value, 360) === 1;
    case 'popcountPrime':
      return isSmallPrime(popcount(value));
    case 'multipleOf77':
      return value % 77 === 0;
    case 'hexHasLetter':
      return hexHasLetter(value);
    case 'noZeroDigit':
      return value > 0 && !hasZeroDigit(value);
    default:
      throw new Error(`UNKNOWN_PREDICATE:${String(predicate)}`);
  }
}

let primeSieve: Uint8Array | null = null;

/** 0 = prime, 1 = composite for n ≥ 2 (indices 0/1 are left as 1). */
function sieve(max: number): Uint8Array {
  if (primeSieve !== null && primeSieve.length >= max + 1) return primeSieve;
  const flags = new Uint8Array(max + 1);
  flags[0] = 1;
  flags[1] = 1;
  for (let i = 2; i * i <= max; i += 1) {
    if (flags[i] === 0) {
      for (let j = i * i; j <= max; j += i) flags[j] = 1;
    }
  }
  primeSieve = flags;
  return flags;
}

function isComposite(value: number): boolean {
  if (value <= SPACE_MAX) {
    const flags = sieve(SPACE_MAX);
    return flags[value] === 1;
  }
  for (let i = 2; i * i <= value; i += 1) if (value % i === 0) return true;
  return false;
}

export interface BlockTable {
  readonly max: number;
  readonly blockSize: number;
  readonly blockCount: number;
  readonly counts: ReadonlyMap<Predicate, Uint32Array>;
}

let blockTable: BlockTable | null = null;

/** Walks 1…max once and counts every predicate per block. */
export function buildBlockTable(max: number = SPACE_MAX, blockSize: number = BLOCK_SIZE): BlockTable {
  const blockCount = Math.ceil(max / blockSize);
  const counts = new Map<Predicate, Uint32Array>();
  for (const predicate of PREDICATES) counts.set(predicate, new Uint32Array(blockCount));
  const primes = sieve(max);
  const bump = (predicate: Predicate, block: number, hit: boolean): void => {
    if (!hit) return;
    const array = counts.get(predicate)!;
    array[block] = (array[block] ?? 0) + 1;
  };
  for (let n = SPACE_MIN; n <= max; n += 1) {
    const block = Math.floor((n - 1) / blockSize);
    bump('prime', block, primes[n] === 0);
    bump('digitSumPrime', block, isSmallPrime(digitSum(n)));
    bump('palindrome', block, isPalindrome(n));
    bump('coprimeWith360', block, gcd(n, 360) === 1);
    bump('popcountPrime', block, isSmallPrime(popcount(n)));
    bump('multipleOf77', block, n % 77 === 0);
    bump('hexHasLetter', block, hexHasLetter(n));
    bump('noZeroDigit', block, !hasZeroDigit(n));
  }
  return { max, blockSize, blockCount, counts };
}

export function spaceTable(): BlockTable {
  if (blockTable === null || blockTable.max !== SPACE_MAX) blockTable = buildBlockTable(SPACE_MAX, BLOCK_SIZE);
  return blockTable;
}

/** Exact count for whole blocks from…to (inclusive) inside the 1…10,000,000 space. */
export function countBlocks(predicate: Predicate, fromBlock: number, toBlock: number, table: BlockTable = spaceTable()): number {
  if (fromBlock < 0 || toBlock >= table.blockCount || fromBlock > toBlock) {
    throw new Error(`BAD_BLOCK_RANGE:${fromBlock}:${toBlock}`);
  }
  const counts = table.counts.get(predicate)!;
  let total = 0;
  for (let block = fromBlock; block <= toBlock; block += 1) total += counts[block]!;
  return total;
}

/** Fresh direct enumeration of [from, to] — the independent check used by validation. */
export function enumerateCount(predicate: Predicate, from: number, to: number): number {
  let total = 0;
  for (let n = from; n <= to; n += 1) if (predicateOf(n, predicate)) total += 1;
  return total;
}

/** Latin-square style range seconds: the two directions used for count clauses. */
export function blockRangeFor(fromBlock: number, blocks: number): readonly [number, number] {
  return [fromBlock, fromBlock + blocks - 1];
}

/** Highest block index that still keeps [fromBlock, fromBlock + span - 1] inside the space. */
export function maxStartBlock(span: number): number {
  if (span < 1 || span > BLOCK_COUNT) throw new Error(`BAD_SPAN:${span}`);
  return BLOCK_COUNT - span;
}
