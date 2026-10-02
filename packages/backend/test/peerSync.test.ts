import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { QuizChain } from '../src/chain/quiz-chain.js';
import { ChainStore } from '../src/chain/store.js';
import { startChainNode } from '../src/chain/node.js';
import { PeerSyncEngine, totalWorkOf, validateCandidateBlocks } from '../src/chain/peer-sync.js';
import { sha256Hex } from '../src/chain/hash.js';
import { defaultQuestionFactory } from '../src/chain/question-factory.js';
import type { QuestionFactory } from '../src/chain/question-factory.js';
import type { QuizBlock, QuizQuestion } from '../src/chain/types.js';

/**
 * Attacker factory: re-minable bank-lookalike questions with a doctored
 * prompt AND an attacker-chosen key (self-consistent public content hash).
 */
class CustomFactory {
  toPublic(question: QuizQuestion) {
    return defaultQuestionFactory.toPublic(question);
  }

  forHeight(height: number): QuizQuestion {
    const base = defaultQuestionFactory.forHeight(height, false, []);
    const forgedPrompt = { th: `${base.prompt.th} (ปลอม)`, en: `${base.prompt.en} (forged)` };
    const contentHash = sha256Hex(
      JSON.stringify([base.id, base.slot, base.discipline, base.difficulty, forgedPrompt.th, forgedPrompt.en, base.options, 'hard-merge', height]),
    );
    return { ...base, prompt: forgedPrompt, answerIndex: (base.answerIndex + 1) % 4, alternatives: [2], contentHash };
  }
}

/** Keeps the bank question byte-for-byte but swaps the graded key. */
class KeySwapFactory {
  toPublic(question: QuizQuestion) {
    return defaultQuestionFactory.toPublic(question);
  }

  forHeight(height: number): QuizQuestion {
    const base = defaultQuestionFactory.forHeight(height, false, []);
    return { ...base, answerIndex: (base.answerIndex + 1) % 4, alternatives: [2] };
  }
}

function mineNBlocks(chain: QuizChain, count: number, baseHeight = 0): void {
  for (let i = 0; i < count; i += 1) {
    const height = baseHeight + i + 1;
    chain.startNextBlock('test-miner');
    chain.submitAnswer({ blockHeight: height, miner: 'test-miner', choice: chain.openQuestion!.answerIndex });
    chain.sealCurrentBlock();
  }
}

describe('validateCandidateBlocks (verifyChain rules on a foreign array)', () => {
  it('accepts a valid mined chain', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 3);
    expect(validateCandidateBlocks(chain.blocks, 6)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a tampered nonce (self-hash breaks)', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 2);
    const tampered: QuizBlock = { ...chain.blocks[1]!, nonce: chain.blocks[1]!.nonce + 1 };
    expect(validateCandidateBlocks([chain.blocks[0]!, tampered], 6).valid).toBe(false);
  });

  it('rejects insufficient PoW for the height', () => {
    // Mine an easy (6-bit) block, then judge it under harder (20-bit) rules.
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 1);
    const verdict = validateCandidateBlocks(chain.blocks, 20);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('POW_INSUFFICIENT'))).toBe(true);
  });

  it('rejects a broken parent link', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 2);
    const orphan = { ...chain.blocks[1]!, parentHash: `0x${'ff'.repeat(32)}` };
    const verdict = validateCandidateBlocks([chain.blocks[0]!, orphan], 6);
    expect(verdict.errors.some((e) => e.startsWith('PARENT_HASH_MISMATCH'))).toBe(true);
  });

  it('accepts a genuine chain under question-integrity rules (factory given)', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 2);
    expect(validateCandidateBlocks(chain.blocks, 6, defaultQuestionFactory)).toEqual({ valid: true, errors: [] });
  });

  it('rejects foreign questions that do not hash to the bank content hash', () => {
    const forged = new QuizChain({ baseDifficultyBits: 6, questionFactory: new CustomFactory() as unknown as QuestionFactory });
    mineNBlocks(forged, 1);
    const verdict = validateCandidateBlocks(forged.blocks, 6, defaultQuestionFactory);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('QUESTION_CONTENT_MISMATCH@'))).toBe(true);
    expect(verdict.errors.some((e) => e.startsWith('ANSWER_COMMITMENT_MISMATCH@'))).toBe(true);
  });

  it('rejects a genuine-looking question whose answer key was swapped (commitment only)', () => {
    const swapped = new QuizChain({ baseDifficultyBits: 6, questionFactory: new KeySwapFactory() as unknown as QuestionFactory });
    mineNBlocks(swapped, 1);
    const verdict = validateCandidateBlocks(swapped.blocks, 6, defaultQuestionFactory);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.startsWith('ANSWER_COMMITMENT_MISMATCH@'))).toBe(true);
    expect(verdict.errors.some((e) => e.startsWith('QUESTION_CONTENT_MISMATCH@'))).toBe(false);
  });

  it('rejects a bank question whose commitment does not bind its key', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 1);
    const lying = chain.blocks.map((b) => ({ ...b, answerCommitment: `0x${'cd'.repeat(32)}` }));
    const verdict = validateCandidateBlocks(lying, 6, defaultQuestionFactory);
    expect(verdict.errors.some((e) => e.startsWith('ANSWER_COMMITMENT_MISMATCH@'))).toBe(true);
  });

  it('skips question-integrity rules when no factory is provided (legacy callers)', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6, questionFactory: new CustomFactory() as unknown as QuestionFactory });
    mineNBlocks(chain, 1);
    expect(validateCandidateBlocks(chain.blocks, 6).valid).toBe(true);
  });
});

