#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Generates `data/quiz-set-1.json` — the PUBLIC half of the on-chain quiz set:
 * the item text, the sha256 of the bank manifest (bankRoot) and the sha256 of
 * the exact JSONL line the item came from (sourceHash).
 *
 * It deliberately CANNOT emit the answer index or the salt: those come from the
 * environment (QUIZ_ANSWER_INDEX / QUIZ_ANSWER_SALT) at deploy time and must never
 * be written to a file that Git tracks.
 *
 * Usage (from packages/contracts):
 *   node data/make-quiz-set.mjs
 *   node data/make-quiz-set.mjs --line 1 --out data/quiz-set-1.json
 *
 * The bank is gitignored and deterministic: rebuild it with
 *   pnpm --filter @nexus/backend world2:generate
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const bankDir = path.resolve(repoRoot, 'packages/backend/questions/world-v2');
const manifestPath = path.join(bankDir, 'manifest.json');
const bankFile = 'questions-00001-01000.jsonl';
const lineNumber = Number(arg('line', '1'));
const outPath = path.resolve(here, path.basename(arg('out', 'quiz-set-1.json')));

if (!existsSync(manifestPath)) {
  console.error(`missing ${manifestPath} — run: pnpm --filter @nexus/backend world2:generate`);
  process.exit(1);
}

const sha256 = (buffer) => `0x${createHash('sha256').update(buffer).digest('hex')}`;
const bankRoot = sha256(readFileSync(manifestPath));
const lines = readFileSync(path.join(bankDir, bankFile), 'utf8').split('\n');
const rawLine = lines[lineNumber - 1];
if (!rawLine) {
  console.error(`line ${lineNumber} not found in ${bankFile}`);
  process.exit(1);
}

const question = JSON.parse(rawLine);
const set = {
  setId: 1,
  schema: 'world-v2',
  questionCount: 10000,
  bankRoot,
  provenance: {
    manifest: 'packages/backend/questions/world-v2/manifest.json',
    bankFile: `packages/backend/questions/world-v2/${bankFile}`,
    line: lineNumber,
    sourceHashRule: 'sha256 of the JSONL line exactly as written, excluding the trailing newline',
  },
  item: {
    itemId: question.id,
    sourceHash: sha256(Buffer.from(rawLine, 'utf8')),
    prompt: { th: question.prompt.th, en: question.prompt.en },
    options: { th: question.options.th, en: question.options.en },
  },
  answerSource: {
    index: 'QUIZ_ANSWER_INDEX',
    salt: 'QUIZ_ANSWER_SALT',
    note: 'never committed: a 4-option answer space is brute-forceable without a secret 32-byte salt',
  },
};

writeFileSync(outPath, `${JSON.stringify(set, null, 2)}\n`, 'utf8');
console.log(`wrote ${outPath}`);
console.log(`  item      ${set.item.itemId} (line ${lineNumber})`);
console.log(`  bankRoot  ${bankRoot}`);
console.log(`  sourceHash ${set.item.sourceHash}`);
console.log('  answer    not written (env only)');
