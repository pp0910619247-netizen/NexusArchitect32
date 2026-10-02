// SPDX-License-Identifier: MIT
/**
 * world:ai-eval — samples the world-v1 bank per difficulty (d1…d10), asks a
 * real AI provider to solve each item, and reports accuracy per difficulty.
 *
 * Why stratified sampling: the bank ramps easy → hard (ladder.ts), so a plain
 * random draw would over-sample the d3–8 middle (78% of the bank) and barely
 * touch the frontier tier (d9–10 = 13%). This CLI therefore draws a fixed
 * number of items from EVERY difficulty level, with a larger allowance for the
 * frontier levels, so per-difficulty accuracy is directly comparable.
 *
 * Determinism: the sample is a pure function of (seed, per-difficulty counts),
 * so reruns ask the same questions in the same order.
 *
 * Integrity: before asking anything, the CLI re-hashes the ten JSONL files and
 * compares them with manifest.json — an eval is only meaningful against the
 * bank it claims to measure.
 *
 * Honesty: results are written to questions/world-v1/ai-eval-report.md and
 * ai-eval-results.json (gitignored with the rest of questions/). The report
 * records provider, model, language, seed and the bank manifest hash. Without a
 * provider key the CLI refuses to run an evaluation; `--dry-run` prints the
 * exact sample it would send and is the only key-free mode.
 *
 * No new dependencies: providers are called over Node's global fetch.
 *
 * Usage:
 *   pnpm --filter @nexus/backend world:ai-eval --dry-run
 *   GEMINI_API_KEY=… pnpm --filter @nexus/backend world:ai-eval --provider gemini --model gemini-2.5-flash
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldQuestion } from './compose.js';
import { defaultOutDir } from './generate.js';
import { mixSeeds, mulberry32 } from './ladder.js';
import { loadBank } from './validate.js';

// ---------------------------------------------------------------- bank input

export interface BankItem {
  /** 0-based position in the bank; question id is always `wk-` + (index+1). */
  readonly index: number;
  readonly question: WorldQuestion;
}

/** Reads the ten JSONL files on disk into one flat, index-ordered list. */
export function loadQuestions(outDir: string): BankItem[] {
  const { files, missing } = loadBank(outDir);
  if (missing.length > 0) throw new Error(`AI_EVAL_BANK_INCOMPLETE:${missing.join(',')}`);
  const items: BankItem[] = [];
  let index = 0;
  for (const file of files) {
    for (const question of file.questions) {
      if (question) items.push({ index, question });
      index += 1;
    }
  }
  return items;
}

export interface BankFingerprint {
  readonly manifestSha256: string | null;
  readonly verifiedFiles: number;
  readonly mismatches: readonly string[];
}

/** Re-hashes the JSONL files and compares them with manifest.json. */
export function bankFingerprint(outDir: string): BankFingerprint {
  const { files } = loadBank(outDir);
  const mismatches: string[] = [];
  let manifestSha256: string | null = null;
  let verifiedFiles = 0;
  const manifestPath = path.join(outDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const raw = readFileSync(manifestPath);
    manifestSha256 = createHash('sha256').update(raw).digest('hex');
    const parsed = JSON.parse(raw.toString('utf8')) as { files?: readonly { name?: string; sha256?: string }[] };
    const entries = Array.isArray(parsed.files) ? parsed.files : [];
    for (const file of files) {
      const entry = entries.find((candidate) => candidate.name === file.name);
      if (!entry) {
        mismatches.push(`${file.name}: missing from manifest`);
        continue;
      }
      if (entry.sha256 !== file.sha256) {
        mismatches.push(`${file.name}: sha256 differs from manifest`);
        continue;
      }
      verifiedFiles += 1;
    }
  } else {
    mismatches.push('manifest.json not found (run world:generate + world:validate first)');
  }
  return { manifestSha256, verifiedFiles, mismatches };
}

// -------------------------------------------------------------- stratification

export const DIFFICULTIES: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const DEFAULT_SEED = 'world-v1-ai-eval';
export const DEFAULT_PER_DIFFICULTY = 5;
export const DEFAULT_FRONTIER_PER_DIFFICULTY = 20;
export const FRONTIER_MIN_DIFFICULTY = 9;
export const FLAGSHIP_ID = 'wk-000001';

export interface SampleSpec {
  /** Items drawn from each of d1…d8. */
  readonly perDifficulty: number;
  /** Items drawn from each of d9…d10 (frontier tier). */
  readonly frontierPerDifficulty: number;
  readonly seed: string;
  /** Force wk-000001 into the run even if the draw skipped it. */
  readonly includeFlagship: boolean;
}

export interface SampledItem extends BankItem {
  readonly difficulty: number;
  readonly flagship: boolean;
}

export interface SamplingShortfall {
  readonly difficulty: number;
  readonly requested: number;
  readonly available: number;
}

/** How many items the spec asks from one difficulty level. */
export function quotaFor(difficulty: number, spec: SampleSpec): number {
  return difficulty >= FRONTIER_MIN_DIFFICULTY ? spec.frontierPerDifficulty : spec.perDifficulty;
}

function seedFor(seed: string, difficulty: number): number {
  return createHash('sha256').update(`${seed}#d${difficulty}`).digest().readUInt32BE(0);
}

/** Deterministic partial Fisher–Yates draw of `count` entries from `pool`. */
export function drawIndices(pool: readonly number[], count: number, rng: () => number): number[] {
  const copy = [...pool];
  const take = Math.max(0, Math.min(count, copy.length));
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy.slice(0, take).sort((a, b) => a - b);
}

/**
 * Stratified, deterministic sample: `quotaFor(d, spec)` items per difficulty,
 * ascending by difficulty then by bank index. When a level holds fewer items
 * than requested the draw takes everything it has and the shortfall is
 * reported rather than silently passing off a smaller sample.
 */