describe('totalWorkOf (fork-choice vote weight)', () => {
  it('sums attempts across blocks (matches the chain snapshot)', () => {
    const chain = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(chain, 3);
    expect(totalWorkOf(chain.blocks).toString()).toBe(chain.snapshot().totalCumulativeWork);
  });
});

describe('PeerSyncEngine (fake transport)', () => {
  function engineOver(peers: string[], routes: Array<[string, [number, unknown]]>, questionFactory?: QuestionFactory): PeerSyncEngine {
    const routeMap = new Map(routes);
    const prefixes = [...routeMap.keys()].sort((a, b) => b.length - a.length);
    const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const key = String(input);
      const hit = prefixes.find((prefix) => key.startsWith(prefix));
      if (hit === undefined) throw new TypeError('connection refused');
      const [status, payload] = routeMap.get(hit)!;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      } as unknown as Response;
    });
    return new PeerSyncEngine({ baseDifficultyBits: 6, questionFactory, peerUrls: peers, fetchFn: fetchFn as unknown as typeof fetch, log: () => {} });
  }

  it('keeps own chain when the peer is not ahead', async () => {
    const engine = engineOver(['http://peer-a'], [
      ['http://peer-a', [200, { height: 2, totalCumulativeWork: '50' }]],
    ]);
    const adopt = vi.fn();
    const decisions = await engine.syncRound({ ownHeight: 3, ownWork: '10', adopt });
    expect(decisions[0]!.outcome).toBe('kept-own');
    expect(adopt).not.toHaveBeenCalled();
  });

  it('rejects an invalid heavy chain (verifyChain as the gate)', async () => {
    const good = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(good, 2);
    const tampered = { ...good.blocks[0]!, nonce: 99_999 };
    const engine = engineOver(['http://peer-b'], [
      ['http://peer-b/api/peer/blocks', [200, { blocks: [tampered], total: 1 }]],
      ['http://peer-b', [200, { height: 5, totalCumulativeWork: '999999' }]],
    ]);
    const adopt = vi.fn();
    const decisions = await engine.syncRound({ ownHeight: 1, ownWork: '5', adopt });
    expect(decisions[0]!.outcome).toBe('rejected');
    expect(adopt).not.toHaveBeenCalled();
  });

  it('keeps own chain when the valid peer chain has less cumulative work', async () => {
    const light = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(light, 2);
    const engine = engineOver(['http://peer-c'], [
      ['http://peer-c/api/peer/blocks', [200, { blocks: light.blocks, total: 2 }]],
      ['http://peer-c', [200, { height: 2, totalCumulativeWork: '999' }]],
    ]);
    const adopt = vi.fn();
    const decisions = await engine.syncRound({ ownHeight: 1, ownWork: '90000', adopt });
    expect(decisions[0]!.outcome).toBe('kept-own');
    expect(decisions[0]!.reason).toBe('less-work');
    expect(adopt).not.toHaveBeenCalled();
  });

  it('reports unreachable peers without throwing', async () => {
    const engine = engineOver(['http://peer-down'], []);
    const decisions = await engine.syncRound({ ownHeight: 0, ownWork: '0', adopt: () => {} });
    expect(decisions[0]!.outcome).toBe('unreachable');
  });

  it('rejects a heavy forged chain whose questions carry attacker-chosen answers', async () => {
    const forged = new QuizChain({ baseDifficultyBits: 6, questionFactory: new CustomFactory() as unknown as QuestionFactory });
    mineNBlocks(forged, 2);
    const engine = engineOver(
      ['http://peer-forged'],
      [
        ['http://peer-forged/api/peer/blocks', [200, { blocks: forged.blocks, total: 2 }]],
        ['http://peer-forged', [200, { height: 2, totalCumulativeWork: '999999' }]],
      ],
      defaultQuestionFactory,
    );
    const adopt = vi.fn();
    const decisions = await engine.syncRound({ ownHeight: 1, ownWork: '5', adopt });
    expect(decisions[0]!.outcome).toBe('rejected');
    expect(adopt).not.toHaveBeenCalled();
  });

  it('accepts a genuine heavier chain under question-integrity rules', async () => {
    const good = new QuizChain({ baseDifficultyBits: 6 });
    mineNBlocks(good, 2);
    const engine = engineOver(
      ['http://peer-good'],
      [
        ['http://peer-good/api/peer/blocks', [200, { blocks: good.blocks, total: 2 }]],
        ['http://peer-good', [200, { height: 2, totalCumulativeWork: '999999' }]],
      ],
      defaultQuestionFactory,
    );
    const adopt = vi.fn();
    const decisions = await engine.syncRound({ ownHeight: 1, ownWork: '5', adopt });
    expect(decisions[0]!.outcome).toBe('accepted');
    expect(adopt).toHaveBeenCalledTimes(1);
  });
});

