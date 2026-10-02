import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chainUrlFromEnv, createQuizChainClient } from './chain-client';

const STATUS = {
  height: 4,
  openHeight: 5,
  lastMilestoneHeight: 0,
  totalAttempts: 12_345,
};

const QUESTION = {
  blockHeight: 5,
  question: {
    id: 'q-000005',
    disciplineId: 'math',
    disciplineTh: 'คณิตศาสตร์',
    disciplineEn: 'Mathematics',
    difficulty: 3,
    promptTh: 'โจทย์ภาษาไทย',
    promptEn: 'English prompt',
    options: ['a', 'b', 'c', 'd'],
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe('chainUrlFromEnv', () => {
  const KEY = 'EXPO_PUBLIC_QUIZ_CHAIN_URL';

  it('returns null when unset or blank', () => {
    delete process.env[KEY];
    expect(chainUrlFromEnv()).toBeNull();
    process.env[KEY] = '   ';
    expect(chainUrlFromEnv()).toBeNull();
  });

  it('reads and strips trailing slashes', () => {
    process.env[KEY] = 'http://192.168.1.10:4100/';
    expect(chainUrlFromEnv()).toBe('http://192.168.1.10:4100');
    delete process.env[KEY];
  });
});

describe('createQuizChainClient', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the node status payload', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(STATUS));
    const client = createQuizChainClient('http://node:4100');
    const summary = await client.fetchSummary();
    expect(summary).toEqual(STATUS);
    expect(fetchSpy).toHaveBeenCalledWith('http://node:4100/api/status');
  });

  it('maps the current question payload', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(QUESTION));
    const client = createQuizChainClient('http://node:4100');
    const question = await client.fetchCurrentQuestion();
    expect(question).toEqual({
      id: 'q-000005',
      blockHeight: 5,
      disciplineId: 'math',
      disciplineTh: 'คณิตศาสตร์',
      disciplineEn: 'Mathematics',
      difficulty: 3,
      promptTh: 'โจทย์ภาษาไทย',
      promptEn: 'English prompt',
      options: ['a', 'b', 'c', 'd'],
    });
  });

  it('returns null for NO_OPEN_BLOCK (node reachable, no open block)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'NO_OPEN_BLOCK' }, 404));
    const client = createQuizChainClient('http://node:4100');
    expect(await client.fetchCurrentQuestion()).toBeNull();
  });

  it('throws on non-404 HTTP errors so the hook can show the offline state', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 503));
    const client = createQuizChainClient('http://node:4100');
    await expect(client.fetchSummary()).rejects.toThrow('QUIZ_CHAIN_HTTP_503');
  });

  it('submits an answer without ever surfacing correctness (no oracle)', async () => {
    // A stale server might still send `correct`; the client must drop it, so
    // the screen can never show right/wrong while the block is open.
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true, correct: true, messageTh: 'accepted' }));
    const client = createQuizChainClient('http://node:4100');
    const outcome = await client.submitAnswer(5, 2);
    expect(outcome).toEqual({ ok: true });
    expect('correct' in outcome).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://node:4100/api/answer');
    expect(JSON.parse(String(init.body))).toEqual({ blockHeight: 5, choice: 2, miner: 'expo-app' });
  });

  it('classifies a node rejection as rejected, not network', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'BLOCK_HEIGHT_MISMATCH' }, 409));
    const client = createQuizChainClient('http://node:4100');
    expect(await client.submitAnswer(4, 0)).toEqual({ ok: false, kind: 'rejected' });
  });

  it('classifies a fetch throw as network', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network request failed'));
    const client = createQuizChainClient('http://node:4100');
    expect(await client.submitAnswer(5, 1)).toEqual({ ok: false, kind: 'network' });
  });

  it('classifies a 5xx as server error, not a bad answer', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    const client = createQuizChainClient('http://node:4100');
    expect(await client.submitAnswer(5, 1)).toEqual({ ok: false, kind: 'error' });
  });
});
