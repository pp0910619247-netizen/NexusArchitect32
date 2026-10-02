import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorldQuestion } from '../src/worldbank/compose.js';
import { defaultOutDir } from '../src/worldbank/generate.js';
import { mulberry32 } from '../src/worldbank/ladder.js';
import {
  DEFAULT_FRONTIER_PER_DIFFICULTY,
  DEFAULT_PER_DIFFICULTY,
  DEFAULT_SEED,
  DIFFICULTIES,
  FLAGSHIP_ID,
  bucketOf,
  buildEvalReport,
  buildPrompt,
  classifyAnswer,
  createProvider,
  detectProvider,
  drawIndices,
  extractClaudeText,
  extractGeminiText,
  extractOpenAiText,
  loadQuestions,
  parseAnswerIndex,
  parseEvalArgs,
  postJson,
  quotaFor,
  resolveKey,
  sampleBank,
  summarise,
  writeEvalArtifacts,
  type AnswerStatus,
  type BankItem,
  type EvalItemResult,
  type EvalRunMeta,
  type SampleSpec,
} from '../src/worldbank/ai-eval.js';

const OPTIONS = ['หนึ่ง หนึ่ง', 'สอง สอง', 'สาม สาม', 'สี่ สี่'] as const;

function questionAt(difficulty: number, n: number): WorldQuestion {
  return {
    id: `wk-${String(n).padStart(6, '0')}`,
    disciplines: ['math', 'science'],
    primaryDiscipline: 'math',
    subjectCount: 2,
    difficulty,
    prompt: { th: `โจทย์ d${difficulty} ข้อ ${n}`, en: `Question d${difficulty} number ${n}` },
    options: OPTIONS,
    answerIndex: n % 4,
    explanation: { th: 'อธิบาย', en: 'explain' },
    tags: ['tag'],
    verifiedYear: 2026,
  };
}

/** 10 difficulty levels x `perLevel` items, in index order (like the real bank). */
function syntheticBank(perLevel: number): BankItem[] {
  const items: BankItem[] = [];
  let index = 0;
  for (const difficulty of DIFFICULTIES) {
    for (let k = 0; k < perLevel; k += 1) {
      items.push({ index, question: questionAt(difficulty, index + 1) });
      index += 1;
    }
  }
  return items;
}

function spec(over: Partial<SampleSpec> = {}): SampleSpec {
  return { perDifficulty: 3, frontierPerDifficulty: 5, seed: DEFAULT_SEED, includeFlagship: true, ...over };
}

