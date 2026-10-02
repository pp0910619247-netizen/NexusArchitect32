// SPDX-License-Identifier: MIT
/**
 * world-v2 composer — turns one ladder plan into one fully verifiable item.
 *
 * Every item is a tuple of `subjectCount` clauses (4…12), one clause per
 * subject. Each clause carries an integer answer inside the 1…10,000,000 space,
 * plus the provenance the validator needs to recompute it. The four options are
 * number sequences: exactly one is right in every clause, the others are wrong
 * in 1, 2 and 3 clauses respectively.
 *
 * Deterministic by construction: a pure function of (index, ladder state).
 */

import {
  BLOCK_COUNT,
  BLOCK_SIZE,
  SPACE_MAX,
  VERIFIED_YEAR,
  itemId,
  type Bilingual,
  type Clause,
  type OptionSet,
  type WorldQuestionV2,
} from './schema.js';
import { formatNumber, PREDICATE_META, PREDICATES, countBlocks, maxStartBlock, type Predicate } from './numeric.js';
import { formulasForSubject, type FormulaSource } from './derived.js';
import { mulberry32, mixSeeds, planForIndex2, type Ladder2State } from './ladder.js';
import { SUBJECT_IDS, difficultyForSubjectCount, getSubject } from './subjects.js';

/** Sweeps used by count clauses: 1 block (100,000) up to the whole space. */
export const COUNT_SPANS: readonly number[] = Object.freeze([1, 2, 4, 25, BLOCK_COUNT]);

interface CountCandidate {
  readonly kind: 'count';
  readonly source: Predicate;
  readonly value: number;
  readonly distractors: readonly number[];
  readonly range: readonly [number, number];
  readonly text: Bilingual;
  readonly method: Bilingual;
  readonly unit?: undefined;
}

interface FormulaCandidate {
  readonly kind: 'formula';
  readonly source: string;
  readonly value: number;
  readonly distractors: readonly number[];
  readonly text: Bilingual;
  readonly method: Bilingual;
  readonly unit?: Bilingual;
}

type Candidate = CountCandidate | FormulaCandidate;

interface Selection {
  readonly kind: 'count' | 'formula';
  readonly source: string;
}

/** Candidate sources a subject can use, in a stable order. */
export function sourcesForSubject(subject: string): readonly Selection[] {
  const out: Selection[] = [];
  for (const predicate of PREDICATES) {
    if (PREDICATE_META[predicate].subjects.includes(subject)) out.push({ kind: 'count', source: predicate });
  }
  for (const formula of formulasForSubject(subject)) out.push({ kind: 'formula', source: formula.id });
  return out;
}

/** Materialises one candidate (count clauses draw their block range here). */
export function materializeCandidate(subject: string, selection: Selection, rng: () => number): Candidate {
  if (selection.kind === 'count') {
    const predicate = selection.source as Predicate;
    const meta = PREDICATE_META[predicate];
    const span = COUNT_SPANS[Math.floor(rng() * COUNT_SPANS.length)]!;
    const start = Math.floor(rng() * (maxStartBlock(span) + 1));
    const range: readonly [number, number] = [start * BLOCK_SIZE + 1, (start + span) * BLOCK_SIZE];
    const value = countBlocks(predicate, start, start + span - 1);
    const fill = (lang: 'th' | 'en'): string =>
      meta.text[lang].replace('{from}', formatNumber(range[0])).replace('{to}', formatNumber(range[1]));
    return {
      kind: 'count',
      source: predicate,
      value,
      distractors: meta.distractors.map((delta) => value + delta),
      range,
      text: { th: fill('th'), en: fill('en') },
      method: meta.method,
    };
  }
  const formula = formulasForSubject(subject).find((entry: FormulaSource) => entry.id === selection.source);
  if (formula === undefined) throw new Error(`SOURCE_NOT_FOR_SUBJECT:${subject}:${selection.source}`);
  return {
    kind: 'formula',
    source: formula.id,
    value: formula.value,
    distractors: [...formula.distractors],
    text: formula.text,
    method: formula.method,
    unit: formula.unit,
  };
}

/* * Materialises a candidate that honours the space invariant (value ≥ 1).
 * Some count windows legitimately contain zero hits (e.g. "no zero digit" in
 * 4,000,001…4,100,000), so the range is redrawn instead of publishing a 0.
 */
