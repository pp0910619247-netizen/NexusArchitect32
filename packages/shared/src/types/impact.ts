import type { LocalizedText } from './problem.js';

/** Lifecycle state of an Impact Treasury proposal. */
export type ImpactProposalStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'FUNDED'
  | 'REJECTED'
  | 'EXECUTED';

/**
 * A proposal funded by the Impact Treasury (10% of every block reward).
 */
export interface ImpactProposal {
  /** Stable unique identifier of the proposal. */
  id: string;
  /** Bilingual proposal title. */
  title: LocalizedText;
  /** Bilingual proposal description / requested outcome. */
  description: LocalizedText;
  /** EIP-55 checksummed address of the proposal requester. */
  requesterAddress: string;
  /** Amount requested from the treasury, in wei. */
  requestedAmountWei: bigint;
  /** Current lifecycle state of the proposal. */
  status: ImpactProposalStatus;
  /** Unix timestamp (seconds) at which the proposal was created. */
  createdAt: number;
  /** Transaction hash that funded the proposal, or `null` before execution. */
  fundingTxHash: string | null;
}
