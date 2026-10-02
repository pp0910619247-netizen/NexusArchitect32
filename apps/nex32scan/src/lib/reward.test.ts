import { describe, expect, it } from 'vitest';
import { GENESIS_ALLOCATION_WEI } from '@nexus/shared';
import { GENESIS_FACTS, genesisEraRows, scheduledBlockReward } from './reward';
import { formatNex } from './format';

const NEX = 10n ** 18n;

describe('Genesis reward view model', () => {
  it('shows the locked opening reward of 1,051 NEX at block 1', () => {
    const reward = scheduledBlockReward(GENESIS_FACTS.startBlock);
    expect(reward?.era).toBe(0);
    expect(reward?.rewardWei).toBe(1_051n * NEX);
    expect(formatNex(reward!.rewardWei)).toBe('1,051');
  });

  it('halves every 1,000 blocks and still sums back to the block reward', () => {
    const eraZero = scheduledBlockReward(1_000);
    const eraOne = scheduledBlockReward(1_001);
    const eraTwo = scheduledBlockReward(2_001);
    expect(eraZero?.era).toBe(0);
    expect(eraZero?.rewardWei).toBe(1_051n * NEX);
    expect(eraOne?.era).toBe(1);
    expect(formatNex(eraOne!.rewardWei)).toBe('525.5');
    expect(formatNex(eraTwo!.rewardWei)).toBe('262.75');

    const reward = eraZero!;
    expect(reward.impactTreasuryWei + reward.winnerWei + reward.coMinersWei).toBe(reward.rewardWei);
    expect(formatNex(reward.impactTreasuryWei)).toBe('105.1');
    expect(formatNex(reward.winnerWei)).toBe('378.36');
    expect(formatNex(reward.coMinersWei)).toBe('567.54');
  });

  it('returns null outside the Genesis Era and for garbage input', () => {
    expect(scheduledBlockReward(0)).toBeNull();
    expect(scheduledBlockReward(GENESIS_FACTS.endBlock + 1)).toBeNull();
    expect(scheduledBlockReward(Number.NaN)).toBeNull();
    expect(scheduledBlockReward(12.5)).toBeNull();
  });

  it('covers blocks 1–10,000 in ten eras and never exceeds the cap', () => {
    const eras = genesisEraRows();
    expect(eras).toHaveLength(10);
    expect(eras[0]).toMatchObject({ era: 0, fromBlock: 1, toBlock: 1_000 });
    expect(eras[9]).toMatchObject({ era: 9, fromBlock: 9_001, toBlock: 10_000 });

    const total = eras.reduce((sum, era) => sum + era.eraTotalWei, 0n);
    expect(total).toBeLessThanOrEqual(GENESIS_ALLOCATION_WEI);
    expect(GENESIS_ALLOCATION_WEI - total).toBeLessThan(100n * NEX); // floor dust only
    expect(total).toBeGreaterThan(2_099_000n * NEX);
    // Each era total really is the sum of its blocks (dust carry included).
    expect(eras[0]!.eraTotalWei).toBe(1_000n * 1_051n * NEX);
  });
});
