// SPDX-License-Identifier: MIT
/**
 * The 12 world-v2 subjects, chosen by the owner: the school curriculum is
 * replaced by research-grade areas, and physics/quantum is its own subject.
 *
 * These ids live only inside world-v2. world-v1 keeps the chain's 12
 * curriculum disciplines untouched, so the existing verified bank and its
 * validation stay exactly as they were.
 */

export interface Subject {
  readonly id: string;
  readonly th: string;
  readonly en: string;
  /** Short tag used in explanations / tags (lowercase, English). */
  readonly tag: string;
}

export const SUBJECTS: readonly Subject[] = Object.freeze([
  { id: 'physics', th: 'ฟิสิกส์และควอนตัม', en: 'Physics & Quantum', tag: 'physics' },
  { id: 'chemistry', th: 'เคมี', en: 'Chemistry', tag: 'chemistry' },
  { id: 'biology', th: 'ชีววิทยา', en: 'Biology', tag: 'biology' },
  { id: 'math', th: 'คณิตศาสตร์', en: 'Mathematics', tag: 'math' },
  { id: 'computing', th: 'วิทยาการคอมพิวเตอร์', en: 'Computing', tag: 'computing' },
  { id: 'engineering', th: 'วิศวกรรมศาสตร์', en: 'Engineering', tag: 'engineering' },
  { id: 'earthSpace', th: 'โลกและอวกาศ', en: 'Earth & Space', tag: 'earth-space' },
  { id: 'medicine', th: 'แพทยศาสตร์และสุขภาพ', en: 'Medicine & Health', tag: 'medicine' },
  { id: 'economics', th: 'เศรษฐศาสตร์', en: 'Economics', tag: 'economics' },
  { id: 'socialHistory', th: 'สังคมและประวัติศาสตร์', en: 'Social & History', tag: 'social-history' },
  { id: 'philosophyLogic', th: 'ปรัชญาและตรรกศาสตร์', en: 'Philosophy & Logic', tag: 'philosophy-logic' },
  { id: 'artsLanguage', th: 'ศิลปะและภาษา', en: 'Arts & Language', tag: 'arts-language' },
] as const);

export const SUBJECT_IDS: readonly string[] = Object.freeze(SUBJECTS.map((subject) => subject.id));

const BY_ID = new Map(SUBJECTS.map((subject) => [subject.id, subject]));

export function getSubject(id: string): Subject {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`UNKNOWN_SUBJECT:${id}`);
  return found;
}

/** Display difficulty for a subject count (monotone 4→1 … 12→10). */
export const DIFFICULTY_BY_SUBJECT_COUNT: Readonly<Record<number, number>> = Object.freeze({
  4: 1,
  6: 3,
  8: 6,
  10: 8,
  12: 10,
});

export function difficultyForSubjectCount(subjectCount: number): number {
  const found = DIFFICULTY_BY_SUBJECT_COUNT[subjectCount];
  if (found === undefined) throw new Error(`UNSUPPORTED_SUBJECT_COUNT:${subjectCount}`);
  return found;
}
