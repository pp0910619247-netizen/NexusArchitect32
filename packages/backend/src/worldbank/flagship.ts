// SPDX-License-Identifier: MIT
/**
 * wk-000001 - the flagship human-impossible opener.
 *
 * Five chained layers (math -> geography -> ict -> science -> philosophy):
 * every layer is elementary alone, but the finale cannot be graded unless ALL
 * previous layers resolve correctly AND the test-taker knows four extra world
 * facts. Distractors are engineered for the exact failure modes of reasoners
 * (human or model): dropped layers, unit slips, and truth-value confusions.
 *
 * Deterministic: fixed content, no RNG, same JSONL schema as every item.
 */

import type { Pair } from './facts.js';
import type { WorldQuestion } from './compose.js';

/** Roman numeral encoder (L1: math) - valid 1..3999. */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3_999) throw new Error('ROMAN_OUT_OF_RANGE');
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = n;
  let out = '';
  for (const [value, symbol] of table) {
    while (remaining >= value) {
      out += symbol;
      remaining -= value;
    }
  }
  return out;
}

/** Minimum bits to encode n distinct values (L3: ict); valid n >= 1. */
export function bitsNeeded(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('BITS_OUT_OF_RANGE');
  let bits = 0;
  let capacity = 1;
  while (capacity < n) {
    capacity *= 2;
    bits += 1;
  }
  return bits;
}

const PAIR = (th: string, en: string): Pair => ({ th, en });

/** The flagship question (wk-000001). */
export function flagshipQuestion(): WorldQuestion {
  // L1 (math): 3^7 = 2187 -> MMCLXXXVII (MM + C + LXXX + VII)
  // L2 (geography): the named river = the Nile
  // L3 (ict): bits needed to encode 16 values = 4
  // L4 (science): nitrogen ~78% of Earth's atmosphere
  // L5 (philosophy): truth values of P and Q
  const prompt: Pair = PAIR(
    'ตอบครบทุกชั้นแล้วเลือกข้อถูก: (1) 3 ยกกำลัง 7 เป็นเลขโรมันใด (2) แม่น้ำที่ไหลขึ้นเหนือลงทะเลเมดิเตอร์เรเนียนที่อียิปต์ (3) เข้ารหัส 16 ค่าต้องใช้อย่างน้อยกี่บิต (4) แก๊สราว 78% ของบรรยากาศโลกคือธาตุใด (5) ตัดสินค่าจริง P "แม่น้ำข้อ 2 ไหลผ่านทะเลทรายซาฮารา" และ Q "แม่น้ำทุกสายอยู่ในแอฟริกา"',
    'Answer every layer: (1) 3^7 as a Roman numeral; (2) the river flowing north into the Mediterranean at Egypt; (3) minimum bits to encode 16 values; (4) the gas that is ~78% of Earth\'s atmosphere; (5) judge P "the river from (2) crosses the Sahara" and Q "every river on Earth is in Africa".',
  );
  const options: [string, string, string, string] = [
    'P เป็นจริง และ Q เป็นเท็จ (MMCLXXXVII · แม่น้ำไนล์ · 4 บิต · ไนโตรเจน)',
    'P และ Q เป็นจริงทั้งคู่ (MMCLXXXVII · แม่น้ำไนล์ · 3 บิต · ไนโตรเจน)',
    'P เป็นเท็จ และ Q เป็นจริง (MDCCCLXXXVII · แม่น้ำคองโก · 4 บิต · ออกซิเจน)',
    'P และ Q เป็นเท็จทั้งคู่ (MCLXXXVII · แม่น้ำไนล์ · 5 บิต · อาร์กอน)',
  ];
  const optionsEn: [string, string, string, string] = [
    'P true, Q false (MMCLXXXVII · the Nile · 4 bits · nitrogen)',
    'P and Q both true (MMCLXXXVII · the Nile · 3 bits · nitrogen)',
    'P false, Q true (MDCCCLXXXVII · the Congo · 4 bits · oxygen)',
    'P and Q both false (MCLXXXVII · the Nile · 5 bits · argon)',
  ];
  void optionsEn; // JSONL carries the Thai option strings; EN pairs live in the bank for the app layer
  return {
    id: 'wk-000001',
    disciplines: ['philosophy', 'math', 'ict', 'science'],
    primaryDiscipline: 'philosophy',
    subjectCount: 4,
    difficulty: 10,
    prompt,
    options,
    answerIndex: 0,
    explanation: PAIR(
      'ไล่ลำดับ: 2187 = MMCLXXXVII (2000 + 100 + 80 + 7) · แม่น้ำไนล์ · 4 บิต (2^4 = 16) · ไนโตรเจน · P เป็นจริง (ไนล์ไหลผ่านภูมิภาคซาฮารา) และ Q เป็นเท็จ (แอมะซอนเป็นตัวอย่างแย้ง)',
      'Chain: 2187 = MMCLXXXVII (2000 + 100 + 80 + 7) · the Nile · 4 bits (2^4 = 16) · nitrogen · P is true (the Nile crosses the Sahara region) and Q is false (the Amazon is a counterexample).',
    ),
    tags: ['roman-numerals', 'rivers', 'bits', 'logic'],
    verifiedYear: 2026,
  };
}
