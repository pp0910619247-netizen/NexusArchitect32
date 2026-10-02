import type { ProblemInput, PublicProblemFile, RubricCriterion } from '../problem-bank/types.js';
import { stringify } from 'yaml';
import { assertValidProblem } from '../problem-bank/commitment.js';
import {
  DEFAULT_DISCIPLINES,
  SAFETY_TERMS,
  type AnswerVerifier,
  type GeneratedProblem,
  type ProblemLlm,
  type RecentPairing,
  type SafetyChecker,
  type SimilarityChecker,
} from './types.js';

export interface ProblemGeneratorOptions {
  readonly llm: ProblemLlm;
  readonly similarity: SimilarityChecker;
  readonly safety: SafetyChecker;
  readonly answerVerifier: AnswerVerifier;
  readonly random?: () => number;
  readonly salt?: () => string;
  readonly maxAttempts?: number;
}

const pairKey = (pair: readonly string[]): string => [...pair].sort().join('|');
const wordTokens = (value: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};
export function cosineSimilarity(left: string, right: string): number {
  const a = wordTokens(left); const b = wordTokens(right); let dot = 0; let aa = 0; let bb = 0;
  for (const [word, value] of a) { const other = b.get(word) ?? 0; dot += value * other; aa += value * value; }
  for (const value of b.values()) bb += value * value;
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}
function defaultSafety(text: string): boolean {
  const lower = text.toLowerCase();
  return !SAFETY_TERMS.some((term) => lower.includes(term));
}

export class ProblemGenerator {
  readonly #llm: ProblemLlm;
  readonly #similarity: SimilarityChecker;
  readonly #safety: SafetyChecker;
  readonly #answerVerifier: AnswerVerifier;
  readonly #random: () => number;
  readonly #salt: () => string;
  readonly #maxAttempts: number;
  constructor(options: ProblemGeneratorOptions) {
    this.#llm = options.llm; this.#similarity = options.similarity; this.#safety = options.safety ?? { isSafe: defaultSafety };
    this.#answerVerifier = options.answerVerifier;

    this.#random = options.random ?? Math.random; this.#salt = options.salt ?? (() => cryptoRandom()); this.#maxAttempts = options.maxAttempts ?? 5;
  }
  chooseDisciplines(recent: readonly RecentPairing[]): string[] {
    const forbidden = new Set(recent.slice(-50).map(pairKey));
    const candidates: string[][] = [];
    const build = (start: number, selected: string[]): void => {
      if (selected.length >= 2) candidates.push([...selected]);
      if (selected.length === 4) return;
      for (let index = start; index < DEFAULT_DISCIPLINES.length; index += 1) {
        const item = DEFAULT_DISCIPLINES[index];
        if (item) selected.push(item);
        build(index + 1, selected);
        selected.pop();
      }
    };
    build(0, []);
    const available = candidates.filter((candidate) => !forbidden.has(pairKey(candidate)));
    if (available.length === 0) throw new Error('NO_UNSEEN_DISCIPLINE_PAIRING');
    const index = Math.min(available.length - 1, Math.floor(this.#random() * available.length));
    const selected = available[index];
    if (!selected) throw new Error('NO_UNSEEN_DISCIPLINE_PAIRING');
    return selected;
  }
  async generate(input: { readonly blockHeight: number; readonly difficulty: number; readonly disciplines: readonly string[]; readonly existing: readonly PublicProblemFile[] }): Promise<GeneratedProblem> {
    if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 10) throw new Error('INVALID_DIFFICULTY');
    if (input.disciplines.length < 2 || input.disciplines.length > 4 || new Set(input.disciplines).size !== input.disciplines.length) throw new Error('INVALID_DISCIPLINES');
    const type = input.difficulty >= 9 ? 'OPEN_ENDED' : 'DETERMINISTIC';
    for (let attempt = 0; attempt < this.#maxAttempts; attempt += 1) {
      const response = await this.#llm.generate({ disciplines: input.disciplines, difficulty: input.difficulty, type });
      if (!response.statement.en.trim() || !response.statement.th.trim()) continue;
      if (type === 'DETERMINISTIC' && (!response.answerPlain.trim() || !(await this.#answerVerifier.verify(response.statement, response.answerPlain)))) continue;
      if (!this.#safety.isSafe(`${response.statement.en} ${response.statement.th}`)) continue;
      const translated = await this.#llm.backTranslate(response.statement.th);
      if (!translated.en.trim() || cosineSimilarity(response.statement.en, translated.en) < 0.72) continue;
      if (await this.#similarity.maxSimilarity(response.statement.en, input.existing) >= 0.85) continue;
      if (type === 'OPEN_ENDED') {
        try { assertPeerReviewRubric(response.rubric); } catch { continue; }
      }
      const rubric = response.rubric;
      const candidate: ProblemInput = { blockHeight: input.blockHeight, type, disciplines: input.disciplines, difficulty: input.difficulty, statement: response.statement, answerPlain: response.answerPlain, salt: this.#salt(), ...(rubric ? { rubric } : {}) };
      assertValidProblem(candidate);
      return { ...candidate, rubric, peerReviewRequired: true };
    }
    throw new Error('GENERATOR_RETRY_LIMIT');
  }
}
function cryptoRandom(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export { defaultSafety };

export function assertPeerReviewRubric(rubric: readonly RubricCriterion[] | undefined): asserts rubric is readonly RubricCriterion[] {
  if (rubric?.length !== 5) throw new Error('OPEN_ENDED_REQUIRES_FIVE_CRITERIA');
  const ids = new Set(rubric.map((criterion) => criterion.id));
  if (ids.size !== 5 || rubric.some((criterion) => !criterion.id.trim() || !criterion.description.en.trim() || !criterion.description.th.trim() || !Number.isInteger(criterion.maxPoints) || criterion.maxPoints <= 0)) {
    throw new Error('INVALID_PEER_REVIEW_RUBRIC');
  }
}


export function toProblemAddYaml(problem: GeneratedProblem): string {
  return stringify({ ...problem, id: problem.id ?? `generated-${problem.blockHeight}` });
}
