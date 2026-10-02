import { describe, expect, it } from 'vitest';
import {
  GENESIS_ALLOCATION_WEI,
  GENESIS_END_BLOCK,
  HALVING_INTERVAL_BLOCKS,
  INITIAL_BLOCK_REWARD_WEI,
} from '../src/constants/tokenomics.js';
import {
  buildGenesisRewardSchedule,
  getBlockRewardWei,
  halveWithCarry,
  isWithinGenesisCap,
  sumGenesisRewardsWei,
} from '../src/rewards.js';

const NEX = 10n ** 18n;

describe('getBlockRewardWei — halving schedule', () => {
  it('pays the initial 1,051 NEX reward for every block of era 0', () => {
    expect(getBlockRewardWei(1)).toBe(1_051n * NEX);
    expect(getBlockRewardWei(1_000)).toBe(1_051n * NEX);
    expect(getBlockRewardWei(HALVING_INTERVAL_BLOCKS)).toBe(INITIAL_BLOCK_REWARD_WEI);
  });

  it('halves the reward at every 1,000-block boundary', () => {
    expect(getBlockRewardWei(1_001)).toBe(525_500_000_000_000_000_000n); // 525.5 NEX
    expect(getBlockRewardWei(2_001)).toBe(262_750_000_000_000_000_000n); // 262.75 NEX
    expect(getBlockRewardWei(3_001)).toBe(131_375_000_000_000_000_000n); // 131.375 NEX
  });

  it('keeps halving down to the final era of the Genesis window', () => {
    // Era 9 = the 9th halving: 1,051 / 2⁹ = 2.052734375 NEX
    expect(getBlockRewardWei(9_001)).toBe(2_052_734_375_000_000_000n);
    expect(getBlockRewardWei(GENESIS_END_BLOCK)).toBe(2_052_734_375_000_000_000n);
    expect(getBlockRewardWei(9_000)).toBe(4_105_468_750_000_000_000n); // era 8
  });

  it('throws for heights outside the Genesis Era (edge)', () => {
    expect(() => getBlockRewardWei(0)).toThrow(RangeError);
    expect(() => getBlockRewardWei(-5)).toThrow(RangeError);
    expect(() => getBlockRewardWei(10_001)).toThrow(RangeError);
  });

  it('accepts bigint heights interchangeably', () => {
    expect(getBlockRewardWei(1_001n)).toBe(getBlockRewardWei(1_001));
  });
});

describe('Genesis Era cap — sum of blocks 1–10,000', () => {
  it('builds exactly 10,000 entries', () => {
    const schedule = buildGenesisRewardSchedule();
    expect(schedule).toHaveLength(10_000);
    expect(schedule[0]).toBe(1_051n * NEX);
    expect(schedule[9_999]).toBe(2_052_734_375_000_000_000n);
  });

  it('never exceeds the 2,100,000 NEX Genesis allocation', () => {
    const total = sumGenesisRewardsWei();
    // 1,000 × 1,051 × (2 − 2⁻⁹) = 2,099,947.265625 NEX
    expect(total).toBe(2_099_947_265_625_000_000_000_000n);
    expect(total <= GENESIS_ALLOCATION_WEI).toBe(true);
    expect(isWithinGenesisCap()).toBe(true);
  });

  it('pays a constant reward within each era and halves across eras', () => {
    const schedule = buildGenesisRewardSchedule();
    const era = (height: number): number => Math.floor((height - 1) / 1_000);
    for (const height of [5, 500, 999, 1_500, 9_500]) {
      const index = height - 1;
      expect(schedule[index]).toBe(schedule[index + 1]);
      expect(era(height)).toBe(era(height + 1));
    }
    // Boundary: block 1,000 (era 0) pays double block 1,001 (era 1).
    expect(schedule[999]).toBe(schedule[1_000]! * 2n);
  });
});

describe('halveWithCarry (edge)', () => {
  it('halves even amounts with no remainder', () => {
    expect(halveWithCarry(1_000n)).toEqual({ halved: 500n, remainder: 0n });
    expect(halveWithCarry(0n)).toEqual({ halved: 0n, remainder: 0n });
  });

  it('captures the wei dropped by floor division so it can be carried forward', () => {
    const result = halveWithCarry(1_051n);
    expect(result).toEqual({ halved: 525n, remainder: 1n });
    // Re-composition: halved × 2 + remainder === original value for odd inputs.
    expect(result.halved * 2n + result.remainder).toBe(1_051n);
  });

  it('rejects negative values (edge)', () => {
    expect(() => halveWithCarry(-1n)).toThrow(RangeError);
  });
});