export function sampleBank(
  items: readonly BankItem[],
  spec: SampleSpec,
): { sample: SampledItem[]; shortfalls: SamplingShortfall[] } {
  const buckets = new Map<number, BankItem[]>();
  for (const difficulty of DIFFICULTIES) buckets.set(difficulty, []);
  for (const item of items) {
    const bucket = buckets.get(item.question.difficulty);
    if (bucket) bucket.push(item);
  }
  const sample: SampledItem[] = [];
  const shortfalls: SamplingShortfall[] = [];
  for (const difficulty of DIFFICULTIES) {
    const bucket = buckets.get(difficulty) ?? [];
    const quota = quotaFor(difficulty, spec);
    if (quota > bucket.length) shortfalls.push({ difficulty, requested: quota, available: bucket.length });
    const rng = mulberry32(mixSeeds(seedFor(spec.seed, difficulty), difficulty));
    const lookup = new Map(bucket.map((entry) => [entry.index, entry.question]));
    for (const index of drawIndices(bucket.map((entry) => entry.index), quota, rng)) {
      const question = lookup.get(index);
      if (!question) continue;
      sample.push({ index, question, difficulty, flagship: question.id === FLAGSHIP_ID });
    }
  }
  if (spec.includeFlagship && !sample.some((entry) => entry.question.id === FLAGSHIP_ID)) {
    const flagship = items.find((entry) => entry.question.id === FLAGSHIP_ID);
    if (flagship) {
      sample.push({ index: flagship.index, question: flagship.question, difficulty: flagship.question.difficulty, flagship: true });
    }
  }
  return { sample, shortfalls };
}

// ------------------------------------------------------------ prompt building

export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export type PromptLang = 'en' | 'th';

/**
 * Bilingual system instruction. Every option string in world-v1 is Thai, so the
 * Thai line matters: it tells the model the shapes it must choose among.
 */
export const SYSTEM_PROMPT = [
  'You are taking a hard multiple-choice knowledge quiz.',
  'Each question lists several sub-items and every option is a sequence of answers joined by " · ".',
  'Reply with ONLY the letter of the single correct option: A, B, C or D.',
  'Do not explain, do not restate the options, do not write anything else.',
  'ตอบด้วยตัวอักษรของตัวเลือกที่ถูกต้องเพียงตัวเดียว: A, B, C หรือ D เท่านั้น ห้ามอธิบายเพิ่ม',
].join('\n');

/** Renders one bank item for the model. Option text is passed through verbatim. */
export function buildPrompt(question: WorldQuestion, lang: PromptLang): string {
  const stem = lang === 'th' ? question.prompt.th : question.prompt.en;
  const lines: string[] = [stem, ''];
  question.options.forEach((option, index) => {
    lines.push(`${LETTERS[index] ?? '?'}. ${option}`);
  });
  lines.push('', 'Answer with a single letter:');
  return lines.join('\n');
}

// -------------------------------------------------------------- answer parsing

export type AnswerStatus = 'correct' | 'wrong' | 'parse_failure' | 'refusal' | 'error';

const ANSWER_MARKER_RE = /(?:answer|correct(?:\s+answer)?|option|choice|ตัวเลือก|คำตอบ|ตอบ)\s*(?:is|are|:|=|คือ)?\s*\(?\s*([ABCDabcd1-4])\s*\)?/i;
/** "B is correct", "C เป็นคำตอบที่ถูกต้อง" — a letter followed by a correctness marker. */
const TRAILING_MARKER_RE = /\b([ABCDabcd1-4])\b\s*(?:is|เป็น)?\s*(?:the\s+)?(?:correct|right|answer|คำตอบที่ถูก|ถูกต้อง)/i;
const REFUSAL_RE = /(as an ai|i cannot|i can'?t|i'm unable|unable to (?:answer|help|determine)|sorry,? but|ไม่สามารถ(?:ตอบ|ให้ข้อมูล)|ขออภัย)/i;
const PAD_RE = /^[\s"'`*_([{]+|[\s"'`*_\])}.!,]+$/g;

function letterToIndex(token: string): number | null {
  const upper = token.trim().toUpperCase();
  const letter = (LETTERS as readonly string[]).indexOf(upper);
  if (letter >= 0) return letter;
  if (/^[1-4]$/.test(upper)) return Number(upper) - 1;
  return null;
}

/**
 * Reads free-form model output as an option index (0–3), or null when the text
 * cannot be read as exactly one answer. Handles `B`, `(B)`, `**D**`,
 * `Option 3`, `คำตอบ: C`, `The correct answer is A.`, and a verbatim copy of one
 * option. Returns null (never a guess) when several different letters appear
 * with no explicit marker, and never returns an index outside 0–3.
 */
export function parseAnswerIndex(text: string, options: readonly string[]): number | null {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const bare = raw.replace(PAD_RE, '').replace(/[.!。]+$/g, '').trim();
  const exact = letterToIndex(bare);
  if (exact !== null) return exact;
  const marked = ANSWER_MARKER_RE.exec(raw);
  if (marked?.[1]) {
    const value = letterToIndex(marked[1]);
    if (value !== null) return value;
  }
  const trailing = TRAILING_MARKER_RE.exec(raw);
  if (trailing?.[1]) {
    const value = letterToIndex(trailing[1]);
    if (value !== null) return value;
  }
  const letters = new Set((raw.match(/\b[ABCD]\b/g) ?? []).map((token) => token.toUpperCase()));
  if (letters.size === 1) return letterToIndex([...letters][0]!);
  if (letters.size === 0) {
    const digits = new Set(raw.match(/\b[1-4]\b/g) ?? []);
    if (digits.size === 1) return letterToIndex([...digits][0]!);
  }
  // Last resort: the model echoed an option. Longest verbatim match wins; ties
  // are ambiguous and therefore rejected.
  const haystack = raw.toLowerCase();
  const hits = options
    .map((option, index) => ({ index, needle: option.toLowerCase().trim() }))
    .filter((entry) => entry.needle.length >= 4 && haystack.includes(entry.needle));
  if (hits.length === 1) return hits[0]!.index;
  if (hits.length > 1) {
    let longest = hits[0]!;
    for (const hit of hits) if (hit.needle.length > longest.needle.length) longest = hit;
    const tied = hits.filter((hit) => hit.needle.length === longest.needle.length);
    if (tied.length === 1) return longest.index;
  }
  return null;
}

/** Classifies one raw model answer against the expected option. */
export function classifyAnswer(
  expectedIndex: number,
  text: string,
  options: readonly string[],
): { status: AnswerStatus; parsedIndex: number | null } {
  const parsedIndex = parseAnswerIndex(text, options);
  if (parsedIndex !== null) {
    if (parsedIndex < 0 || parsedIndex >= options.length) return { status: 'parse_failure', parsedIndex: null };
    return { status: parsedIndex === expectedIndex ? 'correct' : 'wrong', parsedIndex };
  }
  return { status: REFUSAL_RE.test(text) ? 'refusal' : 'parse_failure', parsedIndex: null };
}

// ------------------------------------------------------------------ providers

export type AiProviderId = 'gemini' | 'openai' | 'claude';

export const PROVIDER_IDS: readonly AiProviderId[] = Object.freeze(['gemini', 'openai', 'claude']);

/** Environment variable names checked, in order, for each provider's key. */
export const PROVIDER_KEY_ENV: Readonly<Record<AiProviderId, readonly string[]>> = Object.freeze({
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
});

/** Model used when `--model` / `NEXUS_AI_MODEL` is not set. Overridable. */
export const DEFAULT_MODELS: Readonly<Record<AiProviderId, string>> = Object.freeze({
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-latest',
});

export const DEFAULT_ENDPOINTS: Readonly<Record<AiProviderId, string>> = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
});

