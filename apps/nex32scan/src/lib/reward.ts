/**
 * Genesis-Era reward display. The numbers come from `@nexus/shared` — the same
 * locked constants and integer math the contract suite and the mobile wallet
 * use — so the explorer can never show a reward the chain would not schedule.
 * AGENTS.md §4: 1,051 NEX at block 1, halving every 1,000 blocks, 10% of every
 * block to the Impact Treasury, then 40% winner / 60% correct co-miners.
 */
import {
  GENESIS_ALLOCATION_NEX,
  GENESIS_END_BLOCK,
  GENESIS_START_BLOCK,
  HALVING_INTERVAL_BLOCKS,
  INITIAL_BLOCK_REWARD_NEX,
  getBlockRewardWei,
  splitBlockReward,
} from '@nexus/shared';

/** Locked tokenomics figures the explorer pages print verbatim. */
export const GENESIS_FACTS = {
  startBlock: Number(GENESIS_START_BLOCK),
  endBlock: Number(GENESIS_END_BLOCK),
  halvingInterval: Number(HALVING_INTERVAL_BLOCKS),
  initialRewardNex: Number(INITIAL_BLOCK_REWARD_NEX),
  allocationNex: Number(GENESIS_ALLOCATION_NEX),
} as const;

/** Scheduled reward of one block plus its ordered split. */
export interface BlockReward {
  readonly height: number;
  /** 0-based halving era (0 = blocks 1–1,000). */
  readonly era: number;
  readonly rewardWei: bigint;
  readonly impactTreasuryWei: bigint;
  readonly winnerWei: bigint;
  readonly coMinersWei: bigint;
}

/**
 * Reward schedule for a height, or `null` outside the Genesis Era (1–10,000)
 * where no emission is scheduled. Never throws on user-supplied input.
 */
export function scheduledBlockReward(height: number): BlockReward | null {
  if (!Number.isSafeInteger(height)) return null;
  if (height < GENESIS_FACTS.startBlock || height > GENESIS_FACTS.endBlock) return null;
  const rewardWei = getBlockRewardWei(height);
  const split = splitBlockReward(rewardWei);
  return {
    height,
    era: Math.floor((height - GENESIS_FACTS.startBlock) / GENESIS_FACTS.halvingInterval),
    rewardWei,
    impactTreasuryWei: split.impactTreasuryWei,
    winnerWei: split.winnerWei,
    coMinersWei: split.coMinersWei,
  };
}

/** One halving era of the Genesis Era, with its exact scheduled emission. */
export interface GenesisEraRow {
  readonly era: number;
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly rewardWei: bigint;
  readonly eraTotalWei: bigint;
}

/**
 * The ten Genesis halving eras with exact totals. Totals are summed block by
 * block (not multiplied) so a rounding-dust carry inside the era is included.
 */
export function genesisEraRows(): GenesisEraRow[] {
  const rows: GenesisEraRow[] = [];
  for (let from = GENESIS_FACTS.startBlock; from <= GENESIS_FACTS.endBlock; from += GENESIS_FACTS.halvingInterval) {
    const toBlock = Math.min(from + GENESIS_FACTS.halvingInterval - 1, GENESIS_FACTS.endBlock);
    let eraTotalWei = 0n;
    for (let height = from; height <= toBlock; height += 1) eraTotalWei += getBlockRewardWei(height);
    rows.push({
      era: (from - GENESIS_FACTS.startBlock) / GENESIS_FACTS.halvingInterval,
      fromBlock: from,
      toBlock,
      rewardWei: getBlockRewardWei(from),
      eraTotalWei,
    });
  }
  return rows;
}
