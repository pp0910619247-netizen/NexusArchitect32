/**
 * Chain-wide data the explorer needs on every page: the stat-bar aggregates and
 * the newest answer feed (the explorer's "latest transactions" table).
 *
 * Source rules match ./explorer — the live node when `QUIZ_CHAIN_API_URL` is
 * set, otherwise the snapshot baked into the build (`EXPLORER_RUNTIME_JSON`
 * overrides at runtime, `INDEXER_SNAPSHOT_PATH` reads a local export). Every
 * read is fail-soft: pages render what they have instead of throwing.
 */
import { readFile } from 'node:fs/promises';
import { remoteApiUrl, runtimeRawJson } from './explorer';

/** Aggregates for the stat bar (`/api/status` on the node). */
export interface ChainStatusCore {
  readonly height: number;
  readonly totalBlocks: number;
  readonly totalAttempts: number;
  readonly totalAnswers: number;
  readonly correctAnswers: number;
  readonly avgAttemptsPerBlock: number;
  readonly avgBlockIntervalMs: number | null;
  readonly difficultyBits: number;
  readonly lastMilestoneHeight: number | null;
  readonly lastBlockAt: number | null;
}

/**
 * Chain aggregates plus where the read came from. The chrome says "live" only
 * when a live read really succeeded — never because an env var exists.
 */
export interface ChainStatus extends ChainStatusCore {
  readonly source: 'live' | 'snapshot';
}

/** One answer = one "transaction" of the knowledge chain. */
export interface AnswerRow {
  readonly height: number;
  readonly miner: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly answeredAt: number;
  readonly commitmentHash: string;
}

/** How many sealed blocks the live mode inspects when listing recent answers. */
const ANSWER_FEED_BLOCKS = 24;

const FETCH_TIMEOUT_MS = 4_000;

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes a status payload (live `/api/status` or the baked snapshot's
 * `status` object) into {@link ChainStatus}.
 *
 * @returns `null` when the payload is not an object, so callers can hide the
 *          stat bar instead of printing zeros as if they were real.
 */
export function parseStatus(raw: unknown): ChainStatusCore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  // The live `/api/status` nests the current difficulty under `lastBlock`.
  const lastBlock =
    typeof value.lastBlock === 'object' && value.lastBlock !== null
      ? (value.lastBlock as Record<string, unknown>)
      : null;
  // The live node reports "0" for a chain that never reached a milestone, so a
  // zero must read as "none" rather than as block #0.
  const milestone = toOptionalNumber(value.lastMilestoneHeight);
  return {
    height: toNumber(value.height),
    totalBlocks: toNumber(value.totalBlocks),
    totalAttempts: toNumber(value.totalAttempts),
    totalAnswers: toNumber(value.totalAnswers),
    correctAnswers: toNumber(value.correctAnswers),
    avgAttemptsPerBlock: toNumber(value.avgAttemptsPerBlock),
    avgBlockIntervalMs: toOptionalNumber(value.avgBlockIntervalMs),
    difficultyBits: toNumber(value.difficultyBits ?? lastBlock?.difficultyBits),
    lastMilestoneHeight: milestone !== null && milestone > 0 ? milestone : null,
    lastBlockAt: toOptionalNumber(value.lastBlockAt),
  };
}

/**
 * Normalizes an answer list. Rows without a usable block height or commitment
 * are dropped — a malformed snapshot must not render half-empty table rows.
 */
export function parseAnswers(raw: unknown): AnswerRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: AnswerRow[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const value = item as Record<string, unknown>;
    const height = toNumber(value.height, Number.NaN);
    const commitmentHash = typeof value.commitmentHash === 'string' ? value.commitmentHash : '';
    if (!Number.isSafeInteger(height) || height < 1 || commitmentHash.length === 0) continue;
    rows.push({
      height,
      miner: typeof value.miner === 'string' ? value.miner : '',
      choice: toNumber(value.choice),
      correct: value.correct === true,
      answeredAt: toNumber(value.answeredAt),
      commitmentHash,
    });
  }
  return rows;
}