export interface ChatMessage {
  readonly system: string;
  readonly user: string;
}

export interface ChatProvider {
  readonly id: AiProviderId;
  readonly model: string;
  chat(message: ChatMessage): Promise<string>;
}

export interface RetryOptions {
  readonly retries: number;
  readonly delayMs: number;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export function resolveKey(id: AiProviderId, env: NodeJS.ProcessEnv): string | null {
  for (const name of PROVIDER_KEY_ENV[id]) {
    const value = (env[name] ?? '').trim();
    if (value) return value;
  }
  return null;
}

/** Picks the provider from NEXUS_AI_PROVIDER, else the first key that exists. */
export function detectProvider(env: NodeJS.ProcessEnv): AiProviderId | null {
  const explicit = (env.NEXUS_AI_PROVIDER ?? '').trim().toLowerCase();
  if (explicit) {
    if (!(PROVIDER_IDS as readonly string[]).includes(explicit)) throw new Error(`UNKNOWN_PROVIDER:${explicit}`);
    return explicit as AiProviderId;
  }
  for (const id of PROVIDER_IDS) if (resolveKey(id, env)) return id;
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * POSTs JSON with bounded exponential backoff. Network errors, timeouts, 429
 * and 5xx are retried; other 4xx responses fail immediately (a bad key or a bad
 * model name will not fix itself).
 */
export async function postJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  options: RetryOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  let lastError: Error = new Error('POST_FAILED');
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const backoff = options.delayMs * 2 ** attempt;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      lastError = new Error(`NETWORK:${error instanceof Error ? error.message : String(error)}`);
      if (attempt < options.retries) { await sleep(backoff); continue; }
      break;
    }
    const text = await response.text().catch(() => '');
    if (response.ok) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        lastError = new Error(`BAD_JSON:${text.slice(0, 200)}`);
        break;
      }
    }
    lastError = new Error(`HTTP_${response.status}:${text.slice(0, 300)}`);
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < options.retries) { await sleep(backoff); continue; }
    break;
  }
  throw lastError;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Gemini: candidates[0].content.parts[*].text */
export function extractGeminiText(json: unknown): string {
  const candidate = asRecord((asRecord(json)?.candidates as unknown[] | undefined)?.[0]);
  const parts = (asRecord(candidate?.content)?.parts as unknown[] | undefined) ?? [];
  const texts: string[] = [];
  for (const part of parts) {
    const record = asRecord(part);
    if (record && typeof record.text === 'string') texts.push(record.text);
  }
  return texts.join('');
}

export function extractOpenAiText(json: unknown): string {
  const choice = asRecord((asRecord(json)?.choices as unknown[] | undefined)?.[0]);
  const message = asRecord(choice?.message);
  if (typeof message?.content === 'string') return message.content;
  if (typeof choice?.text === 'string') return choice.text;
  return '';
}

export function extractClaudeText(json: unknown): string {
  const blocks = (asRecord(json)?.content as unknown[] | undefined) ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    const record = asRecord(block);
    if (record && typeof record.text === 'string') parts.push(record.text);
  }
  return parts.join('');
}

export interface ProviderOptions extends RetryOptions {
  readonly id: AiProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
}

