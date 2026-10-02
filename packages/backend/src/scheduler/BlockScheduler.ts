/**
 * Random Hourly Block Scheduler.
 *
 * Cadence rules (AGENTS.md):
 * - Every 60-minute window contains exactly ONE closed block.
 * - The close time inside each window is a fresh random offset of
 *   0–3,599 seconds, re-rolled after every close so block times are
 *   unpredictable (anti-bot / anti-timing-guessing).
 * - Right after a block closes successfully, the next window's random
 *   close time is computed and armed immediately.
 * - At the scheduled time the scheduler runs problem preparation
 *   ({@link BlockSchedulerHooks.prepareProblems}) and then triggers the
 *   on-chain close ({@link BlockSchedulerHooks.closeBlock}).
 *
 * Side effects are injected via hooks so the service stays stateless and
 * fully testable with mocked timers.
 */
import type { Problem } from '@nexus/shared';

/** Length of one block window: 60 minutes. */
export const BLOCK_WINDOW_MS = 60 * 60 * 1000;

/** Inclusive upper bound of the random offset inside a window (seconds). */
export const MAX_RANDOM_OFFSET_SECONDS = 3_599;

/** Phase identifier reported through {@link BlockSchedulerOptions.onError}. */
export type BlockSchedulerErrorPhase = 'prepare' | 'close';

/** Injected side effects invoked by the scheduler. */
export interface BlockSchedulerHooks {
  /**
   * Runs problem generation for the block that is about to close.
   * May return the prepared problems (used by callers/tests) or nothing.
   */
  prepareProblems: (
    blockHeight: number,
  ) => void | readonly Problem[] | Promise<void | readonly Problem[]>;
  /**
   * Triggers the smart contract to close (submit) the block.
   *
   * @param blockHeight - Height of the block being closed.
   * @param scheduledAtMs - The randomly scheduled close time (epoch ms).
   */
  closeBlock: (blockHeight: number, scheduledAtMs: number) => void | Promise<void>;
}

/** Configuration for {@link BlockScheduler}. */
export interface BlockSchedulerOptions {
  /** Side-effect hooks (problem generation + on-chain close trigger). */
  hooks: BlockSchedulerHooks;
  /** Injectable clock returning epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable RNG returning `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
  /** Window length in milliseconds. Defaults to {@link BLOCK_WINDOW_MS} (1 hour). */
  windowMs?: number;
  /** Height of the first block this scheduler will close. Defaults to `1`. */
  initialBlockHeight?: number;
  /**
   * Called when a hook throws. The scheduler keeps its cadence regardless
   * (a stuck scheduler would lose blocks), so failures must be observed here.
   */
  onError?: (
    error: unknown,
    context: { blockHeight: number; phase: BlockSchedulerErrorPhase },
  ) => void;
}

export class BlockScheduler {
  private readonly hooks: BlockSchedulerHooks;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly windowMs: number;
  private readonly onError: BlockSchedulerOptions['onError'];

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Bumped on stop() so an in-flight fire can never double-schedule. */
  private generation = 0;
  private blockHeight: number;
  private nextFireAtMs: number | null = null;
  /** Window anchor: actual time the most recent block close started. */
  private windowAnchorMs: number | null = null;

  public constructor(options: BlockSchedulerOptions) {
    this.hooks = options.hooks;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.windowMs = options.windowMs ?? BLOCK_WINDOW_MS;
    this.onError = options.onError;
    this.blockHeight = options.initialBlockHeight ?? 1;
  }

  /** Whether the scheduler is currently armed. */
  public get isRunning(): boolean {
    return this.running;
  }

  /** Height of the next block that will be closed. */
  public get currentBlockHeight(): number {
    return this.blockHeight;
  }

  /** Epoch ms of the next scheduled close, or `null` when not armed. */
  public get scheduledFireAtMs(): number | null {
    return this.nextFireAtMs;
  }

  /** Arms the first block. No-op when already running (idempotent). */
  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNext();
  }

  /** Disarms the scheduler. Safe to call at any time (idempotent). */
  public stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextFireAtMs = null;
    this.windowAnchorMs = null;
  }

  /**
   * Rolls the random offset for a window: an integer number of seconds in
   * `[0, MAX_RANDOM_OFFSET_SECONDS]` (clamped defensively for RNGs that
   * return values at or above the exclusive upper bound).
   */
  private randomOffsetSeconds(): number {
    const secondsPerWindow = Math.floor(this.windowMs / 1000);
    const maxOffset = Math.max(0, secondsPerWindow - 1);
    const raw = Math.floor(this.random() * (maxOffset + 1));
    return Math.min(Math.max(raw, 0), maxOffset);
  }

  /**
   * Computes the next close time.
   *
   * - First schedule (no block closed yet): fire later in the current
   *   wall-clock window when the rolled offset is still ahead, otherwise
   *   roll into the next window.
   * - After a close: always anchor to the window AFTER the one the close
   *   happened in — this guarantees exactly one block per window by
   *   construction (no duplicates, no skipped windows).
   */
  private computeNextFireAtMs(): number {
    const offsetMs = this.randomOffsetSeconds() * 1000;

    if (this.windowAnchorMs === null) {
      const now = this.now();
      const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
      const candidate = windowStart + offsetMs;
      return candidate > now ? candidate : candidate + this.windowMs;
    }

    const anchorWindowStart = Math.floor(this.windowAnchorMs / this.windowMs) * this.windowMs;
    return anchorWindowStart + this.windowMs + offsetMs;
  }

  private scheduleNext(): void {
    const fireAt = this.computeNextFireAtMs();
    this.nextFireAtMs = fireAt;
    const delay = Math.max(0, fireAt - this.now());
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.handleFire(fireAt, generation);
    }, delay);
  }

  private async handleFire(scheduledAtMs: number, generation: number): Promise<void> {
    // Anchor on the actual fire moment so slow hooks can never shift later
    // blocks into a neighboring window.
    const fireStartedAtMs = this.now();
    const blockHeight = this.blockHeight;
    this.nextFireAtMs = null;

    try {
      await this.hooks.prepareProblems(blockHeight);
    } catch (error) {
      this.reportError(error, 'prepare', blockHeight);
    }

    try {
      await this.hooks.closeBlock(blockHeight, scheduledAtMs);
    } catch (error) {
      this.reportError(error, 'close', blockHeight);
    }

    this.blockHeight += 1;
    this.windowAnchorMs = fireStartedAtMs;

    if (this.running && generation === this.generation) {
      this.scheduleNext();
    }
  }

  private reportError(
    error: unknown,
    phase: BlockSchedulerErrorPhase,
    blockHeight: number,
  ): void {
    this.onError?.(error, { blockHeight, phase });
  }
}