describe('world-v1 ai-eval — stratified sampler', () => {
  it('draws the same sample for the same seed and a different one for another seed', () => {
    const bank = syntheticBank(20);
    const first = sampleBank(bank, spec()).sample.map((entry) => entry.question.id);
    const second = sampleBank(bank, spec()).sample.map((entry) => entry.question.id);
    expect(first).toEqual(second);
    expect(sampleBank(bank, spec({ seed: 'another-seed' })).sample.map((entry) => entry.question.id)).not.toEqual(first);
  });

  it('fills the quota of every difficulty level and orders by difficulty then bank index', () => {
    const bank = syntheticBank(20);
    const plain = spec({ includeFlagship: false });
    const { sample, shortfalls } = sampleBank(bank, plain);
    expect(shortfalls).toEqual([]);
    for (const difficulty of DIFFICULTIES) {
      expect(sample.filter((entry) => entry.difficulty === difficulty)).toHaveLength(quotaFor(difficulty, plain));
    }
    expect(sample).toHaveLength(8 * 3 + 2 * 5);
    const order = sample.map((entry) => entry.difficulty * 1_000 + entry.index);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('gives the frontier band a larger allowance than the easy band', () => {
    const plain = spec();
    expect(quotaFor(10, plain)).toBe(plain.frontierPerDifficulty);
    expect(quotaFor(9, plain)).toBe(plain.frontierPerDifficulty);
    expect(quotaFor(8, plain)).toBe(plain.perDifficulty);
    expect(quotaFor(1, plain)).toBe(plain.perDifficulty);
  });

  it('never repeats an item, even when the quota is the whole level', () => {
    const bank = syntheticBank(20);
    const { sample } = sampleBank(bank, spec({ perDifficulty: 20, frontierPerDifficulty: 20, includeFlagship: false }));
    expect(sample).toHaveLength(200);
    expect(new Set(sample.map((entry) => entry.question.id)).size).toBe(200);
  });

  it('reports a shortfall instead of silently shrinking the quota', () => {
    const bank = syntheticBank(4);
    const { sample, shortfalls } = sampleBank(bank, spec({ perDifficulty: 10, frontierPerDifficulty: 10, includeFlagship: false }));
    expect(shortfalls).toContainEqual({ difficulty: 1, requested: 10, available: 4 });
    expect(shortfalls).toHaveLength(10);
    expect(sample.filter((entry) => entry.difficulty === 1)).toHaveLength(4);
    expect(sample).toHaveLength(40);
  });

  it('flags only the flagship item and only when it is asked for', () => {
    const bank = syntheticBank(20);
    const flagshipItem: BankItem = { index: 500, question: { ...questionAt(10, 500), id: FLAGSHIP_ID } };
    const withFlagship = sampleBank([...bank, flagshipItem], spec({ perDifficulty: 1, frontierPerDifficulty: 1, includeFlagship: true }));
    expect(withFlagship.sample.filter((entry) => entry.question.id === FLAGSHIP_ID)).toHaveLength(1);
    expect(withFlagship.sample.filter((entry) => entry.flagship).map((entry) => entry.question.id)).toEqual([FLAGSHIP_ID]);
    const without = sampleBank(bank, spec({ includeFlagship: false }));
    expect(without.sample.some((entry) => entry.flagship)).toBe(false);
  });

  it('drawIndices is bounded by the pool and never repeats', () => {
    const rng = mulberry32(7);
    const picked = drawIndices([1, 2, 3, 4, 5], 3, rng);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const value of picked) expect([1, 2, 3, 4, 5]).toContain(value);
    expect(drawIndices([1, 2], 5, rng)).toHaveLength(2);
    expect(drawIndices([1, 2], 0, rng)).toEqual([]);
  });
});

describe('world-v1 ai-eval — answer parsing', () => {
  const cases: readonly (readonly [string, number | null])[] = [
    ['B', 1],
    [' d ', 3],
    ['(C)', 2],
    ['**D**', 3],
    ['A.', 0],
    ['Option 3', 2],
    ['The correct answer is A.', 0],
    ['คำตอบ: C', 2],
    ['A is wrong, B is correct', 1],
    ['B เป็นคำตอบที่ถูกต้อง', 1],
    ['2', 1],
    ['ข้อ 4', 3],
    ['สาม สาม', 2],
  ];

  it('reads every answer shape a model may realistically return', () => {
    for (const [text, expected] of cases) {
      expect(parseAnswerIndex(text, OPTIONS), text).toBe(expected);
    }
  });

  it('refuses to guess when the output is empty, ambiguous or out of range', () => {
    for (const text of ['', '   ', 'I am not sure', 'A, B or C — all plausible', '5', '???']) {
      expect(parseAnswerIndex(text, OPTIONS), text).toBeNull();
    }
  });

  it('classifies correct, wrong, refusal and parse failure', () => {
    expect(classifyAnswer(2, 'C', OPTIONS)).toEqual({ status: 'correct', parsedIndex: 2 });
    expect(classifyAnswer(2, 'A', OPTIONS)).toEqual({ status: 'wrong', parsedIndex: 0 });
    expect(classifyAnswer(2, 'I cannot answer that.', OPTIONS)).toEqual({ status: 'refusal', parsedIndex: null });
    expect(classifyAnswer(2, '???', OPTIONS)).toEqual({ status: 'parse_failure', parsedIndex: null });
  });

  it('renders the stem and all four options without leaking the answer position', () => {
    const question: WorldQuestion = { ...questionAt(7, 42), prompt: { th: 'โจทย์ทดสอบ', en: 'Test stem without digits' }, answerIndex: 3 };
    const en = buildPrompt(question, 'en');
    expect(en.startsWith('Test stem without digits')).toBe(true);
    expect(en).toContain('Test stem without digits');
    for (const option of question.options) expect(en).toContain(option);
    expect(en).toMatch(/^A\. /m);
    expect(en).toMatch(/^D\. /m);
    expect(en).not.toContain('3');
    expect(buildPrompt(question, 'th')).toContain('โจทย์ทดสอบ');
  });
});

describe('world-v1 ai-eval — provider plumbing', () => {
  it('extracts text from each provider payload and tolerates junk', () => {
    expect(extractGeminiText({ candidates: [{ content: { parts: [{ text: 'B' }] } }] })).toBe('B');
    expect(extractGeminiText({ candidates: [{ content: { parts: [{ text: 'A' }, { text: 'B' }] } }] })).toBe('AB');
    expect(extractGeminiText({})).toBe('');
    expect(extractGeminiText(null)).toBe('');
    expect(extractOpenAiText({ choices: [{ message: { content: 'C' } }] })).toBe('C');
    expect(extractOpenAiText({ choices: [{ text: 'D' }] })).toBe('D');
    expect(extractOpenAiText({ choices: [] })).toBe('');
    expect(extractClaudeText({ content: [{ type: 'text', text: 'A' }, { type: 'thinking', thinking: 'x' }, { text: 'B' }] })).toBe('AB');
    expect(extractClaudeText({})).toBe('');
  });

  it('retries 429 responses and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const json = await postJson('https://example.test/x', {}, { a: 1 }, { retries: 3, delayMs: 1, timeoutMs: 1_000, fetchImpl });
    expect(json).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('fails fast on a non-retryable 4xx (bad key, bad model)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('invalid api key', { status: 401 });
    }) as unknown as typeof fetch;
    await expect(postJson('https://example.test/x', {}, {}, { retries: 3, delayMs: 1, timeoutMs: 1_000, fetchImpl })).rejects.toThrow('HTTP_401');
    expect(calls).toBe(1);
  });

  it('spends the whole retry budget on network failures', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(postJson('https://example.test/x', {}, {}, { retries: 2, delayMs: 1, timeoutMs: 1_000, fetchImpl })).rejects.toThrow('NETWORK');
    expect(calls).toBe(3);
  });

  it('builds an OpenAI chat call with the system message and bearer header', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'D' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createProvider({
      id: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-x',
      endpoint: 'https://api.openai.com/v1',
      retries: 0,
      delayMs: 1,
      timeoutMs: 1_000,
      fetchImpl,
    });
    await expect(provider.chat({ system: 'SYS', user: 'USER' })).resolves.toBe('D');
    expect(seenUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect((seenInit?.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(seenInit?.body))).toMatchObject({
      model: 'gpt-x',
      messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }],
    });
  });

  it('builds a Gemini call with the model in the path and the key in the query', async () => {
    let seenUrl = '';
    const fetchImpl = (async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createProvider({
      id: 'gemini',
      apiKey: 'k-1',
      model: 'gemini-x',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      retries: 0,
      delayMs: 1,
      timeoutMs: 1_000,
      fetchImpl,
    });
    await expect(provider.chat({ system: 's', user: 'u' })).resolves.toBe('A');
    expect(seenUrl).toContain('/models/gemini-x:generateContent');
    expect(seenUrl).toContain('key=k-1');
  });

  it('detects the provider from the environment and trims keys', () => {
    expect(detectProvider({})).toBeNull();
    expect(detectProvider({ GEMINI_API_KEY: 'x' })).toBe('gemini');
    expect(detectProvider({ GOOGLE_API_KEY: 'x' })).toBe('gemini');
    expect(detectProvider({ OPENAI_API_KEY: 'x' })).toBe('openai');
    expect(detectProvider({ ANTHROPIC_API_KEY: 'x' })).toBe('claude');
    expect(detectProvider({ NEXUS_AI_PROVIDER: 'claude' })).toBe('claude');
    expect(() => detectProvider({ NEXUS_AI_PROVIDER: 'grok' })).toThrow('UNKNOWN_PROVIDER');
    expect(resolveKey('gemini', {})).toBeNull();
    expect(resolveKey('openai', { OPENAI_API_KEY: '  sk-x  ' })).toBe('sk-x');
  });
});