function materializeValid(subject: string, selection: Selection, rng: () => number): Candidate | null {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = materializeCandidate(subject, selection, rng);
    if (candidate.value >= 1 && candidate.value <= SPACE_MAX) return candidate;
  }
  return null;
}

/** Picks a candidate whose value is not used yet by another clause of the item. */
function pickCandidate(subject: string, rng: () => number, usedValues: ReadonlySet<number>): Candidate {
  const sources = sourcesForSubject(subject);
  if (sources.length === 0) throw new Error(`NO_SOURCE_FOR_SUBJECT:${subject}`);
  const start = Math.floor(rng() * sources.length);
  let fallback: Candidate | null = null;
  for (let step = 0; step < sources.length; step += 1) {
    const candidate = materializeValid(subject, sources[(start + step) % sources.length]!, rng);
    if (candidate === null) continue;
    if (!usedValues.has(candidate.value)) return candidate;
    fallback ??= candidate;
  }
  if (fallback === null) throw new Error(`NO_CANDIDATE:${subject}`);
  return fallback;
}

function renderToken(value: number, unit: Bilingual | undefined, lang: 'th' | 'en'): string {
  const number = formatNumber(value);
  return unit === undefined ? number : `${number} ${unit[lang]}`;
}

/** Deterministic Fisher–Yates over clause indices. */
function permutation(size: number, rng: () => number): number[] {
  const order = Array.from({ length: size }, (_value, index) => index);
  for (let i = size - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

function tokensFor(values: readonly number[], units: readonly (Bilingual | undefined)[], lang: 'th' | 'en'): string[] {
  return values.map((value, index) => renderToken(value, units[index], lang));
}

/** Builds the four option sequences (one correct, three wrong in 1/2/3 clauses). */
export function buildOptions(
  clauses: readonly Clause[],
  answerIndex: number,
  rng: () => number,
): OptionSet {
  const size = clauses.length;
  const correctValues = clauses.map((clause) => clause.value);
  const units = clauses.map((clause) => clause.unit);
  const correctTokens: OptionSet = {
    th: tokensFor(correctValues, units, 'th'),
    en: tokensFor(correctValues, units, 'en'),
  };
  const order = permutation(size, rng);
  const slots: (OptionSet | null)[] = Array.from({ length: 4 }, () => null);
  slots[answerIndex] = correctTokens;
  // Wrong options are off in 1, 2 and 3 clauses — never more, so a distractor
  // cannot be spotted by counting differences.
  const wrongSizes = [1, 2, 3];
  let wrongSeen = 0;
  let cursor = 0;
  for (let option = 0; option < 4; option += 1) {
    if (option === answerIndex) continue;
    const corruptCount = Math.min(wrongSizes[wrongSeen] ?? 1, size);
    wrongSeen += 1;
    const corruptAt = new Set<number>();
    for (let k = 0; k < corruptCount; k += 1) corruptAt.add(order[(cursor + k) % size]!);
    cursor += corruptCount;
    let built: OptionSet | null = null;
    for (let attempt = 0; attempt < 3 && built === null; attempt += 1) {
      const values = correctValues.map((value, index) => {
        if (!corruptAt.has(index)) return value;
        const clause = clauses[index]!;
        return wrongValueFor(clause, attempt);
      });
      const candidate: OptionSet = {
        th: tokensFor(values, units, 'th'),
        en: tokensFor(values, units, 'en'),
      };
      const clashes = slots.some((slot) => slot !== null && sameTokens(slot, candidate));
      if (!clashes) built = candidate;
    }
    if (built === null) throw new Error(`OPTION_COLLISION:${answerIndex}`);
    slots[option] = built;
  }
  const filled = slots.map((slot) => {
    if (slot === null) throw new Error('OPTION_SLOT_EMPTY');
    return slot;
  });
  return {
    th: filled.map((option) => option.th.join(' · ')),
    en: filled.map((option) => option.en.join(' · ')),
  };
}

/** Wrong value for one clause — never equal to the correct one. */
function wrongValueFor(clause: Clause, attempt: number): number {
  const wrong = wrongValuesFor(clause);
  const picked = wrong[attempt % wrong.length]!;
  return picked === clause.value ? clause.value + 1 : picked;
}

function wrongValuesFor(clause: Clause): readonly number[] {
  if (clause.kind === 'count') {
    const meta = PREDICATE_META[clause.source as Predicate];
    return meta.distractors.map((delta) => clause.value + delta);
  }
  const formula = formulasForSubject(clause.subject).find((entry) => entry.id === clause.source);
  if (formula === undefined) throw new Error(`UNKNOWN_CLAUSE_SOURCE:${clause.source}`);
  return formula.distractors;
}

function sameTokens(a: OptionSet, b: OptionSet): boolean {
  return a.th.join('|') === b.th.join('|') && a.en.join('|') === b.en.join('|');
}

/** Composes one full item. */
export function composeQuestion2(index: number, state: Ladder2State): WorldQuestionV2 {
  const plan = planForIndex2(index, SUBJECT_IDS, state);
  const rng = mulberry32(mixSeeds(0x57324350 /* W2CP */, index));
  const usedValues = new Set<number>();
  const clauses: Clause[] = [];
  for (const subject of plan.subjects) {
    const candidate = pickCandidate(subject, rng, usedValues);
    usedValues.add(candidate.value);
    clauses.push({
      subject,
      kind: candidate.kind,
      source: candidate.source,
      ...(candidate.kind === 'count' ? { range: candidate.range } : {}),
      value: candidate.value,
      ...(candidate.unit === undefined ? {} : { unit: candidate.unit }),
      text: candidate.text,
    });
  }
  const options = buildOptions(clauses, plan.answerIndex, rng);
  const size = plan.subjectCount;
  const labels = plan.subjects.map((id) => getSubject(id));

  const prompt: Bilingual = {
    th: `${size} วิชาพร้อมกัน: ${labels.map((s) => s.th).join(' · ')}\n` +
      clauses.map((clause, i) => `[${i + 1}] ${clause.text.th}`).join(' / ') +
      `\nตัวเลือกใดถูกต้องครบทุกรายการ (ตัวเลขทุกตัวต้องตรง)?`,
    en: `${size} subjects at once: ${labels.map((s) => s.en).join(' · ')}\n` +
      clauses.map((clause, i) => `[${i + 1}] ${clause.text.en}`).join(' / ') +
      `\nWhich option is correct in every clause (every number must match)?`,
  };

  const render = (lang: 'th' | 'en'): string =>
    clauses
      .map((clause, i) => {
        const subject = getSubject(clause.subject);
        const token = renderToken(clause.value, clause.unit, lang);
        const method = clause.kind === 'count' ? PREDICATE_META[clause.source as Predicate].method : methodOf(clause);
        return `${i + 1}) ${subject[lang]}: ${clause.text[lang]} = ${token} — ${method[lang]}`;
      })
      .join('\n');

  const explanation: Bilingual = {
    th: `ข้อนี้รวม ${size} วิชา (ขั้น ${plan.tier}/4) คำตอบที่ถูกคือตัวเลือกที่ตรงทุกข้อ:\n${render('th')}\n` +
      `ทุกค่าได้มาจากการค้น/คำนวณในช่วง 1–${formatNumber(SPACE_MAX)} และคำนวณซ้ำได้ด้วยเครื่อง`,
    en: `This item mixes ${size} subjects (tier ${plan.tier}/4). The right option matches every clause:\n${render('en')}\n` +
      `Every value comes from searching/computing inside 1–${formatNumber(SPACE_MAX)} and can be re-derived by machine.`,
  };

  return {
    id: itemId(index),
    subjects: [...plan.subjects],
    primarySubject: plan.subjects[0]!,
    subjectCount: size,
    tier: plan.tier,
    difficulty: difficultyForSubjectCount(size),
    prompt,
    options,
    answerIndex: plan.answerIndex,
    explanation,
    clauses,
    tags: [
      'world-v2',
      `tier-${plan.tier}`,
      `subjects-${size}`,
      ...labels.map((subject) => subject.tag),
      clauses.some((clause) => clause.kind === 'count') ? 'complete-search' : 'derived-values',
    ],
    verifiedYear: VERIFIED_YEAR,
  };
}

function methodOf(clause: Clause): Bilingual {
  const formula = formulasForSubject(clause.subject).find((entry) => entry.id === clause.source);
  if (formula === undefined) throw new Error(`UNKNOWN_CLAUSE_SOURCE:${clause.source}`);
  return formula.method;
}
