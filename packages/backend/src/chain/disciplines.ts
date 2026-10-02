import type { Discipline } from './types.js';

/** The 12 core disciplines required by the owner's spec (TH + EN labels). */
export const DISCIPLINES: readonly Discipline[] = Object.freeze([
  { id: 'math', th: 'คณิตศาสตร์', en: 'Mathematics' },
  { id: 'science', th: 'วิทยาศาสตร์', en: 'Science' },
  { id: 'thai', th: 'ภาษาไทย', en: 'Thai Language' },
  { id: 'english', th: 'ภาษาอังกฤษ', en: 'English Language' },
  { id: 'social', th: 'สังคมศึกษา ประวัติศาสตร์และการเมือง', en: 'Social Studies' },
  { id: 'health', th: 'สุขศึกษาและพลศึกษา', en: 'Health & Physical Education' },
  { id: 'art', th: 'ศิลปะ', en: 'Arts' },
  { id: 'career', th: 'การงานอาชีพ', en: 'Career & Technology' },
  { id: 'ict', th: 'วิทยาการคำนวณ', en: 'Computing' },
  { id: 'econ', th: 'เศรษฐศาสตร์', en: 'Economics' },
  { id: 'geography', th: 'ภูมิศาสตร์', en: 'Geography' },
  { id: 'philosophy', th: 'ปรัชญาและตรรกศาสตร์', en: 'Philosophy & Logic' },
] as const);

export const DISCIPLINE_IDS: readonly string[] = Object.freeze(DISCIPLINES.map((d) => d.id));

export function getDiscipline(id: string): Discipline {
  const found = DISCIPLINES.find((d) => d.id === id);
  if (!found) throw new Error(`UNKNOWN_DISCIPLINE:${id}`);
  return found;
}
