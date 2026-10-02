/** @nexus/backend — stateless, event-driven backend services. */
export * from './chain/index.js';
export {
  BlockScheduler,
  BLOCK_WINDOW_MS,
  MAX_RANDOM_OFFSET_SECONDS,
} from './scheduler/BlockScheduler.js';
export type {
  BlockSchedulerErrorPhase,
  BlockSchedulerHooks,
  BlockSchedulerOptions,
} from './scheduler/BlockScheduler.js';

export { buildProblemApi } from './problem-bank/app.js';
export type { ProblemApiOptions } from './problem-bank/app.js';
export { ProblemGenerator, cosineSimilarity, toProblemAddYaml } from './generator/ProblemGenerator.js';
export { DEFAULT_DISCIPLINES, SAFETY_TERMS } from './generator/types.js';
export type {
  GeneratedProblem,
  LlmProblemRequest,
  LlmProblemResponse,
  ProblemLlm,
  SafetyChecker,
  SimilarityChecker,
} from './generator/types.js';

export { ProblemBank } from './problem-bank/ProblemBank.js';
export type { ProblemBankOptions } from './problem-bank/ProblemBank.js';
export { answerHashMatches, assertValidProblem, commitAnswer, toPublicProblem } from './problem-bank/commitment.js';
export { TtlCache } from './problem-bank/cache.js';
export type {
  ProblemInput,
  PrivateProblemFile,
  PublicProblemFile,
  PublicProblemResponse,
  VerifyInput,
} from './problem-bank/types.js';
