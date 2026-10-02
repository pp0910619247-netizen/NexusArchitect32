import type { MilestoneHash } from './types.js';
import type { MilestoneAnchorClient, AnchorResult } from './anchor.js';

/**
 * Bridges quiz-chain milestones to the Amoy testnet without ever blocking
 * mining. Anchoring runs out-of-band: every sealed milestone block is
 * enqueued, a single background worker drains the queue with bounded
 * retries, and failures never stop the chain. Entries whose retries are
 * exhausted are deferred to the next drain (a new milestone or shutdown
 * triggers one), so delivery is at-least-once — the contract itself is
 * idempotent per height via `AlreadyAnchored`.
 */
export class MilestoneAnchorCoordinator {
  readonly #anchor: MilestoneAnchorClient | null;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #log: (message: string) => void;
  #queue: MilestoneHash[] = [];
  #running = false;
  #drainWait: Promise<void> | null = null;
  #results: AnchorResult[] = [];

  constructor(
    anchor: MilestoneAnchorClient | null,
    options: { maxAttempts?: number; retryDelayMs?: number; log?: (message: string) => void } = {},
  ) {
    this.#anchor = anchor;
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.#retryDelayMs = Math.max(0, options.retryDelayMs ?? 5_000);
    this.#log = options.log ?? ((message: string) => console.log(message));
  }

  /** True when anchoring is configured (env complete at node boot). */
  get enabled(): boolean {
    return this.#anchor !== null;
  }

  /** Milestone heights waiting to be anchored (oldest first). */
  get pendingHeights(): readonly number[] {
    return this.#queue.map((milestone) => milestone.blockHeight);
  }

  /** Recent successful anchor receipts (oldest first). */
  get results(): readonly AnchorResult[] {
    return [...this.#results];
  }

  /**
   * Enqueues a milestone for anchoring. Fire-and-forget: safe to call from
   * the mining path — it never throws and never awaits the network.
   */
  enqueue(milestone: MilestoneHash): void {
    if (!this.#anchor) return;
    if (this.#queue.some((item) => item.blockHeight === milestone.blockHeight)) return;
    this.#queue.push(milestone);
    this.#log(`[anchor] queued milestone #${milestone.blockHeight} — ${milestone.milestoneHash}`);
  }

  /**
   * Drains the queue to completion (started automatically after enqueue;
   * also awaited by node close so shutdown does not drop a pending tx).
   */
  drain(): Promise<void> {
    if (this.#drainWait !== null) return this.#drainWait;
    this.#drainWait = this.#drainLoop().finally(() => {
      this.#drainWait = null;
    });
    return this.#drainWait;
  }

  /** Waits until every queued milestone has been delivered or exhausted. */
  async close(): Promise<void> {
    await this.drain();
  }

  async #drainLoop(): Promise<void> {
    if (this.#running || !this.#anchor) return;
    this.#running = true;
    const deferred: MilestoneHash[] = [];
    try {
      while (this.#queue.length > 0) {
        const milestone = this.#queue.shift()!;
        try {
          const already = await this.#anchor.isAnchored(milestone.blockHeight);
          if (already) {
            this.#log(`[anchor] milestone #${milestone.blockHeight} already anchored on Amoy — skipping`);
            continue;
          }
        } catch (readError) {
          this.#log(`[anchor] isAnchored check failed (will try to send anyway): ${describe(readError)}`);
        }
        const outcome = await this.#sendWithRetry(milestone);
        if (outcome === null) deferred.push(milestone);
      }
    } finally {
      this.#running = false;
      if (deferred.length > 0) {
        // Fresh milestones go first; deferred ones retry on the NEXT drain
        // (a later enqueue or node close), never spinning inside this one.
        this.#queue = [...this.#queue, ...deferred];
        this.#log(`[anchor] deferred ${deferred.length} milestone(s) to the next drain: ${deferred.map((m) => '#' + m.blockHeight).join(', ')}`);
      }
    }
  }

  /** Returns the receipt on success, null when retries are exhausted. */
  async #sendWithRetry(milestone: MilestoneHash): Promise<AnchorResult | null> {
    if (!this.#anchor) return null;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        this.#log(`[anchor] anchoring milestone #${milestone.blockHeight} to Amoy (attempt ${attempt}/${this.#maxAttempts})…`);
        const result = await this.#anchor.anchorMilestone({
          blockHeight: milestone.blockHeight,
          milestoneHash: milestone.milestoneHash,
          spanFromBlockHash: milestone.spanFromBlockHash,
          spanToBlockHash: milestone.spanToBlockHash,
          spanBlocks: milestone.spanBlocks,
          totalCumulativeWork: milestone.totalCumulativeWork,
        });
        if (result.status === 'success') {
          this.#results.push(result);
          this.#log(`[anchor] ✅ milestone #${milestone.blockHeight} anchored — tx ${result.txHash}`);
          return result;
        }
        this.#log(`[anchor] tx reverted for milestone #${milestone.blockHeight}: ${result.txHash}`);
        return null; // a reverted record is a real failure — do not blind-retry
      } catch (error) {
        this.#log(`[anchor] attempt ${attempt} failed: ${describe(error)}`);
        if (attempt < this.#maxAttempts && this.#retryDelayMs > 0) {
          await sleep(this.#retryDelayMs);
        }
      }
    }
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
