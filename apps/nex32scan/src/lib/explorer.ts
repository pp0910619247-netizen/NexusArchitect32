import {
  ExplorerIndexer,
  FileEventAdapter,
  EMPTY_EVENT_SNAPSHOT,
  type EventAdapter,
  type FileEventSnapshot,
  type HexAddress,
  type HexHash,
  type IndexedBlock,
  type IndexedProposal,
  type MinerShare,
  type QuizExplorerAnswer,
  type QuizExplorerBlock,
} from '@nexus/indexer';
import { readFile } from 'node:fs/promises';

export type ExplorerSourceMode = 'remote' | 'hybrid' | 'file' | 'baked';

const BAKED_SNAPSHOT_JSON = process.env.BAKED_SNAPSHOT_JSON ?? '';

/**
 * Live quiz-chain node URL, honoured at runtime only.
 * `next build` ignores it on purpose: a build-time fetch would turn every
 * prerenderable page into a dynamic serverless function (the free Hobby plan
 * allows 12, see DEPLOY.md). Runtime reads still go to the live node.
 */
export function remoteApiUrl(): string | undefined {
  if (process.env.NEXT_PHASE === 'phase-production-build') return undefined;
  return process.env.QUIZ_CHAIN_API_URL || undefined;
}

/** Which data source the running deployment reads from. */
export function sourceMode(): ExplorerSourceMode {
  if (!remoteApiUrl()) {
    if (process.env.INDEXER_SNAPSHOT_PATH) return 'file';
    return 'baked'; // cloud default: snapshot baked into the build
  }
  return BAKED_SNAPSHOT_JSON ? 'hybrid' : 'remote';
}

/** Raw JSON config: runtime env wins, else the value baked at build time. */
export function runtimeRawJson(): string {
  return process.env.EXPLORER_RUNTIME_JSON ?? BAKED_SNAPSHOT_JSON;
}

/** Raw JSON → validated FileEventSnapshot (never throws on partial data). */
function rawSnapshot(raw: string): FileEventSnapshot {
  if (!raw) return EMPTY_EVENT_SNAPSHOT;
  try {
    const parsed = JSON.parse(raw) as Partial<FileEventSnapshot>;
    return {
      latestBlockHeight: Number(parsed.latestBlockHeight ?? 0),
      impactTreasuryWei: String(parsed.impactTreasuryWei ?? '0'),
      blocks: parsed.blocks ?? {},
      proposals: parsed.proposals ?? [],
      quizBlocks: parsed.quizBlocks ?? [],
    };
  } catch {
    return EMPTY_EVENT_SNAPSHOT;
  }
}

/** Maps one node-API answer payload onto the explorer's answer shape. */
function toQuizExplorerAnswers(raw: unknown): QuizExplorerAnswer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => {
    const answer = (item ?? {}) as Record<string, unknown>;
    return {
      miner: String(answer.miner ?? ''),
      choice: Number(answer.choice ?? 0),
      correct: Boolean(answer.correct),
      answeredAt: Number(answer.answeredAt ?? 0),
      commitmentHash: String(answer.commitmentHash ?? '') as HexHash,
    };
  });
}

