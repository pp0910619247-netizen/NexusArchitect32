import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Problem } from '@nexus/shared';
import { BlockScheduler } from '../src/scheduler/BlockScheduler.js';
import type { BlockSchedulerErrorPhase } from '../src/scheduler/BlockScheduler.js';

const HOUR_MS = 60 * 60 * 1000;

interface CloseEvent {
  height: number;
  at: number;
}

function makeProblem(height: number): Problem {
  return {
    id: `problem-${height}`,
    blockHeight: height,
    type: 'DETERMINISTIC',
    disciplines: ['mathematics', 'physics'],
    difficulty: 5,
    statement: { en: 'Solve for x.', th: 'หาค่า x' },
    answerCommitHash: `0x${'ab'.repeat(32)}`,
    revealedAt: 0,
  };
}

/** Deterministic RNG backed by a fixed sequence (falls back to 0.5). */
function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0.5;
    index += 1;
    return value;
  };
}

/** Random offset (seconds) of a timestamp inside its hourly window. */
function offsetSeconds(at: number): number {
  return Math.floor((at % HOUR_MS) / 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BlockScheduler — one block per hour', () => {
  it('closes exactly one block per hourly window at the rolled random time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 5, 10, 30, 0));

    const closes: CloseEvent[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: (height) => [makeProblem(height)],
        closeBlock: (height, at) => {
          closes.push({ height, at });
        },
      },
      // Rolled offsets: 900s, 1800s, 2700s, 360s, 3240s, 1800s.
      random: sequenceRandom([0.25, 0.5, 0.75, 0.1, 0.9, 0.5]),
    });

    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    // 10:15 was already in the past at 10:30 → first block rolls to 11:15.
    expect(scheduler.scheduledFireAtMs).toBe(Date.UTC(2026, 0, 5, 11, 15));

    await vi.advanceTimersByTimeAsync(6 * HOUR_MS);

    expect(closes.map((c) => c.height)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(closes.map((c) => c.at)).toEqual([
      Date.UTC(2026, 0, 5, 11, 15), // window 11:00 + 15 min
      Date.UTC(2026, 0, 5, 12, 30), // window 12:00 + 30 min
      Date.UTC(2026, 0, 5, 13, 45), // window 13:00 + 45 min
      Date.UTC(2026, 0, 5, 14, 6), // window 14:00 + 6 min
      Date.UTC(2026, 0, 5, 15, 54), // window 15:00 + 54 min
      Date.UTC(2026, 0, 5, 16, 30), // window 16:00 + 30 min (fires exactly at the boundary)
    ]);

    // Exactly one block per wall-clock hour — none duplicated, none missing.
    const windows = closes.map((c) => Math.floor(c.at / HOUR_MS));
    expect(new Set(windows).size).toBe(closes.length);

    scheduler.stop();
  });

  it('re-rolls a different random offset for every hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 6, 9, 5, 0));

    const closes: CloseEvent[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: () => undefined,
        closeBlock: (height, at) => {
          closes.push({ height, at });
        },
      },
      random: sequenceRandom([0.5, 0.25, 0.75, 0.125, 0.6]),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5 * HOUR_MS);

    expect(closes.map((c) => c.height)).toEqual([1, 2, 3, 4, 5]);
    const offsets = closes.map((c) => offsetSeconds(c.at));
    // Offsets match the fresh RNG rolls: 1800, 900, 2700, 450, 2160 seconds.
    expect(offsets).toEqual([1800, 900, 2700, 450, 2160]);
    // Every hour used a DIFFERENT time of day (not a fixed schedule).
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(3599);
    }

    scheduler.stop();
  });

  it('never loses or duplicates blocks across 24 hours (edge)', async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 7, 9, 5, 0);
    vi.setSystemTime(start);

    const closes: CloseEvent[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: (height) => [makeProblem(height)],
        closeBlock: (height, at) => {
          closes.push({ height, at });
        },
      },
      random: sequenceRandom([0.1, 0.62, 0.33, 0.87, 0.05, 0.44, 0.71, 0.29]),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(24 * HOUR_MS);

    // Heights are strictly consecutive — no lost or duplicated blocks.
    expect(closes).toHaveLength(24);
    closes.forEach((close, index) => {
      expect(close.height).toBe(index + 1);
    });

    // Close times strictly increase.
    for (let i = 1; i < closes.length; i += 1) {
      expect(closes[i]!.at).toBeGreaterThan(closes[i - 1]!.at);
    }

    // Every full hourly window in the range holds exactly one block.
    const firstWindow = Math.floor(start / HOUR_MS);
    const windows = closes.map((c) => Math.floor(c.at / HOUR_MS));
    const windowSet = new Set(windows);
    expect(windowSet.size).toBe(windows.length);
    for (let w = firstWindow; w <= firstWindow + 23; w += 1) {
      expect(windowSet.has(w)).toBe(true);
    }
    for (const close of closes) {
      expect(offsetSeconds(close.at)).toBeLessThanOrEqual(3599);
    }

    scheduler.stop();
  });
});