function meta(over: Partial<EvalRunMeta> = {}): EvalRunMeta {
  return {
    provider: 'gemini',
    model: 'gemini-test',
    endpoint: 'https://example.test',
    lang: 'en',
    seed: DEFAULT_SEED,
    perDifficulty: 1,
    frontierPerDifficulty: 1,
    bankDir: '/tmp/world-v1',
    manifestSha256: 'deadbeef',
    verifiedFiles: 10,
    ...over,
  };
}

function mkResult(id: string, difficulty: number, status: AnswerStatus, flagship = false): EvalItemResult {
  return {
    id,
    index: 0,
    difficulty,
    flagship,
    expectedIndex: 1,
    parsedIndex: status === 'correct' ? 1 : status === 'wrong' ? 2 : null,
    status,
    correct: status === 'correct',
    answerText: 'B',
    durationMs: 3,
    ...(status === 'error' ? { error: 'HTTP_500:boom' } : {}),
  };
}

describe('world-v1 ai-eval — scoring and report', () => {
  it('counts each outcome and computes both accuracy figures', () => {
    const bucket = bucketOf([
      mkResult('wk-000001', 1, 'correct'),
      mkResult('wk-000002', 1, 'correct'),
      mkResult('wk-000003', 1, 'wrong'),
      mkResult('wk-000004', 1, 'parse_failure'),
      mkResult('wk-000005', 1, 'refusal'),
      mkResult('wk-000006', 1, 'error'),
    ]);
    expect(bucket).toMatchObject({ sampled: 6, answered: 3, correct: 2, wrong: 1, parseFailures: 1, refusals: 1, errors: 1 });
    expect(bucket.accuracyPct).toBe(66.7);
    expect(bucket.strictAccuracyPct).toBe(33.3);
  });

  it('reports no accuracy at all when nothing was answered', () => {
    const bucket = bucketOf([mkResult('wk-000001', 5, 'error')]);
    expect(bucket.accuracyPct).toBeNull();
    expect(bucket.strictAccuracyPct).toBe(0);
  });

  it('summarises by difficulty, band and flagship', () => {
    const results = [
      mkResult('wk-000001', 10, 'wrong', true),
      mkResult('wk-000900', 9, 'correct'),
      mkResult('wk-001001', 3, 'correct'),
      mkResult('wk-002000', 1, 'parse_failure'),
    ];
    const summary = summarise({
      meta: meta(),
      label: 'unit',
      results,
      durationMs: 1_500,
      includeFlagship: true,
      shortfalls: [],
      stoppedEarly: false,
      bankMismatches: [],
    });
    expect(Object.keys(summary.byDifficulty)).toEqual(DIFFICULTIES.map((value) => String(value)));
    expect(summary.byDifficulty['9']).toMatchObject({ sampled: 1, correct: 1, accuracyPct: 100 });
    expect(summary.byDifficulty['1']).toMatchObject({ sampled: 1, correct: 0, accuracyPct: null });
    expect(summary.byDifficulty['5']).toMatchObject({ sampled: 0, accuracyPct: null });
    expect(summary.byBand.find((entry) => entry.band === 'frontier')).toMatchObject({ sampled: 2, correct: 1, accuracyPct: 50 });
    expect(summary.byBand.find((entry) => entry.band === 'easy')).toMatchObject({ sampled: 1, parseFailures: 1 });
    expect(summary.flagship).toMatchObject({ sampled: 1, correct: 0 });
    expect(summary.sampled).toBe(4);
    expect(summary.overall).toMatchObject({ sampled: 4, answered: 3, correct: 2 });
  });

  it('writes a JSON payload and a markdown report carrying the real numbers', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nexus-ai-eval-'));
    try {
      const results = [mkResult('wk-000001', 1, 'correct'), mkResult('wk-000002', 10, 'wrong', true), mkResult('wk-000003', 10, 'error')];
      const summary = summarise({
        meta: meta(),
        label: 'unit-run',
        results,
        durationMs: 2_000,
        includeFlagship: true,
        shortfalls: [],
        stoppedEarly: false,
        bankMismatches: [],
      });
      const artifacts = writeEvalArtifacts(dir, summary, results, 5);
      const payload = JSON.parse(readFileSync(artifacts.jsonPath, 'utf8')) as { summary: { provider: string; label: string }; items: unknown[] };
      expect(payload.summary.provider).toBe('gemini');
      expect(payload.summary.label).toBe('unit-run');
      expect(payload.items).toHaveLength(3);
      const md = readFileSync(artifacts.reportPath, 'utf8');
      expect(md).toContain('accuracy by difficulty');
      expect(md).toContain('| d1 |');
      expect(md).toContain('| d10 |');
      expect(md).toContain('gemini-test');
      expect(md).not.toContain('undefined');
      expect(md).not.toContain('[object Object]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a report that flags a shortfall, bank drift and the mistakes list', () => {
    const results = [mkResult('wk-000003', 2, 'wrong'), mkResult('wk-000004', 2, 'refusal')];
    const summary = summarise({
      meta: meta(),
      label: 'unit',
      results,
      durationMs: 10,
      includeFlagship: false,
      shortfalls: [{ difficulty: 2, requested: 9, available: 2 }],
      stoppedEarly: true,
      bankMismatches: ['questions-00001-01000.jsonl: sha256 differs from manifest'],
    });
    const md = buildEvalReport({ summary, items: results, maxMistakes: 5 });
    expect(md).toContain('ขอ 9 แต่มี 2');
    expect(md).toContain('คลังไม่ตรงกับ manifest');
    expect(md).toContain('wk-000003');
    expect(md).toContain('wk-000004');
    expect(md).toContain('รันหยุดก่อนครบโควตา');
    expect(md).not.toContain('undefined');
  });
});

describe('world-v1 ai-eval — CLI flags', () => {
  it('parses the flags it documents', () => {
    const args = parseEvalArgs(['--per-difficulty', '7', '--frontier', '30', '--lang', 'th', '--provider', 'claude', '--no-flagship', '--dry-run', '--limit', '4', '--seed', 's1', '--label', 'unit', '--pace-ms', '0']);
    expect(args).toMatchObject({ perDifficulty: 7, frontierPerDifficulty: 30, lang: 'th', provider: 'claude', includeFlagship: false, dryRun: true, limit: 4, seed: 's1', label: 'unit', paceMs: 0 });
    expect(args.reportDir).toBe(args.bankDir);
  });

  it('defaults to a stratified frontier-heavy run over the standard bank', () => {
    const args = parseEvalArgs([]);
    expect(args).toMatchObject({
      perDifficulty: DEFAULT_PER_DIFFICULTY,
      frontierPerDifficulty: DEFAULT_FRONTIER_PER_DIFFICULTY,
      lang: 'en',
      provider: null,
      model: null,
      includeFlagship: true,
      dryRun: false,
      limit: 0,
      allowBankDrift: false,
    });
    expect(args.seed).toBe(DEFAULT_SEED);
  });

  it('rejects unknown flags and bad values instead of guessing', () => {
    expect(() => parseEvalArgs(['--nope'])).toThrow('UNKNOWN_ARG');
    expect(() => parseEvalArgs(['--seed'])).toThrow('MISSING_ARG_VALUE');
    expect(() => parseEvalArgs(['--lang', 'jp'])).toThrow('INVALID_ARG');
    expect(() => parseEvalArgs(['--provider', 'grok'])).toThrow('INVALID_ARG');
    expect(() => parseEvalArgs(['--limit', '-3'])).toThrow('INVALID_ARG');
    expect(() => parseEvalArgs(['--per-difficulty', '1.5'])).toThrow('INVALID_ARG');
  });
});

describe('world-v1 ai-eval — real bank integration (skipped when the bank is absent)', () => {
  const bankDir = defaultOutDir();
  const bankExists = existsSync(path.join(bankDir, 'questions-00001-01000.jsonl'));

  it.runIf(bankExists)('loads the generated 10,000-item bank without gaps or reordering', () => {
    const items = loadQuestions(bankDir);
    expect(items).toHaveLength(10_000);
    expect(items[0]?.question.id).toBe(FLAGSHIP_ID);
    expect(items[0]?.question.difficulty).toBe(10);
    expect(items[9_999]?.question.id).toBe('wk-010000');
    const mismatched = items.filter((item) => item.question.id !== `wk-${String(item.index + 1).padStart(6, '0')}`);
    expect(mismatched).toEqual([]);
  });

  it.runIf(bankExists)('stratifies a dry-run sample over the real bank with no shortfall', () => {
    const items = loadQuestions(bankDir);
    const plan: SampleSpec = { perDifficulty: 2, frontierPerDifficulty: 3, seed: DEFAULT_SEED, includeFlagship: false };
    const { sample, shortfalls } = sampleBank(items, plan);
    expect(shortfalls).toEqual([]);
    expect(sample).toHaveLength(22);
    for (const difficulty of DIFFICULTIES) {
      expect(sample.filter((entry) => entry.difficulty === difficulty)).toHaveLength(quotaFor(difficulty, plan));
    }
    for (const entry of sample) {
      expect(entry.question.difficulty).toBe(entry.difficulty);
      expect(entry.question.options).toHaveLength(4);
      expect(entry.question.answerIndex).toBeGreaterThanOrEqual(0);
      expect(entry.question.answerIndex).toBeLessThan(4);
      expect(entry.question.prompt.en.length).toBeGreaterThan(0);
      expect(entry.question.prompt.th.length).toBeGreaterThan(0);
      expect(buildPrompt(entry.question, 'en')).toContain(entry.question.prompt.en);
    }
    const withFlagship = sampleBank(items, { ...plan, includeFlagship: true });
    expect(withFlagship.sample.some((entry) => entry.question.id === FLAGSHIP_ID && entry.flagship)).toBe(true);
  });
});
