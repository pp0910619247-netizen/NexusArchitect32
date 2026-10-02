// SPDX-License-Identifier: MIT
/**
 * world-v2 derived clause sources — one integer per clause, produced either by
 * a written definition, by pure combinatorics, by a count that the engine can
 * re-derive (primes below one million), or by a standard constant that is
 * declared here once and re-checked by the validator.
 *
 * Every value lives inside the 1…10,000,000 space, and every source ships three
 * plausible wrong values, so a composer never has to invent a distractor.
 */

import type { Bilingual } from './schema.js';

export type FormulaKind = 'definition' | 'combinatorial' | 'computed' | 'standard-constant';

export interface FormulaSource {
  readonly id: string;
  /** Subjects that can natively use this clause. */
  readonly subjects: readonly string[];
  readonly kind: FormulaKind;
  readonly value: number;
  readonly unit?: Bilingual;
  readonly text: Bilingual;
  readonly method: Bilingual;
  /** Three wrong values that look plausible next to `value`. */
  readonly distractors: readonly number[];
}

const METHOD_DEFINITION: Bilingual = {
  th: 'คำนวณจากนิยามของหน่วย/ปริมาณนั้นโดยตรง',
  en: 'computed straight from the definition of that unit or quantity',
};
const METHOD_COMBINATORIAL: Bilingual = {
  th: 'คำนวณจากจำนวนชุดค่าที่เป็นไปได้ทั้งหมด (combinatorial count)',
  en: 'computed as the number of possible combinations (combinatorial count)',
};
const METHOD_STANDARD: Bilingual = {
  th: 'ค่ามาตรฐานที่ประกาศไว้ในตารางนี้ และตัวตรวจสอบคำนวณซ้ำได้ทุกครั้ง',
  en: 'a standard value declared in this table and re-derived by the validator on every run',
};

/** Counts primes below `limit` by sieving every integer below it. */
export function countPrimesBelow(limit: number): number {
  const flags = new Uint8Array(limit);
  for (let i = 2; i < limit; i += 1) {
    if (flags[i] === 0) for (let j = i * i; j < limit; j += i) flags[j] = 1;
  }
  let total = 0;
  for (let i = 2; i < limit; i += 1) if (flags[i] === 0) total += 1;
  return total;
}

function secondsPerDay(days: number): number {
  return days * 24 * 60 * 60;
}

