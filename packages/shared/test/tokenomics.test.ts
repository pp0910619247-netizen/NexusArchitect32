import { describe, expect, it } from 'vitest';
import {
  ALLOCATION_MINING_BPS,
  ALLOCATION_PUBLIC_SALE_BPS,
  ALLOCATION_TEAM_BPS,
  BPS_DENOMINATOR,
  CO_MINERS_BPS_OF_REMAINING,
  GENESIS_ALLOCATION_BPS,
  GENESIS_ALLOCATION_WEI,
  GENESIS_BLOCK_COUNT,
  GENESIS_END_BLOCK,
  GENESIS_START_BLOCK,
  HALVING_INTERVAL_BLOCKS,
  IMPACT_TREASURY_BPS,
  INITIAL_BLOCK_REWARD_NEX,
  INITIAL_BLOCK_REWARD_WEI,
  NEX_DECIMALS,
  PUBLIC_SALE_DEV_TREASURY_BPS,
  PUBLIC_SALE_LP_LOCK_BPS,
  TEAM_VESTING_CLIFF_MONTHS,
  TEAM_VESTING_INTERVAL_MONTHS,
  TOTAL_SUPPLY_NEX,
  TOTAL_SUPPLY_WEI,
  WINNER_BPS_OF_REMAINING,
} from '../src/constants/tokenomics.js';
import { splitBlockReward } from '../src/rewards.js';

const ALL_CONSTANTS: readonly bigint[] = [
  NEX_DECIMALS,
  TOTAL_SUPPLY_WEI,
  TOTAL_SUPPLY_NEX,
  BPS_DENOMINATOR,
  ALLOCATION_MINING_BPS,
  ALLOCATION_PUBLIC_SALE_BPS,
  ALLOCATION_TEAM_BPS,
  TEAM_VESTING_CLIFF_MONTHS,
  TEAM_VESTING_INTERVAL_MONTHS,
  PUBLIC_SALE_LP_LOCK_BPS,
  PUBLIC_SALE_DEV_TREASURY_BPS,
  GENESIS_START_BLOCK,
  GENESIS_END_BLOCK,
  GENESIS_BLOCK_COUNT,
  GENESIS_ALLOCATION_WEI,
  GENESIS_ALLOCATION_BPS,
  HALVING_INTERVAL_BLOCKS,
  INITIAL_BLOCK_REWARD_NEX,
  INITIAL_BLOCK_REWARD_WEI,
  IMPACT_TREASURY_BPS,
  WINNER_BPS_OF_REMAINING,
  CO_MINERS_BPS_OF_REMAINING,
];

describe('tokenomics constants (AGENTS.md §4)', () => {
  it('exports every numeric constant as bigint (never number)', () => {
    for (const value of ALL_CONSTANTS) {
      expect(typeof value).toBe('bigint');
    }
  });

  it('matches the locked supply, genesis, and reward figures', () => {
    expect(TOTAL_SUPPLY_WEI).toBe(21_000_000n * 10n ** 18n);
    expect(TOTAL_SUPPLY_NEX).toBe(21_000_000n);
    expect(NEX_DECIMALS).toBe(18n);
    expect(GENESIS_BLOCK_COUNT).toBe(10_000n);
    expect(GENESIS_START_BLOCK).toBe(1n);
    expect(GENESIS_END_BLOCK).toBe(10_000n);
    expect(GENESIS_ALLOCATION_WEI).toBe(2_100_000n * 10n ** 18n);
    expect(HALVING_INTERVAL_BLOCKS).toBe(1_000n);
    expect(INITIAL_BLOCK_REWARD_NEX).toBe(1_051n);
    expect(INITIAL_BLOCK_REWARD_WEI).toBe(1_051n * 10n ** 18n);
  });

  it('keeps allocations summing to exactly 100%', () => {
    expect(ALLOCATION_MINING_BPS + ALLOCATION_PUBLIC_SALE_BPS + ALLOCATION_TEAM_BPS).toBe(
      BPS_DENOMINATOR,
    );
    expect(PUBLIC_SALE_LP_LOCK_BPS + PUBLIC_SALE_DEV_TREASURY_BPS).toBe(BPS_DENOMINATOR);
    expect(IMPACT_TREASURY_BPS).toBe(1_000n);
    expect(WINNER_BPS_OF_REMAINING + CO_MINERS_BPS_OF_REMAINING).toBe(6_000n + 4_000n);
  });

  it('allocates exactly 10% of total supply to the Genesis Era', () => {
    expect(GENESIS_ALLOCATION_BPS).toBe(1_000n);
    expect(GENESIS_ALLOCATION_WEI).toBe((TOTAL_SUPPLY_WEI * GENESIS_ALLOCATION_BPS) / BPS_DENOMINATOR);
  });
});

describe('splitBlockReward (order: 10% treasury → 40/60 of remaining)', () => {
  it('splits the initial 1,051 NEX reward with zero dust', () => {
    const rewardWei = 1_051n * 10n ** 18n;
    const split = splitBlockReward(rewardWei);
    expect(split.impactTreasuryWei).toBe(105_100_000_000_000_000_000n); // 10%
    expect(split.winnerWei).toBe(378_360_000_000_000_000_000n); // 40% of 90%
    expect(split.coMinersWei).toBe(567_540_000_000_000_000_000n); // 60% of 90%
    expect(
      split.impactTreasuryWei + split.winnerWei + split.coMinersWei,
    ).toBe(rewardWei);
  });

  it('routes integer-division dust to the ImpactTreasury (edge)', () => {
    // floor(1003 × 10%) = 100 → remaining 903 → floor(361.2) + floor(541.8) → dust 1 wei
    const split = splitBlockReward(1_003n);
    expect(split.impactTreasuryWei).toBe(101n);
    expect(split.winnerWei).toBe(361n);
    expect(split.coMinersWei).toBe(541n);
    expect(split.impactTreasuryWei + split.winnerWei + split.coMinersWei).toBe(1_003n);
  });

  it('handles a zero reward and rejects negative rewards (edge)', () => {
    expect(splitBlockReward(0n)).toEqual({
      impactTreasuryWei: 0n,
      winnerWei: 0n,
      coMinersWei: 0n,
    });
    expect(() => splitBlockReward(-1n)).toThrow(RangeError);
  });
});
