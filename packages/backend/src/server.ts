import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProblemApi } from './problem-bank/app.js';
import { ProblemBank } from './problem-bank/ProblemBank.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bank = new ProblemBank({ rootDir: root });
const currentHeight = async (): Promise<number> => {
  const value = process.env.NEXUS_CURRENT_BLOCK_HEIGHT;
  if (value && /^\d+$/.test(value)) return Number(value);
  const heights = await bank.heights(); return heights.at(-1) ?? 0;
};
const isRevealed = (height: number): boolean => process.env.NEXUS_REVEALED_THROUGH !== undefined && height <= Number(process.env.NEXUS_REVEALED_THROUGH);
const app = await buildProblemApi({ bank, currentHeight, isRevealed });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });