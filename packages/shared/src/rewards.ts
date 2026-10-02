/**
 * Block-reward calculation for the Genesis Era (AGENTS.md §4).
 *
 * All arithmetic is integer `bigint` wei math. Halving uses floor division and
 * any dropped wei is carried into the next block, so the sum of blocks 1–10,000
 * can never exceed the 2,100,000 NEX Genesis cap.
 */
import {
  BPS_DENOMINATOR,
  CO_MINERS_BPS_OF_REMAINING,
  GENESIS_ALLOCATION_WEI,
  GENESIS_END_BLOCK,
  GENESIS_START_BLOCK,
  HALVING_INTERVAL_BLOCKS,
  IMPACT_TREASURY_BPS,
  INITIAL_BLOCK_REWARD_WEI,
  WINNER_BPS_OF_REMAINING,
} from './constants/tokenomics.js';

/** Result of splitting one block reward across treasury / winner / co-miners. */
export interface BlockRewardSplit {
  /** 10% of the block reward plus every wei of split dust. */
  readonly impactTreasuryWei: bigint;
  /** 40% of the remaining 90% — the single fastest accurate winner. */
  readonly winnerWei: bigint;
  /** 60% of the remaining 90% — proportional pool for correct co-miners. */
  readonly coMinersWei: bigint;
}

/**
 * Halves a wei amount using floor division, returning the wei dropped by
 * rounding so callers can carry it into the next block.
 *
 * @param wei - Non-negative amount in wei.
 * @returns The floored half and the dropped remainder (0 or 1 wei).
 */
export function halveWithCarry(wei: bigint): { halved: bigint; remainder: bigint } {
  if (wei < 0n) {
    throw new RangeError(`Cannot halve a negative amount: ${wei}`);
  }
  const halved = wei >> 1n;
  return { halved, remainder: wei - (halved << 1n) };
}

/**
 * Returns the emission schedule for one block inside the Genesis Era.
 *
 * Reward halves every {@link HALVING_INTERVAL_BLOCKS} blocks (floor division);
 * the wei dropped at a halving boundary is carried into the first block of the
 * new era so no dust is lost and the cap can never be exceeded.
 *
 * @param blockHeight - Block height, 1-based (accepts `number` or `bigint`).
 * @returns The block reward in wei.
 * @throws {RangeError} When the height is outside the Genesis Era (1–10,000).
 */
export function getBlockRewardWei(blockHeight: bigint | number): bigint {
  const height = typeof blockHeight === 'bigint' ? blockHeight : BigInt(blockHeight);
  if (height < GENESIS_START_BLOCK || height > GENESIS_END_BLOCK) {
    throw new RangeError(
      `Block height ${height} is outside the Genesis Era (${GENESIS_START_BLOCK}–${GENESIS_END_BLOCK}).`,
    );
  }
  const era = Number((height - GENESIS_START_BLOCK) / HALVING_INTERVAL_BLOCKS);
  const nominal = INITIAL_BLOCK_REWARD_WEI >> BigInt(era);
  if (era === 0) {
    return nominal;
  }
  const previousEraReward = INITIAL_BLOCK_REWARD_WEI >> BigInt(era - 1);
  const { remainder } = halveWithCarry(previousEraReward);
  // Carry the rounding dust dropped by the previous era's halving into this
  // block (the block right after the halving point).
  return nominal + remainder;
}

/**
 * Builds the full emission schedule for the Genesis Era (blocks 1–10,000).
 *
 * @returns An immutable list of per-block rewards in wei, indexed by `height - 1`.
 */
export function buildGenesisRewardSchedule(): readonly bigint[] {
  const rewards: bigint[] = [];
  let height = GENESIS_START_BLOCK;
  while (height <= GENESIS_END_BLOCK) {
    rewards.push(getBlockRewardWei(height));
    height += 1n;
  }
  return Object.freeze(rewards);
}

/**
 * Sums the full Genesis Era schedule.
 *
 * @returns Total emission of blocks 1–10,000 in wei (guaranteed ≤ the cap).
 */
export function sumGenesisRewardsWei(): bigint {
  let total = 0n;
  for (const reward of buildGenesisRewardSchedule()) {
    total += reward;
  }
  return total;
}

/**
 * Splits a single block reward exactly as AGENTS.md §4 orders it:
 *
 * 1. Floor 10% to the ImpactTreasury.
 * 2. Of the remaining 90%, floor 40% to the winner and 60% to the co-miner pool.
 * 3. Any leftover wei from the integer divisions goes to the ImpactTreasury.
 *
 * The three outputs always sum back to `rewardWei` exactly.
 *
 * @param rewardWei - The block reward in wei (must be ≥ 0).
 * @throws {RangeError} When `rewardWei` is negative.
 */
export function splitBlockReward(rewardWei: bigint): BlockRewardSplit {
  if (rewardWei < 0n) {
    throw new RangeError(`Block reward cannot be negative: ${rewardWei}`);
  }
  const treasuryShare = (rewardWei * IMPACT_TREASURY_BPS) / BPS_DENOMINATOR;
  const remaining = rewardWei - treasuryShare;
  const winnerWei = (remaining * WINNER_BPS_OF_REMAINING) / BPS_DENOMINATOR;
  const coMinersWei = (remaining * CO_MINERS_BPS_OF_REMAINING) / BPS_DENOMINATOR;
  const dust = remaining - winnerWei - coMinersWei;
  return {
    impactTreasuryWei: treasuryShare + dust,
    winnerWei,
    coMinersWei,
  };
}

/**
 * Convenience guard: total Genesis Era emission must never exceed the cap.
 *
 * @returns `true` when the full schedule fits under the 2,100,000 NEX cap.
 */
export function isWithinGenesisCap(): boolean {
  return sumGenesisRewardsWei() <= GENESIS_ALLOCATION_WEI;
}