describe('BlockScheduler — lifecycle & edge cases', () => {
  it('runs problem preparation before triggering the on-chain close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 8, 10, 0, 0));

    const order: string[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: (height) => {
          order.push(`prepare:${height}`);
          return [makeProblem(height)];
        },
        closeBlock: (height) => {
          order.push(`close:${height}`);
        },
      },
      random: () => 0.5,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);

    expect(order).toEqual(['prepare:1', 'close:1', 'prepare:2', 'close:2']);
    scheduler.stop();
  });

  it('stop() cancels the pending block so nothing fires afterwards (edge)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 9, 10, 0, 0));

    const closes: CloseEvent[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: () => undefined,
        closeBlock: (height, at) => {
          closes.push({ height, at });
        },
      },
      random: () => 0.9, // offset 3240s = 54 min → scheduled 10:54
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); // now 10:10 — before 10:54
    expect(closes).toHaveLength(0);
    expect(scheduler.scheduledFireAtMs).toBe(Date.UTC(2026, 0, 9, 10, 54));

    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.scheduledFireAtMs).toBeNull();

    await vi.advanceTimersByTimeAsync(10 * HOUR_MS);
    expect(closes).toHaveLength(0);
  });

  it('reports hook failures via onError and keeps the hourly cadence (edge)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 10, 10, 0, 0));

    const failures: Array<{ blockHeight: number; phase: BlockSchedulerErrorPhase }> = [];
    let prepareAttempts = 0;
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: () => {
          prepareAttempts += 1;
          if (prepareAttempts === 1) {
            throw new Error('problem bank unavailable');
          }
        },
        closeBlock: () => {
          throw new Error('contract reverted');
        },
      },
      random: () => 0.5,
      onError: (error, context) => {
        expect(error).toBeInstanceOf(Error);
        failures.push(context);
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);

    // Height 1: prepare AND close failed; height 2: close failed.
    expect(failures).toEqual([
      { blockHeight: 1, phase: 'prepare' },
      { blockHeight: 1, phase: 'close' },
      { blockHeight: 2, phase: 'close' },
    ]);
    // Heights still advanced on schedule — the scheduler never gets stuck.
    expect(scheduler.currentBlockHeight).toBe(3);
    scheduler.stop();
  });

  it('clamps the rolled offset to at most 3,599 seconds (edge)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 11, 10, 0, 0));

    const closes: CloseEvent[] = [];
    const scheduler = new BlockScheduler({
      hooks: {
        prepareProblems: () => undefined,
        closeBlock: (height, at) => {
          closes.push({ height, at });
        },
      },
      random: () => 1, // out-of-contract RNG value — must be clamped to 3599s
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(HOUR_MS);

    expect(closes).toHaveLength(1);
    expect(closes[0]!.at).toBe(Date.UTC(2026, 0, 11, 10, 59, 59));
    expect(offsetSeconds(closes[0]!.at)).toBe(3599);
    scheduler.stop();
  });
});

