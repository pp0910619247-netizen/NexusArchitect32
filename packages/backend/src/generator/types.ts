import type { ProblemInput, PublicProblemFile, RubricCriterion } from '../problem-bank/types.js';

export const DEFAULT_DISCIPLINES = [
  'Physics', 'Chemistry', 'Biology', 'Economics', 'Computer Science', 'Philosophy',
  'Mathematics', 'History', 'Psychology', 'Sociology', 'Statistics', 'Earth Science',
] as const;

export interface LlmProblemRequest {
  readonly disciplines: readonly string[];
  readonly difficulty: number;
  readonly type: 'DETERMINISTIC' | 'OPEN_ENDED';
}
export interface LlmProblemResponse {
  readonly statement: { readonly en: string; readonly th: string };
  readonly answerPlain: string;
  readonly rubric?: readonly RubricCriterion[];
}
export interface ProblemLlm {
  generate(request: LlmProblemRequest): Promise<LlmProblemResponse>;
  backTranslate(thai: string): Promise<{ readonly en: string }>;
}
export interface SimilarityChecker {
  maxSimilarity(text: string, existing: readonly PublicProblemFile[]): Promise<number>;
}
export interface SafetyChecker { isSafe(text: string): boolean; }
export interface AnswerVerifier {
  verify(statement: Readonly<{ en: string; th: string }>, answerPlain: string): Promise<boolean>;
}
export interface GeneratedProblem extends ProblemInput {
  readonly disciplines: readonly string[];
  readonly rubric?: readonly RubricCriterion[];
  readonly peerReviewRequired: true;
}
export type RecentPairing = readonly string[];

export const SAFETY_TERMS = Object.freeze([
  'weapon', 'explosive', 'poison', 'malware', 'hack', 'personal data',
  'อาวุธ', 'ระเบิด', 'สารพิษ', 'แฮ็ก', 'ข้อมูลส่วนบุคคล',
] as const);
