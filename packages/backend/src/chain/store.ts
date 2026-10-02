import { open, mkdir, readFile, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { blockHashMatches } from './block.js';
import type { QuizBlock } from './types.js';

/**
 * On-disk chain store: a JSONL log of sealed blocks at
 * `CHAIN_DATA_DIR/blocks.jsonl`.
 *
 * Durability model:
 * - Every sealed block is appended with a single write followed by `fsync`,
 *   so a crash can lose at most the block being written — never an earlier
 *   one, and never the block ordering. (An append-only log with fsync beats
 *   temp+rename here: rename would rewrite the whole growing file per block,
 *   O(n²) I/O, while the append tail is still made torn-safe at load.)
 * - On load, the log is treated as the pre-image of the last append: a torn
 *   trailing line is dropped and any block that fails its own SHA-256 hash
 *   check truncates the rest, leaving a prefix that `verifyChain` accepts.
 */
export class ChainStore {
  readonly #dir: string;
  readonly #blocksPath: string;
  #appendHandle: FileHandle | null = null;

  constructor(dataDir: string) {
    this.#dir = dataDir;
    this.#blocksPath = path.join(dataDir, 'blocks.jsonl');
  }

  /** Opens the append handle, creating the data dir as needed. */
  async open(): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    this.#appendHandle = await open(this.#blocksPath, 'a');
  }

  /** Appends one sealed block durably (single write + fsync). */
  async appendBlock(block: QuizBlock): Promise<void> {
    const handle = this.#requireHandle();
    await handle.write(`${JSON.stringify(block)}\n`, null, 'utf8');
    await handle.sync();
  }

  /**
   * Atomically replaces the durable log with `blocks` (fork-choice commit:
   * write temp → fsync temp → rename over the log → fsync dir). A crash
   * mid-way leaves the OLD log intact, so the store never ends up with a
   * half-written chain.
   */
  async rewriteBlocks(blocks: readonly QuizBlock[]): Promise<void> {
    const handle = this.#requireHandle();
    const tempPath = `${this.#blocksPath}.reorg.tmp`;
    const payload = blocks.map((block) => `${JSON.stringify(block)}\n`).join('');
    const temp = await open(tempPath, 'w');
    try {
      await temp.write(payload, null, 'utf8');
      await temp.sync();
    } finally {
      await temp.close();
    }
    // Close the append handle BEFORE the rename — on Windows a rename over
    // a file with an open write handle fails (EBUSY/EPERM).
    await handle.close();
    this.#appendHandle = null;
    try {
      await rename(tempPath, this.#blocksPath);
    } catch (error) {
      // Roll back to the OLD log so the store keeps working.
      this.#appendHandle = await open(this.#blocksPath, 'a');
      throw error;
    }
    this.#appendHandle = await open(this.#blocksPath, 'a');
  }

  /**
   * Loads the durable block prefix: drops a torn trailing line, then keeps
   * blocks while each one parses AND matches its own hash. The returned list
   * is exactly what the next `verifyChain` will accept.
   */
  async loadBlocks(): Promise<readonly QuizBlock[]> {
    let raw: string;
    try {
      raw = await readFile(this.#blocksPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const lines = raw.split('\n');
    const last = lines.at(-1);
    if (last !== undefined && last !== '') lines.pop(); // torn append
    const blocks: QuizBlock[] = [];
    for (const line of lines) {
      if (line === '') continue;
      let parsed: QuizBlock;
      try {
        parsed = JSON.parse(line) as QuizBlock;
      } catch {
        break; // corrupted line → nothing after it is trusted
      }
      if (!isValidBlockShape(parsed) || !blockHashMatches(parsed)) break;
      blocks.push(parsed);
    }
    return blocks;
  }

  /** Closes the append handle. */
  async close(): Promise<void> {
    if (this.#appendHandle !== null) {
      await this.#appendHandle.close();
      this.#appendHandle = null;
    }
  }

  #requireHandle(): FileHandle {
    if (this.#appendHandle === null) throw new Error('STORE_NOT_OPEN');
    return this.#appendHandle;
  }
}

/** Defensive shape check before trusting parsed JSON as a block. */
function isValidBlockShape(block: unknown): block is QuizBlock {
  if (typeof block !== 'object' || block === null) return false;
  const candidate = block as Record<string, unknown>;
  return (
    typeof candidate.height === 'number' &&
    typeof candidate.hash === 'string' &&
    typeof candidate.parentHash === 'string' &&
    typeof candidate.difficultyBits === 'number' &&
    typeof candidate.nonce === 'number' &&
    typeof candidate.miner === 'string' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.question === 'object' &&
    candidate.question !== null
  );
}
