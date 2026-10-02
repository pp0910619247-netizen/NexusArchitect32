import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { answerHashMatches, commitAnswer, toPublicProblem } from './commitment.js';
import type { PrivateProblemFile, ProblemInput, PublicProblemFile } from './types.js';

const PUBLIC_FILE = /^([1-9]\d*)\.yaml$/;

export interface ProblemBankOptions { readonly rootDir: string; }
export class ProblemBank {
  readonly #root: string;
  constructor(options: ProblemBankOptions) { this.#root = path.resolve(options.rootDir); }
  #publicPath(height: number): string { return path.join(this.#root, 'problems', `${height}.yaml`); }
  #privatePath(height: number): string { return path.join(this.#root, 'private', 'problems', `${height}.yaml`); }

  async save(input: ProblemInput): Promise<{ public: PublicProblemFile; private: PrivateProblemFile; calldata: Hex }> {
    const publicProblem = toPublicProblem(input);
    const privateProblem: PrivateProblemFile = { blockHeight: input.blockHeight, answerPlain: input.answerPlain, salt: input.salt, answerCommitHash: publicProblem.answerCommitHash };
    const { encodeFunctionData } = await import('viem');
    const calldata = encodeFunctionData({ abi: [{ type: 'function', name: 'submitProblemCommitment', stateMutability: 'nonpayable', inputs: [{ name: 'blockHeight', type: 'uint256' }, { name: 'answerCommitHash', type: 'bytes32' }], outputs: [] }], functionName: 'submitProblemCommitment', args: [BigInt(input.blockHeight), publicProblem.answerCommitHash] });
    await mkdir(path.join(this.#root, 'problems'), { recursive: true });
    await mkdir(path.join(this.#root, 'private', 'problems'), { recursive: true });
    await writeFile(this.#publicPath(input.blockHeight), stringify(publicProblem), 'utf8');
    await writeFile(this.#privatePath(input.blockHeight), stringify(privateProblem), { encoding: 'utf8', mode: 0o600 });
    return { public: publicProblem, private: privateProblem, calldata };
  }

  async getPublic(height: number): Promise<PublicProblemFile | undefined> {
    try { return parse(await readFile(this.#publicPath(height), 'utf8')) as PublicProblemFile; } catch (error) { if (isMissing(error)) return undefined; throw error; }
  }
  async getPrivate(height: number): Promise<PrivateProblemFile | undefined> {
    try { return parse(await readFile(this.#privatePath(height), 'utf8')) as PrivateProblemFile; } catch (error) { if (isMissing(error)) return undefined; throw error; }
  }
  async verify(height: number, hash: Hex): Promise<boolean> {
    const problem = await this.getPublic(height);
    return problem ? answerHashMatches(problem.answerCommitHash, hash) : false;
  }
  async heights(): Promise<readonly number[]> {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(path.join(this.#root, 'problems'));
    return files.flatMap((file) => { const match = PUBLIC_FILE.exec(file); return match ? [Number(match[1])] : []; }).sort((a, b) => a - b);
  }
}
type Hex = `0x${string}`;
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
export { commitAnswer };