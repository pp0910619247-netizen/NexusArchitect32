/**
 * An answer submitted by a solver for a {@link Problem}.
 */
export interface Answer {
  /** Stable unique identifier of this answer submission. */
  id: string;
  /** ID of the problem this answer responds to. */
  problemId: string;
  /** EIP-55 checksummed wallet address of the solver. */
  solverAddress: string;
  /**
   * Raw answer payload — a literal value for deterministic problems,
   * or free-form text for open-ended problems.
   */
  payload: string;
  /** Unix timestamp (seconds) at which the answer was submitted. */
  submittedAt: number;
  /**
   * Correctness verdict. `null` while awaiting human peer review
   * (open-ended problems are never auto-graded — AGENTS.md §9).
   */
  isCorrect: boolean | null;
  /** Relative weight used when splitting the 60% co-miner pool (0 when incorrect). */
  rewardWeight: number;
  /** Transaction hash of the on-chain commit, or `null` if still off-chain. */
  txHash: string | null;
}
