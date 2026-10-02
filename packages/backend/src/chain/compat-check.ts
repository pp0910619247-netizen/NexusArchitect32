#!/usr/bin/env node
/**
 * Cross-discipline bank v2 compatibility proof (read-only against the
 * node's chain data):
 *   1) loads the LIVE chain from disk and runs verifyChain — proves slots
 *      0–407 reproduce byte-identically under the v2 bank code;
 *   2) mines ONE extra block on top (block 409 = slot 408) to prove the new
 *      cross-discipline questions mine and seal cleanly;
 *   3) prints a preview of upcoming cross questions (2→3→4 subjects).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuizChain } from './quiz-chain.js';
import { buildQuestion, disciplineIdsForSlot, combinedCountForSlot, CROSS_FROM_SLOT } from './quiz-bank.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CHAIN_DATA_DIR?.trim() || resolve(here, '../../../../.chain-data');
const blocksPath = resolve(dataDir, 'blocks.jsonl');
if (!existsSync(blocksPath)) {
  console.error(`[compat] no chain found at ${blocksPath}`);
  process.exit(1);
}

const diskBlocks = readFileSync(blocksPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line) as never);

console.log(`[compat] loaded ${diskBlocks.length} block(s) from disk`);
const chain = new QuizChain({ baseDifficultyBits: 12 });
chain.restoreFromBlocks(diskBlocks);
const verdict = chain.verifyChain();
if (!verdict.valid) {
  console.error(`[compat] VERIFY FAILED: ${verdict.errors.slice(0, 5).join(', ')}`);
  process.exit(1);
}
console.log(`[compat] verifyChain OK for all ${diskBlocks.length} block(s) — bank v2 is backward-compatible with the live chain`);

// Preview of the new cross-discipline questions.
console.log('\n[compat] — upcoming cross-discipline questions —');
for (const slot of [CROSS_FROM_SLOT, 999, 1_000, 1_999, 2_000, 9_999]) {
  if (slot >= 100_000) continue;
  const q = buildQuestion(slot);
  const ids = disciplineIdsForSlot(slot);
  const count = combinedCountForSlot(slot);
  console.log(`  slot ${String(slot).padStart(6)} · ${count} วิชา [${ids.join(' + ')}] · ระดับ ${q.difficulty}/10`);
  console.log(`     TH: ${q.prompt.th}`);
  console.log(`     EN: ${q.prompt.en}`);
}

// Mine one block on top of the restored chain (block 409 = slot 408) — in
// memory only; the live node is untouched.
const height = diskBlocks.length + 1;
chain.startNextBlock('compat-check');
chain.submitAnswer({ blockHeight: height, miner: 'compat-check', choice: buildQuestion(height - 1).answerIndex });
const sealed = chain.sealCurrentBlock();
console.log(`\n[compat] sealed block #${sealed.height} in memory — question ${sealed.question.id}, discipline ${sealed.question.discipline}`);
console.log(`[compat] prompt: ${sealed.question.prompt.th}`);
console.log('[compat] NEW-BANK MINING OK — restart the node to continue on v2 questions');
