import type { AnswerOutcome, ChainSummary, QuizChainDataSource, QuizQuestionView } from './types';

/**
 * HTTP bridge to the quiz-chain node (packages/backend `src/chain/server.ts`).
 *
 * All routes are read-only except `POST /api/answer`; no key or secret is
 * involved. The answer route is deliberately NOT an oracle: it records the
 * choice and says only "accepted", so a client cannot brute-force the four
 * options and learn the answer before the block seals. The base URL comes from `EXPO_PUBLIC_QUIZ_CHAIN_URL` (bundled
 * via .env — see .env.example) or can be injected directly (tests).
 */

export const QUIZ_CHAIN_URL_ENV = 'EXPO_PUBLIC_QUIZ_CHAIN_URL';

/** Reads the configured node URL, or `null` when unset/blank. */
export function chainUrlFromEnv(): string | null {
  // Static dot access is required: babel-preset-expo only inlines EXPO_PUBLIC_*
  // values into release bundles for literal member expressions. A computed key
  // (process.env[QUIZ_CHAIN_URL_ENV]) is not inlined, which shipped release APKs
  // that could not reach any node.
  const value = process.env.EXPO_PUBLIC_QUIZ_CHAIN_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

interface StatusResponse {
  readonly height?: number;
  readonly openHeight?: number;
  readonly lastMilestoneHeight?: number;
  readonly totalAttempts?: number;
}

interface CurrentQuestionResponse {
  readonly blockHeight?: number;
  readonly question?: {
    readonly id?: string;
    readonly disciplineId?: string;
    readonly disciplineTh?: string;
    readonly disciplineEn?: string;
    readonly difficulty?: number;
    readonly promptTh?: string;
    readonly promptEn?: string;
    readonly options?: readonly string[];
  };
}

interface AnswerResponse {
  readonly ok?: boolean;
  readonly error?: string;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Builds a `QuizChainDataSource` over a running quiz-chain node.
 *
 * Network failures throw so the hook can distinguish "node reachable but
 * empty" (null question) from "node unreachable" (error → offline state).
 */
export function createQuizChainClient(baseUrl: string): QuizChainDataSource {
  const base = baseUrl.replace(/\/+$/, '');

  const getJson = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}${path}`);
    if (!response.ok) {
      throw new Error(`QUIZ_CHAIN_HTTP_${response.status}`);
    }
    return (await response.json()) as T;
  };

  return {
    async fetchSummary(): Promise<ChainSummary> {
      const body = await getJson<StatusResponse>('/api/status');
      const height = asNumber(body.height);
      if (height === null) throw new Error('QUIZ_CHAIN_BAD_STATUS');
      return {
        height,
        openHeight: asNumber(body.openHeight),
        lastMilestoneHeight: asNumber(body.lastMilestoneHeight) ?? 0,
        totalAttempts: asNumber(body.totalAttempts) ?? 0,
      };
    },

    async fetchCurrentQuestion(): Promise<QuizQuestionView | null> {
      const response = await fetch(`${base}/api/question/current`);
      if (response.status === 404) return null; // node reachable, no open block
      if (!response.ok) throw new Error(`QUIZ_CHAIN_HTTP_${response.status}`);
      const body = (await response.json()) as CurrentQuestionResponse;
      const question = body.question;
      const blockHeight = asNumber(body.blockHeight);
      const id = asString(question?.id);
      const options = question?.options;
      if (question === undefined || blockHeight === null || id === null || !Array.isArray(options) || options.length === 0) {
        throw new Error('QUIZ_CHAIN_BAD_QUESTION');
      }
      return {
        id,
        blockHeight,
        disciplineId: asString(question.disciplineId) ?? '',
        disciplineTh: asString(question.disciplineTh) ?? '',
        disciplineEn: asString(question.disciplineEn) ?? '',
        difficulty: asNumber(question.difficulty) ?? 0,
        promptTh: asString(question.promptTh) ?? '',
        promptEn: asString(question.promptEn) ?? '',
        options: options.filter((option): option is string => typeof option === 'string'),
      };
    },

    async submitAnswer(blockHeight: number, choice: number): Promise<AnswerOutcome> {
      let response: Response;
      try {
        response = await fetch(`${base}/api/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ blockHeight, choice, miner: 'expo-app' }),
        });
      } catch {
        return { ok: false, kind: 'network' };
      }
      if (response.status >= 500) {
        return { ok: false, kind: 'error' };
      }
      let body: AnswerResponse = {};
      try {
        body = (await response.json()) as AnswerResponse;
      } catch {
        // non-JSON body — fall through to status-based classification
      }
      if (response.ok && body.ok === true) {
        // Oracle-free by contract: the node accepts without grading, so any
        // `correct` a (stale) server still sends is dropped on purpose — the
        // app must never show right/wrong before the block seals.
        return { ok: true };
      }
      // 4xx: the node rejected the answer (closed window, wrong height, …)
      return { ok: false, kind: 'rejected' };
    },
  };
}

/** Default source from the bundled env var; `null` when not configured. */
export function defaultQuizChainSource(): QuizChainDataSource | null {
  const url = chainUrlFromEnv();
  return url === null ? null : createQuizChainClient(url);
}
