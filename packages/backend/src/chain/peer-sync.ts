import { GENESIS_PARENT_HASH, blockHashMatches, isMilestoneHeight, meetsDifficulty, questionIntegrityErrorsForBlock, type QuestionIntegrityChecker } from './block.js';
import { difficultyBitsForHeight } from './quiz-chain.js';
import type { AdminAction, QuizBlock } from './types.js';

/**
 * O(n) validation of a foreign chain using exactly the verifyChain rules
 * (heights, parent links, self-hash, PoW per height, milestones) PLUS the
 * question-integrity rules: every block's published question content hash
 * and blind answer commitment must match the deterministic bank (recomputed
 * with the admin actions committed up to and including that block), so a
 * foreign chain cannot smuggle in questions with attacker-chosen answers.
 */
export function validateCandidateBlocks(
  blocks: readonly QuizBlock[],
  baseDifficultyBits: number,
  questionFactory?: QuestionIntegrityChecker,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let prevHash = GENESIS_PARENT_HASH;
  let expectedHeight = 1;
  const priorActions: AdminAction[] = [];
  for (const block of blocks) {
    if (block.height !== expectedHeight) errors.push(`HEIGHT_MISMATCH@${block.height}`);
    expectedHeight += 1;
    const expectedBits = difficultyBitsForHeight(block.height, baseDifficultyBits);
    if (block.parentHash !== prevHash) errors.push(`PARENT_HASH_MISMATCH@${block.height}`);
    if (!blockHashMatches(block) && !errors.includes(`BLOCK_HASH_MISMATCH@${block.height}`)) {
      errors.push(`BLOCK_HASH_MISMATCH@${block.height}`);
    }
    if (!meetsDifficulty(block.hash, expectedBits)) errors.push(`POW_INSUFFICIENT@${block.height}`);
    if (questionFactory !== undefined) {
      errors.push(...questionIntegrityErrorsForBlock(block, priorActions, questionFactory));
    }
    if (block.milestone && block.milestone.blockHeight !== block.height) errors.push(`MILESTONE_HEIGHT_MISMATCH@${block.height}`);
    if (isMilestoneHeight(block.height) && block.height !== 1 && !block.milestone) errors.push(`MILESTONE_MISSING@${block.height}`);
    priorActions.push(...block.adminActions);
    prevHash = block.hash;
  }
  return { valid: errors.length === 0, errors };
}

/** Vote weight = cumulative PoW attempts (sum of every block's attempts). */
export function totalWorkOf(blocks: readonly QuizBlock[]): bigint {
  let sum = 0n;
  for (const block of blocks) sum += BigInt(block.attempts);
  return sum;
}

export interface PeerSyncOptions {
  /** Base PoW bits — peer chains are judged with the SAME difficulty rules. */
  readonly baseDifficultyBits: number;
  /**
   * Question factory for question-integrity validation of foreign chains
   * (content hash + blind answer commitment recomputed from the bank).
   */
  readonly questionFactory?: QuestionIntegrityChecker;
  /** Absolute peer base URLs, e.g. `http://127.0.0.1:4101`. */
  readonly peerUrls: readonly string[];
  /** Injected fetch (tests); defaults to globalThis.fetch. */
  readonly fetchFn?: typeof fetch;
  /** ms to wait for each peer call (default 4,000). */
  readonly requestTimeoutMs?: number;
  /** Log sink. */
  readonly log?: (message: string) => void;
}

export interface PeerSyncDecision {
  readonly peer: string;
  readonly outcome: 'accepted' | 'rejected' | 'kept-own' | 'unreachable';
  /** Reason string for rejected/kept-own outcomes. */
  readonly reason?: string;
  readonly peerHeight?: number;
  readonly peerWork?: string;
  readonly ownHeight?: number;
  readonly ownWork?: string;
}

interface PeerStatus {
  readonly height?: number;
  readonly totalCumulativeWork?: string;
}

interface PeerBlocksResponse {
  readonly blocks?: readonly QuizBlock[];
  readonly total?: number;
}

/**
 * Polls peers, pulls their full sealed chains, judges them by the SAME
 * verifyChain rules and switches (reorg) only when a valid foreign chain has
 * MORE cumulative PoW work — the quiz-chain fork choice rule.
 *
 * Strict sequencing is preserved: while a foreign swap is being considered,
 * the local open block is cancelled and re-opened from the new tip, so the
 * node never extends a chain it does not follow.
 */
export class PeerSyncEngine {
  readonly #options: PeerSyncOptions;
  readonly #log: (message: string) => void;

