#!/usr/bin/env node
/**
 * Bakes the local chain snapshot into the nex32scan build so free cloud
 * hosts (no filesystem access to .chain-data/) can still serve the explorer.
 *
 * Usage:
 *   node scripts/bake-explorer-snapshot.mjs [snapshotPath]
 *
 * snapshotPath defaults to $INDEXER_SNAPSHOT_PATH or ../../.chain-data/explorer-snapshot.json
 * The output is a JSON file under src/generated/ which next.config.mjs
 * inlines as BAKED_SNAPSHOT_JSON at build time.
 *
 * Cloud builds (Vercel) re-run this script WITHOUT .chain-data present:
 * in that case an existing generated file is KEPT (that is the point of
 * baking locally before `vercel deploy`), and only a truly fresh project
 * gets an empty placeholder.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argPath = process.argv[2];
const snapshotPath =
  argPath ?? process.env.INDEXER_SNAPSHOT_PATH ?? resolve(here, '../../../.chain-data/explorer-snapshot.json');
const outDir = resolve(here, '../src/generated');
const outPath = resolve(outDir, 'explorer-snapshot.json');

const EMPTY = { latestBlockHeight: 0, impactTreasuryWei: '0', blocks: {}, proposals: [], quizBlocks: [] };

let parsed;
try {
  parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (typeof parsed.latestBlockHeight !== 'number' || typeof parsed.impactTreasuryWei !== 'string') {
    throw new Error('missing legacy fields');
  }
} catch (error) {
  if (existsSync(outPath)) {
    console.warn(`[bake] snapshot not readable at ${snapshotPath} (${error.message}) — keeping the existing baked file.`);
    process.exit(0);
  }
  console.warn(`[bake] snapshot not found at ${snapshotPath} — baking an EMPTY placeholder.`);
  parsed = EMPTY;
}

const quizCount = Array.isArray(parsed.quizBlocks) ? parsed.quizBlocks.length : 0;
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(parsed), 'utf8');
console.log(`[bake] baked snapshot → src/generated/explorer-snapshot.json (latestBlockHeight=${parsed.latestBlockHeight}, quizBlocks=${quizCount})`);
