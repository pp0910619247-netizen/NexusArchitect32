// SPDX-License-Identifier: MIT
/**
 * world:generate — writes the world-v1 question bank (10 JSONL files x 1,000).
 *
 * Deterministic by construction: the ladder (ladder.ts), the composer
 * (compose.ts) and the flagship (flagship.ts) are pure functions of the
 * question index, so re-running this CLI is byte-identical. Nothing here reads
 * the clock, the network, or any file besides the output directory.
 *
 * Usage:
 *   pnpm --filter @nexus/backend world:generate
 *   node dist/worldbank/generate.js --out <dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCIPLINE_IDS } from '../chain/disciplines.js';
import { composeQuestion, newBuildContext, type WorldQuestion } from './compose.js';
import { flagshipQuestion } from './flagship.js';
import { FLAGSHIP_INDEX, TOTAL, newLadderState, planForIndex } from './ladder.js';

export const SCHEMA_VERSION = 'world-v1';
export const QUESTIONS_PER_FILE = 1_000;
export const FILE_COUNT = TOTAL / QUESTIONS_PER_FILE;

export interface GeneratedFile {
  readonly name: string;
  readonly count: number;
  readonly bytes: number;
  readonly firstId: string;
  readonly lastId: string;
}

/** Exact field order required by the mission brief (no extra fields). */
export function serializeQuestion(question: WorldQuestion): string {
  return JSON.stringify({
    id: question.id,
    disciplines: question.disciplines,
    primaryDiscipline: question.primaryDiscipline,
    subjectCount: question.subjectCount,
    difficulty: question.difficulty,
    prompt: question.prompt,
    options: question.options,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    tags: question.tags,
    verifiedYear: question.verifiedYear,
  });
}

export function fileNameFor(fileIndex: number): string {
  const pad = (value: number): string => String(value).padStart(5, '0');
  const start = fileIndex * QUESTIONS_PER_FILE + 1;
  return `questions-${pad(start)}-${pad(start + QUESTIONS_PER_FILE - 1)}.jsonl`;
}

/** Builds the whole bank in index order (pure compute, no I/O). */
export function buildBank(): WorldQuestion[] {
  const state = newLadderState(DISCIPLINE_IDS.length);
  const ctx = newBuildContext();
  const questions: WorldQuestion[] = [];
  for (let index = 0; index < TOTAL; index += 1) {
    if (index === FLAGSHIP_INDEX) {
      questions.push(flagshipQuestion());
      continue;
    }
    questions.push(composeQuestion(planForIndex(index, DISCIPLINE_IDS, state), ctx));
  }
  return questions;
}

/** packages/backend/questions/world-v1 (works from src/ and from dist/). */
export function defaultOutDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'questions', SCHEMA_VERSION);
}

export interface GenerateResult {
  readonly outDir: string;
  readonly total: number;
  readonly files: readonly GeneratedFile[];
}

export function writeBank(outDir: string, questions: readonly WorldQuestion[]): GenerateResult {
  mkdirSync(outDir, { recursive: true });
  const files: GeneratedFile[] = [];
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const slice = questions.slice(fileIndex * QUESTIONS_PER_FILE, (fileIndex + 1) * QUESTIONS_PER_FILE);
    if (slice.length !== QUESTIONS_PER_FILE) {
      throw new Error(`WORLDBANK_SHORT_FILE:${fileIndex}:${slice.length}`);
    }
    const body = `${slice.map(serializeQuestion).join('\n')}\n`;
    const name = fileNameFor(fileIndex);
    writeFileSync(path.join(outDir, name), body, { encoding: 'utf8' });
    files.push({
      name,
      count: slice.length,
      bytes: Buffer.byteLength(body, 'utf8'),
      firstId: slice[0]!.id,
      lastId: slice[slice.length - 1]!.id,
    });
  }
  return { outDir, total: questions.length, files };
}

export function parseArgs(argv: readonly string[]): { outDir: string } {
  let outDir = defaultOutDir();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) outDir = path.resolve(argv[i + 1]!);
  }
  return { outDir };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

function main(): void {
  const started = Date.now();
  const { outDir } = parseArgs(process.argv.slice(2));
  const questions = buildBank();
  const result = writeBank(outDir, questions);
  console.log(`world-v1: wrote ${result.total} questions to ${outDir}`);
  for (const file of result.files) {
    console.log(`  ${file.name}  ${file.count} items  ${file.bytes} bytes  ${file.firstId}..${file.lastId}`);
  }
  console.log(`generate finished in ${Date.now() - started} ms`);
}

if (isMainModule()) main();
