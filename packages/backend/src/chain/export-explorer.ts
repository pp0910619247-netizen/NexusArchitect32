/**
 * Quiz-chain → explorer bridge.
 *
 * Reads the node's durable chain (CHAIN_DATA_DIR/blocks.jsonl), maps every
 * sealed block to the indexer's QuizExplorerBlock shape and writes a JSON
 * snapshot that nex32scan (and any other viewer) reads server-side.
 *
 * The snapshot carries three public views, so an explorer that cannot reach the
 * live node still looks like an explorer rather than an empty page:
 *   - `quizBlocks`    latest 100 sealed blocks (per-block detail)
 *   - `status`        chain-wide aggregates (blocks, attempts, answers, …)
 *   - `recentAnswers` the newest answers across the chain, newest first
 *
 * SECURITY: the snapshot contains only PUBLIC data — sealed blocks publish
 * `revealedAnswerIndex` (commit-reveal) plus the blind `answerCommitment`
 * anyone can verify it against. The open block's key never appears anywhere.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDiscipline } from './disciplines.js';
import type { QuizBlock } from './types.js';
import { pickWinner } from './winner.js';
import type { QuizExplorerBlock } from '@nexus/indexer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHAIN_DIR = path.resolve(HERE, '../../../../.chain-data');

interface Disciplines {
  th: string;
  en: string;
}

function safeDiscipline(id: string): Disciplines {
  try {
    return getDiscipline(id);
  } catch {
    return { th: id, en: id };
  }
}

function toQuizExplorerBlock(block: QuizBlock): QuizExplorerBlock {
  const discipline = safeDiscipline(block.question.discipline);
  const winner = pickWinner(block.answers);
  return {
    height: block.height,
    blockHash: block.hash as `0x${string}`,
    parentHash: block.parentHash as `0x${string}`,
    timestamp: block.timestamp,
    difficultyBits: block.difficultyBits,
    isHard: block.isHard,
    isMilestone: block.isMilestone,
    attempts: block.attempts,
    miner: block.miner,
    questionId: block.question.id,
    disciplineId: block.question.discipline,
    disciplineTh: discipline.th,
    disciplineEn: discipline.en,
    promptTh: block.question.prompt.th,
    promptEn: block.question.prompt.en,
    options: [...block.question.options],
    contentHash: block.question.contentHash as `0x${string}`,
    revealedAnswerIndex: block.revealedAnswerIndex,
    revealedAnswerText:
      block.revealedAnswerIndex === null ? null : (block.question.options[block.revealedAnswerIndex] ?? null),
    answerCommitment: (block.answerCommitment ?? null) as `0x${string}` | null,
    totalAnswers: block.answers.length,
    correctAnswers: block.answers.filter((answer) => answer.correct).length,
    winnerMiner: winner?.miner ?? null,
    winnerAnsweredAt: winner?.answeredAt ?? null,
    answers: block.answers.map((answer) => ({
      miner: answer.miner,
      choice: answer.choice,
      correct: answer.correct,
      answeredAt: answer.answeredAt,
      commitmentHash: answer.commitmentHash as `0x${string}`,
    })),
  };
}

/** How many newest answers the snapshot carries (the explorer's tx feed). */
export const RECENT_ANSWER_LIMIT = 50;

