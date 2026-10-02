// SPDX-License-Identifier: MIT
/**
 * world2:generate — writes the world-v2 bank (10 JSONL files × 1,000 items)
 * next to world-v1, plus a manifest carrying a SHA-256 per file.
 *
 * Deterministic by construction: the ladder, the numeric engine, the derived
 * table and the composer are pure functions of the item index, so re-running
 * this CLI produces byte-identical files.
 *
 * Usage:
 *   pnpm --filter @nexus/backend world2:generate
 *   node dist/worldbank/v2/generate.js --out <dir>
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeQuestion2 } from './compose.js';
import { newLadder2State } from './ladder.js';
import { FILE_COUNT, QUESTIONS_PER_FILE, SCHEMA_VERSION, TOTAL, type WorldQuestionV2 } from './schema.js';
import { SUBJECT_IDS } from './subjects.js';

export interface GeneratedFileV2 {
  readonly name: string;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly firstId: string;
  readonly lastId: string;
}

export interface ManifestV2 {
  readonly schema: string;
  readonly total: number;
  readonly questionsPerFile: number;
  readonly subjects: readonly string[];
  readonly tiers: readonly { readonly tier: number; readonly subjectCounts: readonly number[]; readonly items: number }[];
  readonly files: readonly GeneratedFileV2[];
  readonly answerCapPerFile: number;
}

/** Exact field order of a world-v2 line (no extra fields). */
export function serializeQuestion2(question: WorldQuestionV2): string {
  return JSON.stringify({
    id: question.id,
    subjects: question.subjects,
    primarySubject: question.primarySubject,
    subjectCount: question.subjectCount,
    tier: question.tier,
    difficulty: question.difficulty,
    prompt: question.prompt,
    options: question.options,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    clauses: question.clauses,
    tags: question.tags,
    verifiedYear: question.verifiedYear,
  });
}

export function fileNameFor2(fileIndex: number): string {
  const pad = (value: number): string => String(value).padStart(5, '0');
  const start = fileIndex * QUESTIONS_PER_FILE + 1;
  return `questions-${pad(start)}-${pad(start + QUESTIONS_PER_FILE - 1)}.jsonl`;
}

/** Builds every item in index order (pure compute, no I/O). */
export function buildBank2(): WorldQuestionV2[] {
  const state = newLadder2State(SUBJECT_IDS.length);
  const questions: WorldQuestionV2[] = [];
  for (let index = 0; index < TOTAL; index += 1) questions.push(composeQuestion2(index, state));
  return questions;
}

/** packages/backend/questions/world-v2 (works from src/ and from dist/). */
export function defaultOutDir2(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', 'questions', SCHEMA_VERSION);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function writeBank2(outDir: string, questions: readonly WorldQuestionV2[]): ManifestV2 {
  mkdirSync(outDir, { recursive: true });
  const files: GeneratedFileV2[] = [];
  for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
    const slice = questions.slice(fileIndex * QUESTIONS_PER_FILE, (fileIndex + 1) * QUESTIONS_PER_FILE);
    if (slice.length !== QUESTIONS_PER_FILE) throw new Error(`WORLD2_SHORT_FILE:${fileIndex}:${slice.length}`);
    const body = `${slice.map(serializeQuestion2).join('\n')}\n`;
    const name = fileNameFor2(fileIndex);
    writeFileSync(path.join(outDir, name), body, { encoding: 'utf8' });
    files.push({
      name,
      count: slice.length,
      bytes: Buffer.byteLength(body, 'utf8'),
      sha256: sha256(body),
      firstId: slice[0]!.id,
      lastId: slice[slice.length - 1]!.id,
    });
  }
  const tiers = [1, 2, 3, 4].map((tier) => ({
    tier,
    subjectCounts: [...new Set(questions.filter((item) => item.tier === tier).map((item) => item.subjectCount))].sort((a, b) => a - b),
    items: questions.filter((item) => item.tier === tier).length,
  }));
  const manifest: ManifestV2 = {
    schema: SCHEMA_VERSION,
    total: questions.length,
    questionsPerFile: QUESTIONS_PER_FILE,
    subjects: [...SUBJECT_IDS],
    tiers,
    files,
    answerCapPerFile: 0.4,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export function parseArgs2(argv: readonly string[]): { outDir: string } {
  let outDir = defaultOutDir2();
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
  const { outDir } = parseArgs2(process.argv.slice(2));
  const questions = buildBank2();
  const manifest = writeBank2(outDir, questions);
  console.log(`world-v2: wrote ${manifest.total} questions to ${outDir}`);
  for (const file of manifest.files) {
    console.log(`  ${file.name}  ${file.count} items  ${file.bytes} bytes  sha256 ${file.sha256.slice(0, 12)}…`);
  }
  console.log(`generate finished in ${Date.now() - started} ms`);
}

if (isMainModule()) main();