/** Maps one node-API block payload onto the explorer's quiz-block shape. */
function toQuizExplorerBlock(raw: Record<string, unknown>): QuizExplorerBlock {
  const question = (raw.question ?? {}) as Record<string, unknown>;
  const options = Array.isArray(question.options) ? question.options.map(String) : [];
  const revealed =
    raw.revealedAnswerIndex === null || raw.revealedAnswerIndex === undefined
      ? null
      : Number(raw.revealedAnswerIndex);
  return {
    height: Number(raw.height ?? 0),
    blockHash: String(raw.hash ?? '') as HexHash,
    parentHash: String(raw.parentHash ?? '') as HexHash,
    timestamp: Number(raw.timestamp ?? 0),
    difficultyBits: Number(raw.difficultyBits ?? 0),
    isHard: Boolean(raw.isHard),
    isMilestone: Boolean(raw.isMilestone),
    attempts: Number(raw.attempts ?? 0),
    miner: String(raw.miner ?? ''),
    questionId: String(question.id ?? ''),
    disciplineId: String(question.disciplineId ?? ''),
    disciplineTh: String(question.disciplineTh ?? ''),
    disciplineEn: String(question.disciplineEn ?? ''),
    promptTh: String(question.promptTh ?? ''),
    promptEn: String(question.promptEn ?? ''),
    options,
    contentHash: String(question.contentHash ?? '') as HexHash,
    revealedAnswerIndex: revealed,
    revealedAnswerText: revealed === null ? null : (options[revealed] ?? null),
    answerCommitment: raw.answerCommitment == null ? null : (String(raw.answerCommitment) as HexHash),
    totalAnswers: Number(raw.answerCount ?? Number(Array.isArray(raw.answers) ? raw.answers.length : 0)),
    correctAnswers: Number(raw.correctCount ?? 0),
    winnerMiner: raw.winnerMiner == null ? null : String(raw.winnerMiner),
    winnerAnsweredAt: raw.winnerAnsweredAt == null ? null : Number(raw.winnerAnsweredAt),
    answers: toQuizExplorerAnswers(raw.answers),
  };
}

/** EventAdapter backed by the live quiz-chain node HTTP API. */
class RemoteApiAdapter implements EventAdapter {
  constructor(private readonly baseUrl: string) {}

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      // cache:'no-store' bypasses Next.js's fetch data cache — chain data
      // must always be read live (a cached /api/status freezes the explorer).
      const response = await fetch(new URL(path, this.baseUrl), { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null; // fail-soft: pages render what they have instead of a 500
    }
  }

  async getLatestBlockHeight(): Promise<number> {
    const status = await this.fetchJson<{ height?: unknown }>('/api/status');
    return Number(status?.height ?? 0);
  }

  async getBlock(height: number): Promise<IndexedBlock | undefined> {
    const payload = await this.fetchJson<Record<string, unknown>>(`/api/blocks/${height}`);
    return payload ? this.toIndexedBlock(payload) : undefined;
  }

  /** Node-API block → legacy treasury-block shape (no miner ledger on the quiz chain). */
  private toIndexedBlock(raw: Record<string, unknown>): IndexedBlock {
    const quiz = toQuizExplorerBlock(raw);
    return {
      height: quiz.height,
      timestamp: BigInt(quiz.timestamp),
      winner: quiz.miner.startsWith('0x') ? (quiz.miner as HexAddress) : null,
      winnerAmountWei: 0n,
      impactAmountWei: 0n,
      txHash: quiz.blockHash,
      miners: [],
      revealed: quiz.revealedAnswerIndex !== null,
      answerHash: null,
    };
  }

  async getAddressHistory(_address: HexAddress): Promise<readonly { block: IndexedBlock; share: MinerShare; isWinner: boolean }[]> {
    void _address; // the node API exposes no per-address miner history yet
    return [];
  }

  async search(query: string) {
    if (/^\d+$/.test(query)) return { kind: 'block' as const, height: Number(query) };
    if (/^0x[0-9a-fA-F]{40}$/.test(query)) return { kind: 'address' as const, address: query as HexAddress };
    if (/^0x[0-9a-fA-F]{64}$/.test(query)) return { kind: 'transaction' as const, hash: query as HexHash };
    return undefined;
  }

  async getImpactTreasuryBalance(): Promise<bigint> {
    return 0n; // the quiz-chain node carries no impact treasury
  }

  async getProposals(): Promise<readonly IndexedProposal[]> {
    return [];
  }

  async getQuizBlocks(): Promise<readonly QuizExplorerBlock[]> {
    const total = (await this.fetchJson<{ total?: number }>('/api/blocks?limit=1'))?.total ?? 0;
    if (total <= 0) return [];
    const offset = Math.max(0, total - 100); // latest window, not the first 100
    const payload = await this.fetchJson<{ blocks?: unknown[] }>(`/api/blocks?limit=100&offset=${offset}`);
    const list = Array.isArray(payload?.blocks) ? payload.blocks : [];
    return list.map((block) => toQuizExplorerBlock(block as Record<string, unknown>));
  }