describe('two-node reorg (real HTTP nodes)', () => {
  it('node B adopts the heavier valid chain of node A and durably rewrites its log', async () => {
    const dirA = await mkdtemp(path.join(tmpdir(), 'peer-a-'));
    const dirB = await mkdtemp(path.join(tmpdir(), 'peer-b-'));
    try {
      // Node A mines 3 sealed blocks with the SAME powBits peers judge with.
      const sessionA = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(sessionA, 3);
      const storeA = new ChainStore(dirA);
      await storeA.open();
      for (const block of sessionA.blocks) await storeA.appendBlock(block);
      await storeA.close();

      const nodeA = await startChainNode({
        dataDir: dirA, port: 0, adminPassword: 'x', powBits: 6, intervalMs: 60_000, jitterMs: 0,
      });
      const nodeB = await startChainNode({
        dataDir: dirB, port: 0, adminPassword: 'x', powBits: 6, intervalMs: 60_000, jitterMs: 0,
        peerUrls: [`http://127.0.0.1:${nodeA.port}`],
      });
      try {
        expect(nodeB.peerSync.peerUrls).toEqual([`http://127.0.0.1:${nodeA.port}`]);
        await nodeB.runPeerSyncRound();

        const storeB = new ChainStore(dirB);
        const adopted = await storeB.loadBlocks();
        await storeB.close();
        expect(adopted.map((b) => b.hash)).toEqual(sessionA.blocks.map((b) => b.hash));

        // The reorged-in chain must still verify locally.
        const revived = new QuizChain({ baseDifficultyBits: 6 });
        revived.restoreFromBlocks(adopted);
        expect(revived.verifyChain()).toEqual({ valid: true, errors: [] });
      } finally {
        await nodeA.close();
        await nodeB.close();
      }
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it('does not adopt a peer whose chain is shorter', async () => {
    const dirA = await mkdtemp(path.join(tmpdir(), 'peer-short-'));
    const dirB = await mkdtemp(path.join(tmpdir(), 'peer-own-'));
    try {
      // Own node already has 2 blocks.
      const own = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(own, 2);
      const storeB = new ChainStore(dirB);
      await storeB.open();
      for (const block of own.blocks) await storeB.appendBlock(block);
      await storeB.close();

      const nodeA = await startChainNode({ dataDir: dirA, port: 0, adminPassword: 'x', powBits: 6, intervalMs: 60_000, jitterMs: 0 });
      const nodeB = await startChainNode({
        dataDir: dirB, port: 0, adminPassword: 'x', powBits: 6, intervalMs: 60_000, jitterMs: 0,
        peerUrls: [`http://127.0.0.1:${nodeA.port}`],
      });
      try {
        await nodeB.runPeerSyncRound();
        const store = new ChainStore(dirB);
        const kept = await store.loadBlocks();
        await store.close();
        expect(kept.map((b) => b.hash)).toEqual(own.blocks.map((b) => b.hash));
      } finally {
        await nodeA.close();
        await nodeB.close();
      }
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});
