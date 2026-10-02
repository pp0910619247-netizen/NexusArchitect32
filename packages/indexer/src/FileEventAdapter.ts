import type {
  EventAdapter,
  HexAddress,
  HexHash,
  IndexedBlock,
  IndexedProposal,
  QuizExplorerBlock,
} from './types.js';

export interface FileEventSnapshot {
  readonly latestBlockHeight: number;
  readonly impactTreasuryWei: string;
  readonly blocks: Record<string, Omit<IndexedBlock, 'height'>>;
  readonly proposals: readonly IndexedProposal[];
  /** Sealed quiz-chain blocks from the node bridge (chain:export). */
  readonly quizBlocks?: readonly QuizExplorerBlock[];
}
export class FileEventAdapter implements EventAdapter {
  constructor(private readonly read: () => Promise<FileEventSnapshot>) {}
  private async load() { return this.read(); }
  async getLatestBlockHeight() { return (await this.load()).latestBlockHeight; }
  async getBlock(height: number) { const item = (await this.load()).blocks[String(height)]; return item ? { ...item, height } : undefined; }
  async getAddressHistory(address: HexAddress) { const snapshot = await this.load(); return Promise.all(Object.entries(snapshot.blocks).flatMap(([height, block]) => block.miners.filter((share) => share.address === address).map((share) => ({ block: { ...block, height: Number(height) }, share, isWinner: block.winner === address })))); }
  async search(query: string) { const snapshot = await this.load(); if (/^\d+$/.test(query)) { const height = Number(query); if (snapshot.blocks[String(height)] || (snapshot.quizBlocks ?? []).some((block) => block.height === height)) return { kind: 'block' as const, height }; } if (/^0x[0-9a-fA-F]{40}$/.test(query)) return { kind: 'address' as const, address: query as HexAddress }; if (/^0x[0-9a-fA-F]{64}$/.test(query)) return { kind: 'transaction' as const, hash: query as HexHash }; return undefined; }
  async getImpactTreasuryBalance() { return BigInt((await this.load()).impactTreasuryWei); }
  async getProposals() { return (await this.load()).proposals; }
  /** Quiz-chain blocks exported by the node bridge (empty when absent). */
  async getQuizBlocks(): Promise<readonly QuizExplorerBlock[]> { return (await this.load()).quizBlocks ?? []; }
  /** One quiz-chain block by height (undefined when absent). */
  async getQuizBlock(height: number): Promise<QuizExplorerBlock | undefined> { return (await this.getQuizBlocks()).find((block) => block.height === height); }
}
export const EMPTY_EVENT_SNAPSHOT: FileEventSnapshot = { latestBlockHeight: 0, impactTreasuryWei: '0', blocks: {}, proposals: [], quizBlocks: [] };