  /** Direct lookup so a single height never depends on the latest-window scan. */
  async getQuizBlock(height: number): Promise<QuizExplorerBlock | undefined> {
    const payload = await this.fetchJson<Record<string, unknown>>(`/api/blocks/${height}`);
    return payload ? toQuizExplorerBlock(payload) : undefined;
  }
}

/** Live node first; when it is unreachable, fall back to the baked snapshot. */
class HybridAdapter implements EventAdapter {
  constructor(
    private readonly remote: RemoteApiAdapter,
    private readonly fallback: FileEventSnapshot,
  ) {}

  /** Uses the remote value unless it comes back empty/unreachable. */
  private async withRemote<T>(remote: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    const value = await remote();
    const empty = Array.isArray(value) ? value.length === 0 : value === undefined || value === 0;
    return empty ? fallback() : value;
  }

  async getLatestBlockHeight() {
    return this.withRemote(
      () => this.remote.getLatestBlockHeight(),
      async () => this.fallback.latestBlockHeight,
    );
  }

  async getBlock(height: number) {
    return this.withRemote(
      () => this.remote.getBlock(height),
      async (): Promise<IndexedBlock | undefined> => {
        const item = this.fallback.blocks[String(height)];
        return item ? { ...item, height } : undefined;
      },
    );
  }

  async getAddressHistory(address: HexAddress) {
    return this.withRemote(
      () => this.remote.getAddressHistory(address),
      async () =>
        Object.entries(this.fallback.blocks).flatMap(([height, block]) =>
          block.miners
            .filter((share) => share.address === address)
            .map((share) => ({ block: { ...block, height: Number(height) }, share, isWinner: block.winner === address })),
        ),
    );
  }

  async search(query: string) {
    const local =
      /^\d+$/.test(query) &&
      (this.fallback.blocks[query] || (this.fallback.quizBlocks ?? []).some((block) => block.height === Number(query)))
        ? ({ kind: 'block' as const, height: Number(query) } as const)
        : undefined;
    return local ?? this.remote.search(query);
  }

  async getImpactTreasuryBalance() {
    return BigInt(this.fallback.impactTreasuryWei);
  }

  async getProposals() {
    return this.fallback.proposals;
  }

  async getQuizBlocks() {
    return this.withRemote(
      () => this.remote.getQuizBlocks(),
      async () => this.fallback.quizBlocks ?? [],
    );
  }

  async getQuizBlock(height: number) {
    const remote = await this.remote.getQuizBlock(height);
    if (remote) return remote;
    return (this.fallback.quizBlocks ?? []).find((block) => block.height === height);
  }
}

async function adapter(): Promise<ExplorerIndexer> {
  const problemBankRoot = process.env.PROBLEM_BANK_ROOT ?? process.cwd();
  const mode = sourceMode();
  if (mode === 'remote') {
    return new ExplorerIndexer({ problemBankRoot, events: new RemoteApiAdapter(remoteApiUrl()!) });
  }
  if (mode === 'hybrid') {
    const fallback = rawSnapshot(runtimeRawJson());
    return new ExplorerIndexer({ problemBankRoot, events: new HybridAdapter(new RemoteApiAdapter(remoteApiUrl()!), fallback) });
  }
  if (mode === 'file') {
    const path = process.env.INDEXER_SNAPSHOT_PATH;
    const read = async (): Promise<FileEventSnapshot> => {
      if (path) {
        try {
          return (JSON.parse(await readFile(path, 'utf8')) as Partial<FileEventSnapshot>) as unknown as FileEventSnapshot;
        } catch {
          // The snapshot file only exists on the machine that exported it; on a
          // cloud host fall back to the JSON baked into the build.
        }
      }
      return rawSnapshot(runtimeRawJson());
    };
    return new ExplorerIndexer({ problemBankRoot, events: new FileEventAdapter(read) });
  }
  const raw = runtimeRawJson();
  return new ExplorerIndexer({ problemBankRoot, events: new FileEventAdapter(async () => rawSnapshot(raw)) });
}

export async function indexer() {
  return adapter();
}
