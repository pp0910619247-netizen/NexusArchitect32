export type HexAddress = `0x${string}`;
export type HexHash = `0x${string}`;

export interface LocalizedStatement { readonly en: string; readonly th: string }
export interface IndexerProblem { readonly blockHeight: number; readonly type: 'DETERMINISTIC' | 'OPEN_ENDED'; readonly disciplines: readonly string[]; readonly difficulty: number; readonly statement: LocalizedStatement; readonly answerCommitHash: HexHash }
export interface MinerShare { readonly address: HexAddress; readonly weight: bigint; readonly amountWei: bigint; readonly transactionHash: HexHash }
export interface IndexedBlock { readonly height: number; readonly timestamp: bigint; readonly winner: HexAddress | null; readonly winnerAmountWei: bigint; readonly impactAmountWei: bigint; readonly txHash: HexHash; readonly miners: readonly MinerShare[]; readonly revealed: boolean; readonly answerHash: HexHash | null }
export interface ImpactVote { readonly voter: HexAddress; readonly support: boolean; readonly weight: bigint }
export interface IndexedProposal { readonly id: bigint; readonly beneficiary: HexAddress; readonly targetAmountWei: bigint; readonly allocatedAmountWei: bigint; readonly round: bigint; readonly createdAt: bigint; readonly closesAt: bigint; readonly status: 'ACTIVE' | 'REJECTED' | 'PINNED' | 'FUNDED' | 'EXECUTED'; readonly votes: readonly ImpactVote[] }
/**
 * One sealed quiz-chain block as exported by the node bridge
 * (`chain:export`). Commit-reveal: the answer key is hidden while the block
 * is open, and sealed blocks publish `revealedAnswerIndex` together with the
 * blind `answerCommitment` anyone can verify it against.
 */
/** One answer ("transaction") inside a sealed quiz-chain block. */
export interface QuizExplorerAnswer {
  readonly miner: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly answeredAt: number;
  readonly commitmentHash: HexHash;
}

/**
 * One sealed quiz-chain block as exported by the node bridge (`chain:export`).
 * Commit-reveal: the answer key is hidden while the block is open, and sealed
 * blocks publish `revealedAnswerIndex` together with the blind
 * `answerCommitment` anyone can verify it against.
 */
export interface QuizExplorerBlock {
  readonly height: number;
  readonly blockHash: HexHash;
  readonly parentHash: HexHash;
  readonly timestamp: number;
  readonly difficultyBits: number;
  readonly isHard: boolean;
  readonly isMilestone: boolean;
  readonly attempts: number;
  readonly miner: string;
  readonly questionId: string;
  readonly disciplineId: string;
  readonly disciplineTh: string;
  readonly disciplineEn: string;
  readonly promptTh: string;
  readonly promptEn: string;
  readonly options: readonly string[];
  readonly contentHash: HexHash;
  readonly revealedAnswerIndex: number | null;
  readonly revealedAnswerText: string | null;
  readonly answerCommitment: HexHash | null;
  readonly totalAnswers: number;
  readonly correctAnswers: number;
  /**
   * Fastest correct answerer of the block — the 40% winner of the post-treasury
   * reward. `null` while the block is open or when nobody answered correctly.
   */
  readonly winnerMiner?: string | null;
  /** Timestamp (ms) of the winning answer, for the "how fast" display. */
  readonly winnerAnsweredAt?: number | null;
  readonly answers?: readonly QuizExplorerAnswer[];
}
export interface ExplorerStats { readonly latestBlockHeight: number; readonly totalMiners: number; readonly impactTreasuryWei: bigint }
export interface ExplorerSnapshot { readonly stats: ExplorerStats; readonly blocks: readonly IndexedBlock[]; readonly problems: readonly IndexerProblem[]; readonly proposals: readonly IndexedProposal[]; readonly quizBlocks: readonly QuizExplorerBlock[] }
export interface EventAdapter {
  getLatestBlockHeight(): Promise<number>;
  getBlock(height: number): Promise<IndexedBlock | undefined>;
  getAddressHistory(address: HexAddress): Promise<readonly { block: IndexedBlock; share: MinerShare; isWinner: boolean }[]>;
  search(query: string): Promise<{ kind: 'block'; height: number } | { kind: 'address'; address: HexAddress } | { kind: 'transaction'; hash: HexHash } | undefined>;
  getImpactTreasuryBalance(): Promise<bigint>;
  getProposals(): Promise<readonly IndexedProposal[]>;
  /** Sealed quiz-chain blocks from the node bridge (optional for legacy adapters). */
  getQuizBlocks?(): Promise<readonly QuizExplorerBlock[]>;
  /** One sealed quiz-chain block by height (optional; adapters may fall back to getQuizBlocks scanning). */
  getQuizBlock?(height: number): Promise<QuizExplorerBlock | undefined>;
}
