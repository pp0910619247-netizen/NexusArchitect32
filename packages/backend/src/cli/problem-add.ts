import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { ProblemBank } from '../problem-bank/ProblemBank.js';
import type { ProblemInput } from '../problem-bank/types.js';

const file = process.argv[2];
if (!file) { console.error('PROBLEM_FILE_REQUIRED'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(path.resolve(file), 'utf8');
let input: ProblemInput;
try {
  input = parse(source) as ProblemInput;
} catch {
  console.error('INVALID_PROBLEM_FILE');
  process.exit(2);
}
if (!input || typeof input !== 'object') {
  console.error('INVALID_PROBLEM_FILE');
  process.exit(2);
}
try {
  const result = await new ProblemBank({ rootDir: root }).save(input);
  console.log(JSON.stringify({ blockHeight: result.public.blockHeight, answerCommitHash: result.public.answerCommitHash, calldata: result.calldata }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PROBLEM_SAVE_FAILED');
  process.exit(1);
}