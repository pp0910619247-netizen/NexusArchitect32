import { BLOCK_INTERVAL_MS_DEFAULT, BLOCK_JITTER_MS_DEFAULT } from './constants.js';

export interface QuizSchedulerOptions {
  /** Base interval between block closes (default 60 min). */
  intervalMs?: number;
  /** Random jitter added on top (default ±10 s). */
  jitterMs?: number;
  /** Injectable clock + timer fns for tests. */
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface QuizSchedulerHooks {
  /** Opens + seals one block (mining happens inside). */
  mineBlock: () => unknown | Promise<unknown>;
  /** Called on hook errors; the schedule re-arms. */
  onError?: (error: unknown) => void;
}

/**
 * Mines blocks on a randomized ~60 min cadence with strict sequencing:
 * the timer only fires when no block is open. If a mine is still running
 * when the next tick would fire, the tick is skipped and rescheduled —
 * the next block simply cannot begin until the previous one is sealed.
 */
export class QuizScheduler {
  readonly #intervalMs: number;
  readonly #jitterMs: number;
  readonly #hooks: QuizSchedulerHooks;
  readonly #setTimeoutFn: typeof setTimeout;
  readonly #clearTimeoutFn: typeof clearTimeout;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #busy = false;

  constructor(options: QuizSchedulerOptions, hooks: QuizSchedulerHooks) {
    this.#intervalMs = Math.max(1, options.intervalMs ?? BLOCK_INTERVAL_MS_DEFAULT);
    this.#jitterMs = Math.max(0, options.jitterMs ?? BLOCK_JITTER_MS_DEFAULT);
    this.#hooks = hooks;
    this.#setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.#clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** Arms the schedule. Idempotent. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#arm();
  }

  /** Disarms the schedule. Safe to call at any time. */
  stop(): void {
    this.#running = false;
    if (this.#timer !== null) {
      this.#clearTimeoutFn(this.#timer);
      this.#timer = null;
    }
  }

  /** Schedules the next tick with a random jitter. */
  #arm(): void {
    if (!this.#running) return;
    const jitter = this.#jitterMs > 0 ? (Math.random() * 2 - 1) * this.#jitterMs : 0;
    const delay = Math.max(1, this.#intervalMs + jitter);
    this.#timer = this.#setTimeoutFn(() => {
      this.#timer = null;
      void this.#tick();
    }, delay);
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    if (this.#busy) {
      // Strict sequencing: previous block not sealed yet → skip this tick.
      this.#arm();
      return;
    }
    this.#busy = true;
    try {
      await this.#hooks.mineBlock();
    } catch (error) {
      this.#hooks.onError?.(error);
    } finally {
      this.#busy = false;
      this.#arm();
    }
  }
}
