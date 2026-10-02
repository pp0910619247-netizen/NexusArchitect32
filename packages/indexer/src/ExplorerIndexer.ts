import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { EventAdapter, ExplorerSnapshot, HexAddress, HexHash, IndexerProblem, QuizExplorerBlock } from './types.js';

export interface ExplorerIndexerOptions { readonly problemBankRoot: string; readonly events: EventAdapter }
const HEIGHT_FILE = /^([1-9]\d*)\.yaml$/;
export class ExplorerIndexer {
  readonly #root: string; readonly #events: EventAdapter;
  constructor(options: ExplorerIndexerOptions) { this.#root = path.resolve(options.problemBankRoot); this.#events = options.events; }
  async listProblems(): Promise<readonly IndexerProblem[]> {
    let names: string[];
    try {
      names = await readdir(path.join(this.#root, 'problems'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const heights = names.flatMap((name) => { const match = HEIGHT_FILE.exec(name); return match ? [Number(match[1])] : []; }).sort((a, b) => b - a);
    return Promise.all(heights.map(async (height) => parse(await readFile(path.join(this.#root, 'problems', `${height}.yaml`), 'utf8')) as IndexerProblem));
  }
  async latestProblems(limit = 10): Promise<readonly IndexerProblem[]> { return (await this.listProblems()).slice(0, limit); }
  async stats() { const latestBlockHeight = await this.#events.getLatestBlockHeight(); const problems = await this.listProblems(); const blocks = await Promise.all(problems.slice(0, 10).map(({ blockHeight }) => this.#events.getBlock(blockHeight))); const miners = new Set(blocks.flatMap((block) => block?.miners.map(({ address }) => address) ?? [])); return { latestBlockHeight, totalMiners: miners.size, impactTreasuryWei: await this.#events.getImpactTreasuryBalance() }; }
  async snapshot(): Promise<ExplorerSnapshot> { const [stats, problems, proposals, quizBlocks] = await Promise.all([this.stats(), this.latestProblems(), this.#events.getProposals(), this.#events.getQuizBlocks?.() ?? Promise.resolve([])]); const blocks = (await Promise.all(problems.map(({ blockHeight }) => this.#events.getBlock(blockHeight)))).filter((block) => block !== undefined); return { stats, problems, proposals, blocks, quizBlocks }; }
  /** Latest sealed quiz-chain blocks (commit-reveal answers included). */
  async latestQuizBlocks(limit = 20): Promise<readonly QuizExplorerBlock[]> { return (await (this.#events.getQuizBlocks?.() ?? Promise.resolve([]))).slice(-limit).reverse(); }
  /** One sealed quiz-chain block by height (undefined when absent). */
  async getQuizBlock(height: number): Promise<QuizExplorerBlock | undefined> { return (await (this.#events.getQuizBlock?.(height) ?? Promise.resolve(undefined))) ?? (await (this.#events.getQuizBlocks?.() ?? Promise.resolve([]))).find((block) => block.height === height); }
  getBlock(height: number) { return this.#events.getBlock(height); }
  getAddressHistory(address: HexAddress) { return this.#events.getAddressHistory(address); }
  getProposals() { return this.#events.getProposals(); }
  search(query: string) { return this.#events.search(query); }
  getTransaction(hash: HexHash) { return this.#events.search(hash); }
}