/** Snapshot JSON from a local export (file mode) or the build-time baked value. */
async function snapshotJson(): Promise<unknown> {
  const snapshotPath = process.env.INDEXER_SNAPSHOT_PATH;
  if (snapshotPath) {
    try {
      return JSON.parse(await readFile(snapshotPath, 'utf8'));
    } catch {
      // Local export only exists on the exporting machine — fall through to the
      // snapshot baked into the build.
    }
  }
  const raw = runtimeRawJson();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** One fail-soft GET against the node API (never throws, bounded timeout). */
async function fetchJson(baseUrl: string, path: string): Promise<unknown> {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Chain aggregates: live node first, baked snapshot when it is unreachable. */
export async function chainStatus(): Promise<ChainStatus | null> {
  const baseUrl = remoteApiUrl();
  if (baseUrl) {
    const live = parseStatus(await fetchJson(baseUrl, '/api/status'));
    if (live && live.totalBlocks > 0) return { ...live, source: 'live' };
  }
  const snapshot = await snapshotJson();
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const baked = parseStatus((snapshot as Record<string, unknown>).status);
  return baked ? { ...baked, source: 'snapshot' } : null;
}

/** Newest answers across the chain, newest first. */
export async function recentAnswers(limit = 20): Promise<AnswerRow[]> {
  const baseUrl = remoteApiUrl();
  if (baseUrl) {
    const live = await liveAnswers(baseUrl, limit);
    if (live.length > 0) return live;
  }
  const snapshot = await snapshotJson();
  if (typeof snapshot !== 'object' || snapshot === null) return [];
  const rows = parseAnswers((snapshot as Record<string, unknown>).recentAnswers);
  return rows.slice(0, limit);
}

/**
 * The node exposes answers per block only, so the feed reads the newest block
 * list and then fetches those block details in parallel.
 */
async function liveAnswers(baseUrl: string, limit: number): Promise<AnswerRow[]> {
  const list = await fetchJson(baseUrl, `/api/blocks?limit=${ANSWER_FEED_BLOCKS}`);
  const blocks = (list as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return [];
  const heights = blocks
    .map((block) => toNumber((block as Record<string, unknown>).height, Number.NaN))
    .filter((height) => Number.isSafeInteger(height) && height > 0)
    .slice(-ANSWER_FEED_BLOCKS);
  const details = await Promise.all(heights.map((height) => fetchJson(baseUrl, `/api/blocks/${height}`)));
  const rows: AnswerRow[] = [];
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const value = detail as Record<string, unknown>;
    const height = toNumber(value.height, 0);
    if (height < 1 || !Array.isArray(value.answers)) continue;
    // The node's per-block answers carry no height, so stamp it before parsing
    // (parseAnswers drops rows it cannot place in a block).
    const stamped = value.answers.map((answer) =>
      typeof answer === 'object' && answer !== null ? { ...answer, height } : answer,
    );
    for (const row of parseAnswers(stamped)) rows.push(row);
  }
  rows.sort((left, right) => right.answeredAt - left.answeredAt || right.height - left.height);
  return rows.slice(0, limit);
}

/**
 * Resolves a commitment hash typed into the search box to its block. Scans the
 * newest answers only (the node has no hash index), which is why the search
 * page reports the block of a recent answer rather than any historical one.
 */
export async function findAnswerByCommitment(hash: string): Promise<AnswerRow | undefined> {
  const needle = hash.toLowerCase();
  const rows = await recentAnswers(100);
  return rows.find((row) => row.commitmentHash.toLowerCase() === needle);
}

// NOTE: no `cache()` wrapper here — React 18.3 does not export `cache` (it is
// a React 19 API), and Next's `fetch` cache is already bypassed on purpose so
// chain data is never stale. The stat strip and a page therefore read the
// status twice per request; each read is a single fail-soft local fetch.
