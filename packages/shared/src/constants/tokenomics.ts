/**
 * Canonical tokenomics constants for Nexus Architect (NEX).
 *
 * Every value comes straight from AGENTS.md §4 — never recompute these numbers
 * elsewhere. All quantities are `bigint` so wei-scale values stay exact
 * (no floating point). Coin amounts are expressed in wei (18 decimals).
 */

/** Number of decimals used by NEX (wei scale). */
export const NEX_DECIMALS = 18n;

/** Total token supply: 21,000,000 NEX expressed in wei. */
export const TOTAL_SUPPLY_WEI = 21_000_000n * 10n ** NEX_DECIMALS;

/** Total token supply: 21,000,000 NEX (whole-token unit, for display math). */
export const TOTAL_SUPPLY_NEX = 21_000_000n;

/** Basis-point denominator (100% = 10,000 bps). */
export const BPS_DENOMINATOR = 10_000n;

/** Mining allocation: 50% of total supply. */
export const ALLOCATION_MINING_BPS = 5_000n;

/** Public sale allocation: 30% of total supply. */
export const ALLOCATION_PUBLIC_SALE_BPS = 3_000n;

/** Team allocation: 20% of total supply. */
export const ALLOCATION_TEAM_BPS = 2_000n;

/** Team vesting cliff: 0 months (vesting starts immediately). */
export const TEAM_VESTING_CLIFF_MONTHS = 0n;

/** Team vesting unlock interval: equal unlocks every 3 months (quarterly). */
export const TEAM_VESTING_INTERVAL_MONTHS = 3n;

/** Public sale proceeds locked as LP on a DEX: 50%. */
export const PUBLIC_SALE_LP_LOCK_BPS = 5_000n;

/** Public sale proceeds routed to the Dev Treasury: 50%. */
export const PUBLIC_SALE_DEV_TREASURY_BPS = 5_000n;

/** First block of the Genesis Era. */
export const GENESIS_START_BLOCK = 1n;

/** Last block of the Genesis Era (inclusive). */
export const GENESIS_END_BLOCK = 10_000n;

/** Number of blocks in the Genesis Era (block 1 through 10,000). */
export const GENESIS_BLOCK_COUNT = GENESIS_END_BLOCK - GENESIS_START_BLOCK + 1n;

/** Genesis Era total reward: 10% of TOTAL_SUPPLY = 2,100,000 NEX, in wei. */
export const GENESIS_ALLOCATION_WEI = 2_100_000n * 10n ** NEX_DECIMALS;

/** Genesis Era total reward in whole NEX (2,100,000 NEX). */
export const GENESIS_ALLOCATION_NEX = 2_100_000n;

/** Genesis Era share of total supply: 10%. */
export const GENESIS_ALLOCATION_BPS = 1_000n;

/** Blocks between reward halvings inside the Genesis Era. */
export const HALVING_INTERVAL_BLOCKS = 1_000n;

/** Initial per-block reward: 1,051 NEX (whole-token unit). */
export const INITIAL_BLOCK_REWARD_NEX = 1_051n;

/**
 * Initial per-block reward in wei: 1,051 NEX.
 *
 * Derived from 2,100,000 / (1,000 × (2 − 2⁻⁹)) ≈ 1,051.03, floored to 1,051 NEX.
 * The un-minted dust keeps the Genesis Era total strictly under the 2,100,000 NEX cap.
 */
export const INITIAL_BLOCK_REWARD_WEI = INITIAL_BLOCK_REWARD_NEX * 10n ** NEX_DECIMALS;

/** Share of each block reward sent to the ImpactTreasury first: 10%. */
export const IMPACT_TREASURY_BPS = 1_000n;

/** Share of the remaining 90% going to the single fastest/most accurate winner: 40%. */
export const WINNER_BPS_OF_REMAINING = 4_000n;

/** Share of the remaining 90% split proportionally among correct co-miners: 60%. */
export const CO_MINERS_BPS_OF_REMAINING = 6_000n;