/** Builds the chat provider for one id, using the documented REST shape. */
export function createProvider(options: ProviderOptions): ChatProvider {
  const { id, model, apiKey, endpoint } = options;
  const retry: RetryOptions = {
    retries: options.retries,
    delayMs: options.delayMs,
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  if (id === 'openai') {
    return {
      id,
      model,
      chat: async (message) => extractOpenAiText(await postJson(
        `${endpoint}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        { model, messages: [{ role: 'system', content: message.system }, { role: 'user', content: message.user }] },
        retry,
      )),
    };
  }
  if (id === 'claude') {
    return {
      id,
      model,
      chat: async (message) => extractClaudeText(await postJson(
        `${endpoint}/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 512, system: message.system, messages: [{ role: 'user', content: message.user }] },
        retry,
      )),
    };
  }
  return {
    id,
    model,
    chat: async (message) => extractGeminiText(await postJson(
      `${endpoint}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {},
      {
        systemInstruction: { parts: [{ text: message.system }] },
        contents: [{ role: 'user', parts: [{ text: message.user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      },
      retry,
    )),
  };
}

// ------------------------------------------------------------------- scoring

export interface EvalItemResult {
  readonly id: string;
  readonly index: number;
  readonly difficulty: number;
  readonly flagship: boolean;
  readonly expectedIndex: number;
  readonly parsedIndex: number | null;
  readonly status: AnswerStatus;
  readonly correct: boolean;
  /** Raw model answer, single-lined and truncated for the report. */
  readonly answerText: string;
  readonly durationMs: number;
  readonly error?: string;
}

export interface AccuracyBucket {
  readonly sampled: number;
  readonly answered: number;
  readonly correct: number;
  readonly wrong: number;
  readonly parseFailures: number;
  readonly refusals: number;
  readonly errors: number;
  /** correct / answered, or null when nothing was answered. */
  readonly accuracyPct: number | null;
  /** correct / sampled — counts unparsable and failed calls as not correct. */
  readonly strictAccuracyPct: number | null;
}

export interface DifficultyBucket extends AccuracyBucket {
  readonly difficulty: number;
}

export interface BandBucket extends AccuracyBucket {
  readonly band: string;
  readonly range: string;
}

export const BANDS: readonly { readonly band: string; readonly range: string; readonly from: number; readonly to: number }[] = Object.freeze([
  { band: 'easy', range: 'd1–d2', from: 1, to: 2 },
  { band: 'mid', range: 'd3–d8', from: 3, to: 8 },
  { band: 'frontier', range: 'd9–d10', from: 9, to: 10 },
]);

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Aggregates one set of per-item results into counts and two accuracy figures. */
export function bucketOf(results: readonly EvalItemResult[]): AccuracyBucket {
  let correct = 0;
  let wrong = 0;
  let parseFailures = 0;
  let refusals = 0;
  let errors = 0;
  for (const result of results) {
    if (result.status === 'correct') correct += 1;
    else if (result.status === 'wrong') wrong += 1;
    else if (result.status === 'refusal') refusals += 1;
    else if (result.status === 'error') errors += 1;
    else parseFailures += 1;
  }
  const sampled = results.length;
  const answered = correct + wrong;
  return {
    sampled,
    answered,
    correct,
    wrong,
    parseFailures,
    refusals,
    errors,
    accuracyPct: pct(correct, answered),
    strictAccuracyPct: pct(correct, sampled),
  };
}

export function summariseByDifficulty(results: readonly EvalItemResult[]): Record<string, DifficultyBucket> {
  const out: Record<string, DifficultyBucket> = {};
  for (const difficulty of DIFFICULTIES) {
    const slice = results.filter((result) => result.difficulty === difficulty);
    out[String(difficulty)] = { difficulty, ...bucketOf(slice) };
  }
  return out;
}

export function summariseByBand(results: readonly EvalItemResult[]): readonly BandBucket[] {
  return BANDS.map((entry) => ({
    band: entry.band,
    range: entry.range,
    ...bucketOf(results.filter((result) => result.difficulty >= entry.from && result.difficulty <= entry.to)),
  }));
}

export interface EvalRunMeta {
  readonly provider: string;
  readonly model: string;
  readonly endpoint: string;
  readonly lang: PromptLang;
  readonly seed: string;
  readonly perDifficulty: number;
  readonly frontierPerDifficulty: number;
  readonly bankDir: string;
  readonly manifestSha256: string | null;
  readonly verifiedFiles: number;
}

export interface EvalSummary extends EvalRunMeta {
  readonly schemaVersion: 'world-v1-ai-eval';
  readonly label: string;
  readonly generatedAt: string;
  readonly durationMs: number;
  readonly includeFlagship: boolean;
  readonly sampled: number;
  readonly overall: AccuracyBucket;
  readonly byDifficulty: Record<string, DifficultyBucket>;
  readonly byBand: readonly BandBucket[];
  readonly flagship: AccuracyBucket | null;
  readonly shortfalls: readonly SamplingShortfall[];
  readonly stoppedEarly: boolean;
  readonly bankMismatches: readonly string[];
}

export function summarise(input: {
  readonly meta: EvalRunMeta;
  readonly label: string;
  readonly results: readonly EvalItemResult[];
  readonly durationMs: number;
  readonly includeFlagship: boolean;
  readonly shortfalls: readonly SamplingShortfall[];
  readonly stoppedEarly: boolean;
  readonly bankMismatches: readonly string[];
}): EvalSummary {
  const { results } = input;
  const flagshipItems = results.filter((result) => result.flagship);
  return {
    ...input.meta,
    schemaVersion: 'world-v1-ai-eval',
    label: input.label,
    generatedAt: new Date().toISOString(),
    durationMs: input.durationMs,
    includeFlagship: input.includeFlagship,
    sampled: results.length,
    overall: bucketOf(results),
    byDifficulty: summariseByDifficulty(results),
    byBand: summariseByBand(results),
    flagship: flagshipItems.length > 0 ? bucketOf(flagshipItems) : null,
    shortfalls: input.shortfalls,
    stoppedEarly: input.stoppedEarly,
    bankMismatches: input.bankMismatches,
  };
}

// -------------------------------------------------------------------- report

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function truncate(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function bucketTableRows(labelled: readonly { readonly label: string; readonly bucket: AccuracyBucket }[]): string {
  return labelled
    .map(({ label, bucket }) =>
      `| ${label} | ${bucket.sampled} | ${bucket.answered} | ${bucket.correct} | ${bucket.wrong} | ${fmtPct(bucket.accuracyPct)} | ${fmtPct(bucket.strictAccuracyPct)} | ${bucket.parseFailures} | ${bucket.refusals} | ${bucket.errors} |`)
    .join('\n');
}

export interface ReportInput {
  readonly summary: EvalSummary;
  readonly items: readonly EvalItemResult[];
  readonly maxMistakes: number;
}

/** Builds the human-readable markdown report (Thai prose, English column keys). */
export function buildEvalReport(input: ReportInput): string {
  const { summary, items, maxMistakes } = input;
  const difficultyRows = bucketTableRows(
    DIFFICULTIES.map((difficulty) => ({
      label: `d${difficulty}`,
      bucket: summary.byDifficulty[String(difficulty)] ?? bucketOf([]),
    })),
  );
  const bandRows = bucketTableRows(summary.byBand.map((entry) => ({ label: `${entry.band} (${entry.range})`, bucket: entry })));
  const mistakes = items.filter((item) => item.status === 'wrong' || item.status === 'parse_failure' || item.status === 'refusal').slice(0, maxMistakes);
  const mistakeLines = mistakes.length === 0
    ? '_ไม่มีข้อที่ตอบผิดหรืออ่านคำตอบไม่ได้ในรอบนี้_'
    : mistakes
      .map((item) => {
        const expected = LETTERS[item.expectedIndex] ?? '?';
        const parsed = item.parsedIndex === null ? '—' : (LETTERS[item.parsedIndex] ?? '?');
        return `| \`${item.id}\` | d${item.difficulty} | ${expected} | ${parsed} | ${item.status} | ${truncate(item.answerText)} |`;
      })
      .join('\n');
  const errorRows = items.filter((item) => item.error);
  const errorSection = errorRows.length === 0
    ? ''
    : `\n## 4.1) การเรียกโมเดลที่ล้มเหลว (${errorRows.length} ครั้ง)\n\n${errorRows
        .map((item) => `- \`${item.id}\` (d${item.difficulty}): ${truncate(item.error ?? '', 200)}`)
        .join('\n')}\n`;
  const shortfallSection = summary.shortfalls.length === 0
    ? ''
    : `\n> ⚠️ **คลังมีข้อไม่พอต่อโควตาที่ขอ:** ${summary.shortfalls
        .map((entry) => `d${entry.difficulty} ขอ ${entry.requested} แต่มี ${entry.available}`)
        .join(', ')} — ตัวเลขความแม่นยำของระดับนั้นจึงคิดจากข้อที่มีจริงทั้งหมด\n`;
  const flagshipSection = summary.flagship
    ? `\n**Flagship (\`${FLAGSHIP_ID}\` — ตั้งใจให้ยากเกินมนุษย์/AI):** สุ่มมา ${summary.flagship.sampled} ข้อ · ตอบได้ ${summary.flagship.answered} · ถูก ${summary.flagship.correct} · ความแม่นยำ ${fmtPct(summary.flagship.accuracyPct)}\n`
    : '';
  const mismatches = summary.bankMismatches.length > 0
    ? `\n> ⚠️ **คลังไม่ตรงกับ manifest:** ${summary.bankMismatches.join('; ')}\n`
    : '';
  return `# world-v1 — ผลทดสอบกับ AI: ความแม่นยำแยกตามระดับความยาก (accuracy by difficulty)

> ตัวเลขทุกตัวในรายงานนี้มาจากการเรียกโมเดลจริงผ่าน API เท่านั้น ไม่มีการจำลองคำตอบหรือเติมผลลัพธ์ด้วยมือ
> ถ้าไม่มี API key สคริปต์จะ**ไม่รัน**และไม่สร้างรายงาน (โหมด \`--dry-run\` มีไว้ดูรายการคำถามที่สุ่มเท่านั้น)
${mismatches}${shortfallSection}
**ผู้ให้บริการ (provider):** \`${summary.provider}\` · **โมเดล:** \`${summary.model}\` · **ภาษา prompt:** \`${summary.lang}\`
**Endpoint:** \`${summary.endpoint}\` · **Seed:** \`${summary.seed}\` · **Label:** \`${summary.label}\`
**คลัง:** \`${summary.bankDir}\` · **manifest SHA-256:** \`${summary.manifestSha256 ?? 'ไม่พบ manifest'}\`
**ตรวจคลังก่อนรัน:** ${summary.verifiedFiles}/10 ไฟล์ตรงกับ manifest
**การสุ่ม:** d1–d8 ระดับละ ${summary.perDifficulty} · d9–d10 (frontier) ระดับละ ${summary.frontierPerDifficulty} · flagship ${summary.includeFlagship ? 'รวม' : 'ไม่รวม'}
**จำนวนที่ทดสอบจริง:** ${summary.sampled} ข้อ · **เวลาทั้งหมด:** ${(summary.durationMs / 1000).toFixed(1)} s · **วันที่รัน:** ${summary.generatedAt}
${summary.stoppedEarly ? '**หมายเหตุ:** รันหยุดก่อนครบโควตาเพราะการเรียกโมเดลล้มเหลวติดกันเกินเพดาน\n' : ''}
## 1) ภาพรวม (overall)

| กลุ่ม | sampled | answered | ถูก | ผิด | แม่นยำ (ถูก/answered) | แม่นยำเข้ม (ถูก/sampled) | parse fail | refusal | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${bucketTableRows([{ label: '**ทั้งหมด (all)**', bucket: summary.overall }, ...summary.byBand.map((entry) => ({ label: `${entry.band} (${entry.range})`, bucket: entry }))])}
${flagshipSection}
## 2) แยกตามระดับความยาก (per difficulty)

| ระดับ | sampled | answered | ถูก | ผิด | แม่นยำ (ถูก/answered) | แม่นยำเข้ม (ถูก/sampled) | parse fail | refusal | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${difficultyRows}

## 3) แยกตามช่วง (bands)

| ช่วง | sampled | answered | ถูก | ผิด | แม่นยำ (ถูก/answered) | แม่นยำเข้ม (ถูก/sampled) | parse fail | refusal | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${bandRows}

## 4) ข้อที่โมเดลตอบผิด / อ่านคำตอบไม่ได้ (${mistakes.length} จาก ${items.length})

| id | ระดับ | เฉลย | ตอบ | สถานะ | คำตอบดิบของโมเดล |
| --- | --- | --- | --- | --- | --- |
${mistakeLines}
${errorSection}
## 5) ข้อจำกัดของรายงานนี้

- **โมเดลไม่ deterministic** — รันซ้ำแม้ด้วย seed เดียวกัน (คำถามชุดเดิม) ก็ได้คำตอบต่างกันได้; ตัวเลขนี้คือ **หนึ่งรอบ** (single run) ไม่ใช่ค่าประมาณเชิงสถิติ
- **ขนาดตัวอย่างต่อระดับเล็ก** — n ต่อระดับตามที่ตั้งใน CLI (ค่าเริ่มต้น d1–d8 = ${summary.perDifficulty}, d9–d10 = ${summary.frontierPerDifficulty}); ช่วงความเชื่อมั่นกว้าง ห้ามตีความเป็นอันดับที่แน่นอน
- **คำตอบถูกตัดสินจากตัวอักษรที่โมเดลตอบ** เทียบกับ \`answerIndex\` ในคลัง (ground truth = คลัง ไม่ใช่ผู้เชี่ยวชาญมนุษย์)
- **ตัวเลือกเป็นภาษาไทยล้วน** แต่ prompt ส่งเป็น \`${summary.lang}\` — ความแม่นยำจึงรวมความสามารถข้ามภาษาไว้ด้วย
- **ยังไม่มี human review** — ข้อที่โมเดลตอบตรงกับคลังยังไม่ได้แปลว่าคลังถูก และข้อที่โมเดลตอบผิดยังไม่ได้แปลว่าคลังผิด
- จำนวน \`error\` (เน็ต/HTTP/timeout) ไม่ถูกนับเป็น "ตอบผิด" แต่ทำให้ตัวหารของความแม่นยำเข้มเปลี่ยนไป

## 6) วิธีรันซ้ำ (reproduce)

\`\`\`bash
pnpm --filter @nexus/backend build
# ดูรายการคำถามที่สุ่มโดยไม่เรียก AI (ไม่ต้องมี key)
pnpm --filter @nexus/backend world:ai-eval -- --dry-run

# รันจริง (ต้องมี API key)
GEMINI_API_KEY=… pnpm --filter @nexus/backend world:ai-eval -- --provider gemini --model gemini-2.5-flash
\`\`\`

ผลดิบต่อข้อทั้งหมดอยู่ใน \`ai-eval-results.json\` ข้างไฟล์นี้
`;
}