  constructor(options: PeerSyncOptions) {
    this.#options = options;
    this.#log = options.log ?? ((message: string) => console.log(message));
  }

  get peerUrls(): readonly string[] {
    return this.#options.peerUrls;
  }

  /** Fetches JSON with a timeout; throws on non-2xx/network problems. */
  async #getJson<T>(peer: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.requestTimeoutMs ?? 4_000);
    try {
      const fetchFn = this.#options.fetchFn ?? fetch;
      const response = await fetchFn(`${peer}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads one peer's height + cumulative work; null when unreachable. */
  async fetchPeerStatus(peer: string): Promise<{ height: number; totalCumulativeWork: string } | null> {
    try {
      const status = await this.#getJson<PeerStatus>(peer, '/api/peer/status');
      const height = status.height;
      const work = status.totalCumulativeWork;
      if (typeof height !== 'number' || typeof work !== 'string') return null;
      return { height, totalCumulativeWork: work };
    } catch {
      return null;
    }
  }

  /** Pulls a peer's full sealed chain (bounded page loop). */
  async fetchPeerBlocks(peer: string): Promise<readonly QuizBlock[] | null> {
    const blocks: QuizBlock[] = [];
    const pageSize = 500;
    for (let offset = 0; offset < 100_000; offset += pageSize) {
      let page: PeerBlocksResponse;
      try {
        page = await this.#getJson<PeerBlocksResponse>(peer, `/api/peer/blocks?offset=${offset}&limit=${pageSize}`);
      } catch {
        return null;
      }
      const chunk = page.blocks ?? [];
      blocks.push(...chunk);
      if (chunk.length < pageSize) return blocks;
    }
    return blocks;
  }

  /**
   * Runs one sync round against every configured peer. Returns one decision
   * per peer (the engine reorgs at most once per round — the first valid,
   * heavier chain wins).
   */
  async syncRound(context: {
    ownHeight: number;
    ownWork: string;
    /** Swap the whole chain to the given blocks (validated already). */
    adopt: (blocks: readonly QuizBlock[]) => Promise<void> | void;
  }): Promise<PeerSyncDecision[]> {
    const decisions: PeerSyncDecision[] = [];
    for (const peer of this.#options.peerUrls) {
      const decision = await this.#syncPeer(peer, context);
      decisions.push(decision);
      if (decision.outcome === 'accepted') break; // reorg done this round
    }
    return decisions;
  }

  async #syncPeer(
    peer: string,
    context: { ownHeight: number; ownWork: string; adopt: (blocks: readonly QuizBlock[]) => Promise<void> | void },
  ): Promise<PeerSyncDecision> {
    const peerStatus = await this.fetchPeerStatus(peer);
    if (peerStatus === null) {
      return { peer, outcome: 'unreachable' };
    }
    if (peerStatus.height <= context.ownHeight) {
      return {
        peer,
        outcome: 'kept-own',
        reason: 'peer-not-ahead',
        peerHeight: peerStatus.height,
        peerWork: peerStatus.totalCumulativeWork,
        ownHeight: context.ownHeight,
        ownWork: context.ownWork,
      };
    }
    const blocks = await this.fetchPeerBlocks(peer);
    if (blocks === null || blocks.length === 0) {
      return { peer, outcome: 'unreachable', peerHeight: peerStatus.height };
    }
    const verdict = validateCandidateBlocks(blocks, this.#options.baseDifficultyBits, this.#options.questionFactory);
    if (!verdict.valid) {
      this.#log(`[peer-sync] rejected ${peer}: ${verdict.errors.slice(0, 5).join(', ')}`);
      return { peer, outcome: 'rejected', reason: verdict.errors.slice(0, 5).join(', '), peerHeight: peerStatus.height };
    }
    const peerWork = totalWorkOf(blocks);
    const ownWork = BigInt(context.ownWork);
    if (peerWork <= ownWork) {
      return {
        peer,
        outcome: 'kept-own',
        reason: 'less-work',
        peerHeight: peerStatus.height,
        peerWork: peerWork.toString(),
        ownHeight: context.ownHeight,
        ownWork: ownWork.toString(),
      };
    }
    await context.adopt(blocks);
    this.#log(`[peer-sync] adopted ${blocks.length} block(s) from ${peer} (work ${peerWork} > own ${ownWork})`);
    return {
      peer,
      outcome: 'accepted',
      peerHeight: peerStatus.height,
      peerWork: peerWork.toString(),
      ownHeight: context.ownHeight,
      ownWork: ownWork.toString(),
    };
  }
}
