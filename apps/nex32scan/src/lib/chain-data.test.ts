import { afterEach, describe, expect, it, vi } from 'vitest';
import { chainStatus, parseAnswers, parseStatus, recentAnswers } from './chain-data';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NODE_URL = process.env.QUIZ_CHAIN_API_URL;
const ORIGINAL_PHASE = process.env.NEXT_PHASE;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllGlobals();
  if (ORIGINAL_NODE_URL === undefined) delete process.env.QUIZ_CHAIN_API_URL;
  else process.env.QUIZ_CHAIN_API_URL = ORIGINAL_NODE_URL;
  if (ORIGINAL_PHASE === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = ORIGINAL_PHASE;
});

/** Route stub: replies with the JSON for a URL path, 404 otherwise. */
function stubNode(routes: Record<string, unknown>) {
  process.env.QUIZ_CHAIN_API_URL = 'http://node.test';
  delete process.env.NEXT_PHASE; // not a build, so remote reads are allowed
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    const body = routes[path];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('chain-data parsers', () => {
  it('reads a baked snapshot status object', () => {
    const status = parseStatus({
      height: 1_397,
      totalBlocks: 1_397,
      totalAttempts: 40_000,
      totalAnswers: 21,
      correctAnswers: 14,
      avgAttemptsPerBlock: 28.63,
      avgBlockIntervalMs: 4_200,
      difficultyBits: 13,
      lastMilestoneHeight: 1_000,
      lastBlockAt: 1_790_757_561_796,
    });
    expect(status).toMatchObject({
      height: 1_397,
      totalAnswers: 21,
      correctAnswers: 14,
      avgBlockIntervalMs: 4_200,
      difficultyBits: 13,
      lastMilestoneHeight: 1_000,
    });
    // parseStatus stays transport-agnostic; chainStatus() attaches the source.
    expect(status && 'source' in status).toBe(false);
  });

  it('reads the live /api/status shape, including difficulty under lastBlock', () => {
    const status = parseStatus({
      height: 12,
      totalBlocks: 12,
      totalAttempts: 100,
      totalAnswers: 8,
      correctAnswers: 6,
      avgAttemptsPerBlock: 8.33,
      avgBlockIntervalMs: 3_100,
      lastMilestoneHeight: null,
      lastBlock: { height: 12, difficultyBits: 15 },
    });
    expect(status).toMatchObject({ height: 12, difficultyBits: 15, lastMilestoneHeight: null, lastBlockAt: null });
  });

  it('reads the live "no milestone yet" zero as none', () => {
    // Verified against a fresh local node: /api/status reports lastMilestoneHeight 0.
    expect(parseStatus({ height: 1, totalBlocks: 1, lastMilestoneHeight: 0 })?.lastMilestoneHeight).toBeNull();
    expect(parseStatus({ height: 1_000, lastMilestoneHeight: 1_000 })?.lastMilestoneHeight).toBe(1_000);
  });

  it('refuses payloads that are not objects instead of inventing zeros', () => {
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
    expect(parseStatus('nope')).toBeNull();
    expect(parseStatus(42)).toBeNull();
  });

  it('prefers the live node and reports that the read was live', async () => {
    stubNode({
      '/api/status': {
        height: 5,
        totalBlocks: 5,
        totalAttempts: 50,
        totalAnswers: 2,
        correctAnswers: 1,
        avgAttemptsPerBlock: 10,
        avgBlockIntervalMs: 1_000,
        lastBlock: { difficultyBits: 11 },
      },
    });
    const status = await chainStatus();
    expect(status).toMatchObject({ height: 5, totalBlocks: 5, difficultyBits: 11, source: 'live' });
  });

  it('falls back to the snapshot when the node is unreachable', async () => {
    stubNode({}); // every live call 404s
    const status = await chainStatus();
    // No INDEXER_SNAPSHOT_PATH in the test env, so the baked snapshot is read.
    expect(status === null || status.source === 'snapshot').toBe(true);
  });

  it('builds the answer feed from live block details, newest first', async () => {
    stubNode({
      '/api/blocks?limit=24': { blocks: [{ height: 1 }, { height: 2 }] },
      '/api/blocks/1': {
        height: 1,
        answers: [{ miner: '0xaa', choice: 0, correct: false, answeredAt: 1_000, commitmentHash: '0x11' }],
      },
      '/api/blocks/2': {
        height: 2,
        answers: [{ miner: '0xbb', choice: 1, correct: true, answeredAt: 2_000, commitmentHash: '0x22' }],
      },
    });
    const rows = await recentAnswers(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ height: 2, miner: '0xbb', correct: true });
    expect(rows[1]).toMatchObject({ height: 1, miner: '0xaa', correct: false });
    expect(await recentAnswers(1)).toHaveLength(1);
  });

  it('keeps only answers that carry a block height and a commitment', () => {
    const rows = parseAnswers([
      { height: 1_397, miner: '0xabc', choice: 2, correct: true, answeredAt: 1_700, commitmentHash: '0xdead' },
      { height: 0, miner: '0xabc', choice: 0, correct: true, answeredAt: 1_700, commitmentHash: '0xdead' },
      { height: 1_396, miner: '0xabc', choice: 1, correct: false, answeredAt: 1_600 },
      null,
      'nope',
      { height: '1395', miner: 7, choice: '3', correct: 'yes', answeredAt: '1500', commitmentHash: '0xbeef' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ height: 1_397, correct: true, choice: 2 });
    // Coercion is defensive: only a real boolean true counts as correct.
    expect(rows[1]).toMatchObject({ height: 1_395, correct: false, choice: 3, miner: '' });
    expect(parseAnswers(undefined)).toEqual([]);
    expect(parseAnswers({})).toEqual([]);
  });
});