export interface EvalArtifacts {
  readonly jsonPath: string;
  readonly reportPath: string;
}

/** Writes ai-eval-results.json + ai-eval-report.md next to the bank. */
export function writeEvalArtifacts(
  reportDir: string,
  summary: EvalSummary,
  items: readonly EvalItemResult[],
  maxMistakes: number,
): EvalArtifacts {
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'ai-eval-results.json');
  const reportPath = path.join(reportDir, 'ai-eval-report.md');
  writeFileSync(jsonPath, `${JSON.stringify({ summary, items }, null, 2)}\n`, { encoding: 'utf8' });
  writeFileSync(reportPath, buildEvalReport({ summary, items, maxMistakes }), { encoding: 'utf8' });
  return { jsonPath, reportPath };
}

// ------------------------------------------------------------------------ CLI

export interface EvalArgs {
  readonly bankDir: string;
  readonly reportDir: string;
  readonly perDifficulty: number;
  readonly frontierPerDifficulty: number;
  readonly seed: string;
  readonly lang: PromptLang;
  readonly provider: AiProviderId | null;
  readonly model: string | null;
  readonly endpoint: string | null;
  readonly retries: number;
  readonly delayMs: number;
  readonly paceMs: number;
  readonly timeoutMs: number;
  readonly includeFlagship: boolean;
  readonly dryRun: boolean;
  readonly limit: number;
  readonly maxErrors: number;
  readonly maxMistakes: number;
  readonly label: string;
  readonly allowBankDrift: boolean;
}