/** Chain-wide aggregates for the explorer's stat bar. */
export interface ExportedChainStatus {
  /** Highest sealed block height, or 0 for an empty chain. */
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

/** One answer (the quiz chain's "transaction") flattened for listing. */
export interface ExportedAnswer {
  readonly height: number;
  readonly miner: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly answeredAt: number;
  readonly commitmentHash: string;
}

/**
 * Computes the public aggregates from the stored chain, so a snapshot baked
 * offline reports the same numbers as the live node's `/api/status`.
 *
 * @param blocks - Sealed blocks in ascending height order.
 * @returns Aggregates with `height: 0` and null timings for an empty chain.
 */
export function summarizeChain(blocks: readonly QuizBlock[]): ExportedChainStatus {
  const last = blocks[blocks.length - 1] ?? null;
  let totalAttempts = 0;
  let totalAnswers = 0;
  let correctAnswers = 0;
  let lastMilestoneHeight: number | null = null;
  for (const block of blocks) {
    totalAttempts += block.attempts;
    totalAnswers += block.answers.length;
    correctAnswers += block.answers.filter((answer) => answer.correct).length;
    if (block.milestone) lastMilestoneHeight = block.height;
  }
  const first = blocks[0];
  const interval =
    blocks.length > 1 && first && last ? (last.timestamp - first.timestamp) / (blocks.length - 1) : null;
  return {
    height: last?.height ?? 0,
    totalBlocks: blocks.length,
    totalAttempts,
    totalAnswers,
    correctAnswers,
    avgAttemptsPerBlock: blocks.length === 0 ? 0 : Math.round((totalAttempts / blocks.length) * 100) / 100,
    avgBlockIntervalMs: interval === null ? null : Math.round(interval),
    difficultyBits: last?.difficultyBits ?? 0,
    lastMilestoneHeight,
    lastBlockAt: last?.timestamp ?? null,
  };
}

/**
 * Newest answers across the whole chain, newest block first (the explorer's
 * "latest transactions" feed).
 *
 * @param blocks - Sealed blocks in ascending height order.
 * @param limit  - Maximum rows returned; stops scanning once it is reached.
 */
export function latestAnswers(blocks: readonly QuizBlock[], limit: number = RECENT_ANSWER_LIMIT): ExportedAnswer[] {
  const rows: ExportedAnswer[] = [];
  for (let index = blocks.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
    for (let answerIndex = block.answers.length - 1; answerIndex >= 0 && rows.length < limit; answerIndex -= 1) {
      const answer = block.answers[answerIndex];
      if (!answer) continue;
      rows.push({
        height: block.height,
        miner: answer.miner,
        choice: answer.choice,
        correct: answer.correct,
        answeredAt: answer.answeredAt,
        commitmentHash: answer.commitmentHash,
      });
    }
  }
  return rows;
}

export interface ExportOptions {
  readonly chainDataDir?: string;
  readonly outFile?: string;
}

/** Reads blocks.jsonl and writes the explorer snapshot JSON. */
export async function exportExplorerSnapshot(options: ExportOptions = {}): Promise<{ blocks: number; outFile: string }> {
  const chainDataDir = options.chainDataDir ?? (process.env.CHAIN_DATA_DIR?.trim() || DEFAULT_CHAIN_DIR);
  const outFile = options.outFile ?? path.join(chainDataDir, 'explorer-snapshot.json');
  const raw = await readFile(path.join(chainDataDir, 'blocks.jsonl'), 'utf8');
  const parsedBlocks = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as QuizBlock);
  const blocks = parsedBlocks.map(toQuizExplorerBlock);
  await mkdir(path.dirname(outFile), { recursive: true });
  // One file doubles as BOTH the legacy FileEventSnapshot (empty event data —
  // those pages keep rendering safely) and the quiz-chain bridge snapshot.
  const lastHeight = blocks.length > 0 ? (blocks[blocks.length - 1]?.height ?? 0) : 0;
  const snapshot = {
    exportedAt: new Date().toISOString(),
    latestBlockHeight: lastHeight,
    impactTreasuryWei: '0',
    blocks: {},
    proposals: [],
    quizBlocks: blocks,
    status: summarizeChain(parsedBlocks),
    recentAnswers: latestAnswers(parsedBlocks, RECENT_ANSWER_LIMIT),
  };
  await writeFile(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { blocks: blocks.length, outFile };
}

// Allow `node dist/chain/export-explorer.js` direct execution.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  exportExplorerSnapshot()
    .then((result) => {
      console.log(`[chain:export] wrote ${result.blocks} quiz block(s) → ${result.outFile}`);
    })
    .catch((error: unknown) => {
      console.error('[chain:export] failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
