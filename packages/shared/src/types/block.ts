/**
 * A closed and committed block on the Nexus chain.
 */
export interface Block {
  /** Sequential 1-based height of the block. */
  height: number;
  /** 0x-prefixed 32-byte hash of this block. */
  hash: string;
  /** Hash of the parent block (`0x000…0` for the genesis block). */
  parentHash: string;
  /** Unix timestamp (seconds) at which the block was closed. */
  timestamp: number;
  /** SHA-256 commit hash of the problem set revealed in this block. */
  problemCommitHash: string;
  /** Total reward distributed by this block, in wei. */
  rewardWei: bigint;
}