function nonNegativeInt(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`INVALID_ARG:${flag}:${raw}`);
  return value;
}

/**
 * Parses the CLI flags. The API key is deliberately NOT a flag — it is read
 * from the environment only, so it never lands in shell history or `ps`.
 */
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  let bankDir = defaultOutDir();
  let reportDir: string | null = null;
  let perDifficulty = DEFAULT_PER_DIFFICULTY;
  let frontierPerDifficulty = DEFAULT_FRONTIER_PER_DIFFICULTY;
  let seed = DEFAULT_SEED;
  let lang: PromptLang = 'en';
  let provider: AiProviderId | null = null;
  let model: string | null = null;
  let endpoint: string | null = null;
  let retries = 3;
  let delayMs = 1_500;
  let paceMs = 250;
  let timeoutMs = 60_000;
  let includeFlagship = true;
  let dryRun = false;
  let limit = 0;
  let maxErrors = 5;
  let maxMistakes = 10;
  let label = 'default';
  let allowBankDrift = false;
  const value = (index: number, flag: string): string => {
    const raw = argv[index + 1];
    if (raw === undefined || raw.startsWith('--')) throw new Error(`MISSING_ARG_VALUE:${flag}`);
    return raw;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    switch (flag) {
      case '--out':
      case '--bank-dir': bankDir = path.resolve(value(i, flag)); i += 1; break;
      case '--report-dir': reportDir = path.resolve(value(i, flag)); i += 1; break;
      case '--per-difficulty': perDifficulty = nonNegativeInt(value(i, flag), flag, perDifficulty); i += 1; break;
      case '--frontier': frontierPerDifficulty = nonNegativeInt(value(i, flag), flag, frontierPerDifficulty); i += 1; break;
      case '--seed': seed = value(i, flag); i += 1; break;
      case '--label': label = value(i, flag); i += 1; break;
      case '--lang': {
        const raw = value(i, flag);
        if (raw !== 'en' && raw !== 'th') throw new Error(`INVALID_ARG:--lang:${raw}`);
        lang = raw; i += 1; break;
      }
      case '--provider': {
        const raw = value(i, flag);
        if (!(PROVIDER_IDS as readonly string[]).includes(raw)) throw new Error(`INVALID_ARG:--provider:${raw}`);
        provider = raw as AiProviderId; i += 1; break;
      }
      case '--model': model = value(i, flag); i += 1; break;
      case '--endpoint': endpoint = value(i, flag); i += 1; break;
      case '--retries': retries = nonNegativeInt(value(i, flag), flag, retries); i += 1; break;
      case '--delay-ms': delayMs = nonNegativeInt(value(i, flag), flag, delayMs); i += 1; break;
      case '--pace-ms': paceMs = nonNegativeInt(value(i, flag), flag, paceMs); i += 1; break;
      case '--timeout-ms': timeoutMs = nonNegativeInt(value(i, flag), flag, timeoutMs); i += 1; break;
      case '--limit': limit = nonNegativeInt(value(i, flag), flag, limit); i += 1; break;
      case '--max-errors': maxErrors = nonNegativeInt(value(i, flag), flag, maxErrors); i += 1; break;
      case '--max-mistakes': maxMistakes = nonNegativeInt(value(i, flag), flag, maxMistakes); i += 1; break;
      case '--include-flagship': includeFlagship = true; break;
      case '--no-flagship': includeFlagship = false; break;
      case '--allow-bank-drift': allowBankDrift = true; break;
      case '--dry-run': dryRun = true; break;
      default: throw new Error(`UNKNOWN_ARG:${flag}`);
    }
  }
  return {
    bankDir,
    reportDir: reportDir ?? bankDir,
    perDifficulty,
    frontierPerDifficulty,
    seed,
    lang,
    provider,
    model,
    endpoint,
    retries,
    delayMs,
    paceMs,
    timeoutMs,
    includeFlagship,
    dryRun,
    limit,
    maxErrors,
    maxMistakes,
    label,
    allowBankDrift,
  };
}