export const FORMULAS: readonly FormulaSource[] = Object.freeze([
  // ---------------------------------------------------------------- physics
  {
    id: 'standardGravityCmS2',
    subjects: ['physics'],
    kind: 'definition',
    value: Math.round(9.80665 * 100),
    unit: { th: 'ซม./วินาที²', en: 'cm/s²' },
    text: { th: 'ความเร่งโน้มถ่วงมาตรฐาน (ซม./วินาที²)', en: 'standard gravity (cm/s²)' },
    method: METHOD_DEFINITION,
    distractors: [980, 982, 1000],
  },
  {
    id: 'lightSecondKm',
    subjects: ['physics'],
    kind: 'definition',
    value: Math.round(299_792.458),
    unit: { th: 'กม.', en: 'km' },
    text: { th: 'ระยะทางที่แสงเดินทางใน 1 วินาที (กม.)', en: 'distance light travels in one second (km)' },
    method: METHOD_DEFINITION,
    distractors: [299_458, 300_000, 149_896],
  },
  {
    id: 'astronomicalUnitLightSeconds',
    subjects: ['physics'],
    kind: 'definition',
    value: Math.round((149_597_870.7 * 1_000) / 299_792_458),
    unit: { th: 'วินาที', en: 'seconds' },
    text: { th: 'เวลาที่แสงใช้เดินทาง 1 หน่วยดาราศาสตร์ (วินาที)', en: 'time light needs for one astronomical unit (seconds)' },
    method: METHOD_DEFINITION,
    distractors: [500, 498, 300],
  },

  // -------------------------------------------------------------- chemistry
  {
    id: 'waterMolarMassMilli',
    subjects: ['chemistry'],
    kind: 'standard-constant',
    value: 18_015,
    unit: { th: 'มก./โมล', en: 'mg/mol' },
    text: { th: 'มวลโมลาร์ของน้ำ (มก./โมล)', en: 'molar mass of water (mg/mol)' },
    method: METHOD_STANDARD,
    distractors: [18_016, 18_000, 180_150],
  },
  {
    id: 'carbonDioxideMolarMassMilli',
    subjects: ['chemistry'],
    kind: 'standard-constant',
    value: 44_009,
    unit: { th: 'มก./โมล', en: 'mg/mol' },
    text: { th: 'มวลโมลาร์ของคาร์บอนไดออกไซด์ (มก./โมล)', en: 'molar mass of carbon dioxide (mg/mol)' },
    method: METHOD_STANDARD,
    distractors: [44_008, 44_000, 440_090],
  },
  {
    id: 'sodiumChlorideMolarMassMilli',
    subjects: ['chemistry'],
    kind: 'standard-constant',
    value: 58_440,
    unit: { th: 'มก./โมล', en: 'mg/mol' },
    text: { th: 'มวลโมลาร์ของโซเดียมคลอไรด์ (มก./โมล)', en: 'molar mass of sodium chloride (mg/mol)' },
    method: METHOD_STANDARD,
    distractors: [58_439, 58_400, 584_400],
  },

  // ---------------------------------------------------------------- biology
  {
    id: 'codonSpace',
    subjects: ['biology'],
    kind: 'combinatorial',
    value: 4 ** 3,
    unit: { th: 'แบบ', en: 'codons' },
    text: { th: 'จำนวนรหัสพันธุกรรม 3 ตัวอักษรที่เป็นไปได้จาก 4 เบส', en: 'possible three-letter codons over four bases' },
    method: METHOD_COMBINATORIAL,
    distractors: [16, 32, 256],
  },
  {
    id: 'twoBaseWords',
    subjects: ['biology'],
    kind: 'combinatorial',
    value: 4 ** 2,
    unit: { th: 'แบบ', en: 'words' },
    text: { th: 'จำนวนรหัส 2 ตัวอักษรที่เป็นไปได้จาก 4 เบส', en: 'possible two-letter words over four bases' },
    method: METHOD_COMBINATORIAL,
    distractors: [8, 24, 64],
  },
  {
    id: 'binaryTraitCombinations',
    subjects: ['biology'],
    kind: 'combinatorial',
    value: 2 ** 7,
    unit: { th: 'แบบ', en: 'combinations' },
    text: { th: 'จำนวนชุดของลักษณะเด่น–ด้อย 7 ยีน', en: 'combinations of dominant/recessive outcomes for 7 genes' },
    method: METHOD_COMBINATORIAL,
    distractors: [64, 127, 256],
  },

  // ------------------------------------------------------------------- math
  {
    id: 'primesBelowMillion',
    subjects: ['math'],
    kind: 'computed',
    value: countPrimesBelow(1_000_000),
    unit: { th: 'จำนวน', en: 'primes' },
    text: { th: 'จำนวนเฉพาะที่น้อยกว่า 1,000,000', en: 'primes below 1,000,000' },
    method: {
      th: 'ไล่ตรวจทุกจำนวนที่น้อยกว่า 1,000,000 แล้วนับ (complete enumeration)',
      en: 'sieved every integer below 1,000,000 and counted them (complete enumeration)',
    },
    distractors: [78_497, 78_496, 78_500],
  },
  {
    id: 'squaresBelowMillion',
    subjects: ['math'],
    kind: 'computed',
    value: Math.floor(Math.sqrt(999_999)),
    text: { th: 'จำนวนกำลังสองสมบูรณ์ที่น้อยกว่า 1,000,000', en: 'perfect squares below 1,000,000' },
    method: METHOD_COMBINATORIAL,
    distractors: [998, 1000, 1001],
  },
  {
    id: 'triangularBelowMillion',
    subjects: ['math'],
    kind: 'computed',
    value: Math.floor((Math.sqrt(8 * 1_000_000 + 1) - 1) / 2),
    text: { th: 'จำนวนจำนวนสามเหลี่ยมที่น้อยกว่า 1,000,000', en: 'triangular numbers below 1,000,000' },
    method: METHOD_COMBINATORIAL,
    distractors: [1412, 1414, 1415],
  },

  // -------------------------------------------------------------- computing
  {
    id: 'unicodeCodePointCount',
    subjects: ['computing'],
    kind: 'definition',
    value: 17 * 65_536,
    unit: { th: 'รหัส', en: 'code points' },
    text: { th: 'จำนวนรหัสอักขระที่ช่วง Unicode กำหนดไว้ (U+0000–U+10FFFF)', en: 'code points the Unicode range allows (U+0000–U+10FFFF)' },
    method: METHOD_DEFINITION,
    distractors: [1_114_111, 1_114_113, 1_100_000],
  },
  {
    id: 'bytesInMebibyte',
    subjects: ['computing'],
    kind: 'definition',
    value: 2 ** 20,
    unit: { th: 'ไบต์', en: 'bytes' },
    text: { th: 'จำนวนไบต์ใน 1 เมบิไบต์', en: 'bytes in one mebibyte' },
    method: METHOD_DEFINITION,
    distractors: [1_000_000, 1_048_575, 1_024_000],
  },
  {
    id: 'twoToSixteen',
    subjects: ['computing'],
    kind: 'combinatorial',
    value: 2 ** 16,
    unit: { th: 'ค่า', en: 'values' },
    text: { th: 'จำนวนค่าที่ต่างกันได้ของข้อมูล 16 บิต', en: 'distinct values of a 16-bit word' },
    method: METHOD_COMBINATORIAL,
    distractors: [32_768, 65_535, 65_537],
  },

  // ------------------------------------------------------------ engineering
  {
    id: 'metersPerMile',
    subjects: ['engineering'],
    kind: 'standard-constant',
    value: Math.round(1_609.344),
    unit: { th: 'ม.', en: 'm' },
    text: { th: 'จำนวนเมตรใน 1 ไมล์สากล', en: 'meters in one international mile' },
    method: METHOD_STANDARD,
    distractors: [1_608, 1_600, 1_610],
  },
  {
    id: 'celsiusOffsetMilli',
    subjects: ['engineering'],
    kind: 'definition',
    value: Math.round(273.15 * 1_000),
    unit: { th: 'มิลลิเคลวิน', en: 'mK' },
    text: { th: 'จุดเยือกแข็งของน้ำในหน่วยเคลวิน (มิลลิเคลวิน)', en: 'freezing point of water in kelvin (mK)' },
    method: METHOD_DEFINITION,
    distractors: [273_000, 273_160, 273_140],
  },
  {
    id: 'wattHoursPerKiloWattHour',
    subjects: ['engineering'],
    kind: 'definition',
    value: 1_000,
    unit: { th: 'วัตต์-ชั่วโมง', en: 'Wh' },
    text: { th: 'จำนวนวัตต์-ชั่วโมงใน 1 กิโลวัตต์-ชั่วโมง', en: 'watt-hours in one kilowatt-hour' },
    method: METHOD_DEFINITION,
    distractors: [100, 10_000, 999],
  },

  // ------------------------------------------------------------- earthSpace
  {
    id: 'earthMeanRadiusKm',
    subjects: ['earthSpace'],
    kind: 'standard-constant',
    value: 6_371,
    unit: { th: 'กม.', en: 'km' },
    text: { th: 'รัศมีเฉลี่ยของโลก (กม.)', en: 'mean radius of Earth (km)' },
    method: METHOD_STANDARD,
    distractors: [6_370, 6_372, 6_400],
  },
  {
    id: 'moonMeanDistanceKm',
    subjects: ['earthSpace'],
    kind: 'standard-constant',
    value: 384_400,
    unit: { th: 'กม.', en: 'km' },
    text: { th: 'ระยะห่างเฉลี่ยโลก–ดวงจันทร์ (กม.)', en: 'mean Earth–Moon distance (km)' },
    method: METHOD_STANDARD,
    distractors: [384_399, 384_000, 385_000],
  },
  {
    id: 'earthSolarDaySeconds',
    subjects: ['earthSpace'],
    kind: 'definition',
    value: secondsPerDay(1),
    unit: { th: 'วินาที', en: 'seconds' },
    text: { th: 'จำนวนวินาทีใน 1 วันสุริยะเฉลี่ย', en: 'seconds in one mean solar day' },
    method: METHOD_DEFINITION,
    distractors: [86_401, 86_164, 8_640],
  },

  // --------------------------------------------------------------- medicine
  {
    id: 'adultBones',
    subjects: ['medicine'],
    kind: 'standard-constant',
    value: 206,
    unit: { th: 'ชิ้น', en: 'bones' },
    text: { th: 'จำนวนกระดูกในร่างกายผู้ใหญ่', en: 'bones in the adult human body' },
    method: METHOD_STANDARD,
    distractors: [205, 207, 300],
  },
  {
    id: 'adultTeeth',
    subjects: ['medicine'],
    kind: 'standard-constant',
    value: 32,
    unit: { th: 'ซี่', en: 'teeth' },
    text: { th: 'จำนวนฟันแท้เต็มชุดของผู้ใหญ่', en: 'teeth in a full adult set' },
    method: METHOD_STANDARD,
    distractors: [28, 30, 36],
  },
  {
    id: 'secondsInNinetyMinutes',
    subjects: ['medicine'],
    kind: 'definition',
    value: 90 * 60,
    unit: { th: 'วินาที', en: 'seconds' },
    text: { th: 'จำนวนวินาทีใน 90 นาที', en: 'seconds in ninety minutes' },
    method: METHOD_DEFINITION,
    distractors: [5_401, 54_000, 5_900],
  },

  // -------------------------------------------------------------- economics
  {
    id: 'partsPerMillionInPercent',
    subjects: ['economics'],
    kind: 'definition',
    value: 10_000,
    unit: { th: 'ส่วนในล้าน', en: 'ppm' },
    text: { th: 'จำนวนส่วนในล้านที่เท่ากับ 1 เปอร์เซ็นต์', en: 'parts per million in one percent' },
    method: METHOD_DEFINITION,
    distractors: [1_000, 100, 100_000],
  },
  {
    id: 'basisPointsInPercent',
    subjects: ['economics'],
    kind: 'definition',
    value: 100,
    unit: { th: 'เบซิสพอยต์', en: 'basis points' },
    text: { th: 'จำนวนเบซิสพอยต์ใน 1 เปอร์เซ็นต์', en: 'basis points in one percent' },
    method: METHOD_DEFINITION,
    distractors: [10, 1_000, 10_000],
  },
  {
    id: 'secondsInThirtyDays',
    subjects: ['economics'],
    kind: 'definition',
    value: secondsPerDay(30),
    unit: { th: 'วินาที', en: 'seconds' },
    text: { th: 'จำนวนวินาทีใน 30 วัน (ใช้เป็นฐานของรอบบิล)', en: 'seconds in thirty days (a common billing base)' },
    method: METHOD_DEFINITION,
    distractors: [2_591_999, 2_592_001, 2_678_400],
  },

  // ---------------------------------------------------------- socialHistory
  {
    id: 'sukhothaiStartYear',
    subjects: ['socialHistory'],
    kind: 'standard-constant',
    value: 1_238,
    unit: { th: 'ปี ค.ศ.', en: 'CE' },
    text: { th: 'ปีเริ่มต้นของอาณาจักรสุโขทัย', en: 'start year of the Sukhothai kingdom' },
    method: METHOD_STANDARD,
    distractors: [1_237, 1_350, 1_767],
  },
  {
    id: 'thaiConstitutionYear',
    subjects: ['socialHistory'],
    kind: 'standard-constant',
    value: 1_932,
    unit: { th: 'ปี ค.ศ.', en: 'CE' },
    text: { th: 'ปีที่ไทยมีรัฐธรรมนูญฉบับแรก', en: 'year of Thailand’s first constitution' },
    method: METHOD_STANDARD,
    distractors: [1_933, 1_931, 2_475],
  },
  {
    id: 'unitedNationsYear',
    subjects: ['socialHistory'],
    kind: 'standard-constant',
    value: 1_945,
    unit: { th: 'ปี ค.ศ.', en: 'CE' },
    text: { th: 'ปีที่ก่อตั้งสหประชาชาติ', en: 'founding year of the United Nations' },
    method: METHOD_STANDARD,
    distractors: [1_944, 1_946, 1_919],
  },

  // -------------------------------------------------------- philosophyLogic
  {
    id: 'truthTableRowsFourVariables',
    subjects: ['philosophyLogic'],
    kind: 'combinatorial',
    value: 2 ** 4,
    unit: { th: 'แถว', en: 'rows' },
    text: { th: 'จำนวนแถวของตารางความจริงที่มี 4 ตัวแปร', en: 'rows in a truth table with four variables' },
    method: METHOD_COMBINATORIAL,
    distractors: [8, 32, 64],
  },
  {
    id: 'truthTableRowsTwelveVariables',
    subjects: ['philosophyLogic'],
    kind: 'combinatorial',
    value: 2 ** 12,
    unit: { th: 'แถว', en: 'rows' },
    text: { th: 'จำนวนแถวของตารางความจริงที่มี 12 ตัวแปร', en: 'rows in a truth table with twelve variables' },
    method: METHOD_COMBINATORIAL,
    distractors: [2_048, 8_192, 4_095],
  },
  {
    id: 'permutationsOfEight',
    subjects: ['philosophyLogic'],
    kind: 'combinatorial',
    value: 40_320,
    unit: { th: 'แบบ', en: 'arrangements' },
    text: { th: 'จำนวนการสลับลำดับของ 8 สิ่งที่ต่างกัน', en: 'distinct orderings of eight distinct things' },
    method: METHOD_COMBINATORIAL,
    distractors: [40_319, 40_321, 362_880],
  },

  // ------------------------------------------------------------ artsLanguage
  {
    id: 'thaiConsonants',
    subjects: ['artsLanguage'],
    kind: 'standard-constant',
    value: 44,
    unit: { th: 'ตัว', en: 'letters' },
    text: { th: 'จำนวนพยัญชนะไทย', en: 'Thai consonant letters' },
    method: METHOD_STANDARD,
    distractors: [42, 45, 46],
  },
  {
    id: 'basicLatinLetters',
    subjects: ['artsLanguage'],
    kind: 'standard-constant',
    value: 26,
    unit: { th: 'ตัว', en: 'letters' },
    text: { th: 'จำนวนตัวอักษรละตินพื้นฐาน', en: 'basic Latin letters' },
    method: METHOD_STANDARD,
    distractors: [24, 25, 27],
  },
  {
    id: 'pianoKeys',
    subjects: ['artsLanguage'],
    kind: 'standard-constant',
    value: 88,
    unit: { th: 'คีย์', en: 'keys' },
    text: { th: 'จำนวนคีย์ของเปียโนมาตรฐาน', en: 'keys on a standard piano' },
    method: METHOD_STANDARD,
    distractors: [87, 61, 76],
  },
]);

const BY_SUBJECT = new Map<string, FormulaSource[]>();
for (const formula of FORMULAS) {
  for (const subject of formula.subjects) {
    const list = BY_SUBJECT.get(subject) ?? [];
    list.push(formula);
    BY_SUBJECT.set(subject, list);
  }
}

/** Formula sources that natively belong to `subject`. */
export function formulasForSubject(subject: string): readonly FormulaSource[] {
  return BY_SUBJECT.get(subject) ?? [];
}

export function getFormula(id: string): FormulaSource {
  const found = FORMULAS.find((formula) => formula.id === id);
  if (found === undefined) throw new Error(`UNKNOWN_FORMULA:${id}`);
  return found;
}