function statusIcon(status: AnswerStatus): string {
  if (status === 'correct') return '✅';
  if (status === 'wrong') return '❌';
  if (status === 'refusal') return '🛑';
  if (status === 'error') return '💥';
  return '⚠️';
}

function providerHelp(): readonly string[] {
  return [
    'world:ai-eval — ไม่พบ API key ของผู้ให้บริการ AI จึงไม่รันการทดสอบ (ไม่มีการจำลองคำตอบ)',
    `  ตั้งค่า env var: ${PROVIDER_IDS.map((id) => PROVIDER_KEY_ENV[id].join(' หรือ ')).join(' | ')}`,
    '  เลือกผู้ให้บริการด้วย --provider gemini|openai|claude (หรือ NEXUS_AI_PROVIDER), โมเดลด้วย --model (หรือ NEXUS_AI_MODEL)',
    '  ดูรายการคำถามที่จะส่งโดยไม่ต้องมี key: --dry-run',
  ];
}

/** Asks the provider one question at a time and records every outcome. */
export async function runEval(
  args: EvalArgs,
  provider: ChatProvider,
  selected: readonly SampledItem[],
): Promise<{ results: EvalItemResult[]; stoppedEarly: boolean }> {
  const results: EvalItemResult[] = [];
  let consecutiveErrors = 0;
  let stoppedEarly = false;
  for (let i = 0; i < selected.length; i += 1) {
    const entry = selected[i]!;
    const itemStart = Date.now();
    let text = '';
    let error: string | undefined;
    try {
      text = await provider.chat({ system: SYSTEM_PROMPT, user: buildPrompt(entry.question, args.lang) });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const durationMs = Date.now() - itemStart;
    let status: AnswerStatus = 'error';
    let parsedIndex: number | null = null;
    if (error === undefined) {
      const classified = classifyAnswer(entry.question.answerIndex, text, entry.question.options);
      status = classified.status;
      parsedIndex = classified.parsedIndex;
      consecutiveErrors = 0;
    } else {
      consecutiveErrors += 1;
    }
    results.push({
      id: entry.question.id,
      index: entry.index,
      difficulty: entry.difficulty,
      flagship: entry.flagship,
      expectedIndex: entry.question.answerIndex,
      parsedIndex,
      status,
      correct: status === 'correct',
      answerText: truncate(text, 400),
      durationMs,
      ...(error === undefined ? {} : { error }),
    });
    const suffix = error === undefined ? '' : ` — ${truncate(error, 140)}`;
    console.log(`  [${i + 1}/${selected.length}] ${entry.question.id} (d${entry.difficulty}) ${statusIcon(status)} ${status}${suffix}`);
    if (args.maxErrors > 0 && consecutiveErrors >= args.maxErrors) {
      stoppedEarly = true;
      console.log(`  หยุดก่อนกำหนด: เรียกโมเดลล้มเหลวติดกัน ${consecutiveErrors} ครั้ง (เพดาน --max-errors ${args.maxErrors})`);
      break;
    }
    if (args.paceMs > 0 && i + 1 < selected.length) await sleep(args.paceMs);
  }
  return { results, stoppedEarly };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const started = Date.now();
  const args = parseEvalArgs(argv);
  const spec: SampleSpec = {
    perDifficulty: args.perDifficulty,
    frontierPerDifficulty: args.frontierPerDifficulty,
    seed: args.seed,
    includeFlagship: args.includeFlagship,
  };
  const fingerprint = bankFingerprint(args.bankDir);
  if (fingerprint.mismatches.length > 0 && !args.allowBankDrift) {
    console.error('world:ai-eval — คลังไม่ตรงกับ manifest.json จึงไม่รัน (ใช้ --allow-bank-drift เพื่อข้าม):');
    for (const mismatch of fingerprint.mismatches) console.error(`  ! ${mismatch}`);
    process.exitCode = 1;
    return;
  }
  const items = loadQuestions(args.bankDir);
  const { sample, shortfalls } = sampleBank(items, spec);
  const selected = args.limit > 0 ? sample.slice(0, args.limit) : sample;
  console.log(`world:ai-eval — คลัง ${args.bankDir}`);
  console.log(`  คลังทั้งหมด ${items.length} ข้อ · manifest ${fingerprint.manifestSha256 ?? '—'} · ตรวจ ${fingerprint.verifiedFiles}/10 ไฟล์`);
  console.log(`  stratified seed ${args.seed}: d1–d8 ระดับละ ${args.perDifficulty}, d9–d10 ระดับละ ${args.frontierPerDifficulty}, flagship ${args.includeFlagship ? 'รวม' : 'ไม่รวม'} → ${selected.length} ข้อ`);
  for (const shortfall of shortfalls) {
    console.log(`  ! d${shortfall.difficulty}: ขอ ${shortfall.requested} แต่คลังมีเพียง ${shortfall.available}`);
  }
  if (args.dryRun) {
    console.log('  --dry-run: ไม่เรียก AI และไม่เขียนรายงาน — รายการที่สุ่มได้:');
    for (const entry of selected) {
      console.log(`    ${entry.question.id} d${entry.difficulty} ${entry.question.primaryDiscipline}${entry.flagship ? ' (flagship)' : ''}`);
    }
    console.log('');
    console.log(selected[0] ? buildPrompt(selected[0].question, args.lang) : '(ไม่มีข้อที่สุ่มได้)');
    return;
  }
  const providerId = args.provider ?? detectProvider(process.env);
  if (!providerId) {
    for (const line of providerHelp()) console.error(line);
    process.exitCode = 1;
    return;
  }
  const apiKey = resolveKey(providerId, process.env);
  if (!apiKey) {
    for (const line of providerHelp()) console.error(line);
    process.exitCode = 1;
    return;
  }
  const model = args.model ?? ((process.env.NEXUS_AI_MODEL ?? '').trim() || DEFAULT_MODELS[providerId]);
  const endpoint = (args.endpoint ?? ((process.env.NEXUS_AI_ENDPOINT ?? '').trim() || DEFAULT_ENDPOINTS[providerId])).replace(/\/+$/, '');
  const provider = createProvider({
    id: providerId,
    apiKey,
    model,
    endpoint,
    retries: args.retries,
    delayMs: args.delayMs,
    timeoutMs: args.timeoutMs,
  });
  console.log(`  ผู้ให้บริการ: ${providerId} · โมเดล: ${model} · ภาษา prompt: ${args.lang} · เริ่มทดสอบ ${selected.length} ข้อ`);
  const { results, stoppedEarly } = await runEval(args, provider, selected);
  const summary = summarise({
    meta: {
      provider: providerId,
      model,
      endpoint,
      lang: args.lang,
      seed: args.seed,
      perDifficulty: args.perDifficulty,
      frontierPerDifficulty: args.frontierPerDifficulty,
      bankDir: args.bankDir,
      manifestSha256: fingerprint.manifestSha256,
      verifiedFiles: fingerprint.verifiedFiles,
    },
    label: args.label,
    results,
    durationMs: Date.now() - started,
    includeFlagship: args.includeFlagship,
    shortfalls,
    stoppedEarly,
    bankMismatches: fingerprint.mismatches,
  });
  const artifacts = writeEvalArtifacts(args.reportDir, summary, results, args.maxMistakes);
  console.log('');
  console.log('  ระดับ | sampled | answered | ถูก | แม่นยำ | แม่นยำเข้ม');
  for (const difficulty of DIFFICULTIES) {
    const bucket = summary.byDifficulty[String(difficulty)] ?? bucketOf([]);
    console.log(
      `  d${String(difficulty).padStart(2)}   | ${String(bucket.sampled).padStart(7)} | ${String(bucket.answered).padStart(8)} | ${String(bucket.correct).padStart(3)} | ${fmtPct(bucket.accuracyPct).padStart(7)} | ${fmtPct(bucket.strictAccuracyPct).padStart(10)}`,
    );
  }
  console.log('');
  console.log(`  รายงาน: ${artifacts.reportPath}`);
  console.log(`  ผลดิบ: ${artifacts.jsonPath}`);
  console.log(
    `world:ai-eval finished in ${((Date.now() - started) / 1000).toFixed(1)} s — overall ${fmtPct(summary.overall.accuracyPct)} (ถูก ${summary.overall.correct}/${summary.overall.answered} ที่ตอบได้ · error ${summary.overall.errors} · parse fail ${summary.overall.parseFailures} · refusal ${summary.overall.refusals})`,
  );
  process.exitCode = summary.overall.errors > 0 ? 2 : 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(`world:ai-eval failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
