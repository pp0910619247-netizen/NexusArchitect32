import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChainStore } from '../src/chain/store.js';
import { QuizChain } from '../src/chain/quiz-chain.js';
import { startChainNode } from '../src/chain/node.js';
import { isMilestoneHeight } from '../src/chain/block.js';
import { sha256Hex } from '../src/chain/hash.js';

function mineNBlocks(chain: QuizChain, count: number, baseHeight = 0): void {
  for (let i = 0; i < count; i += 1) {
    const height = baseHeight + i + 1;
    chain.startNextBlock('test-miner');
    chain.submitAnswer({ blockHeight: height, miner: 'test-miner', choice: chain.openQuestion!.answerIndex });
    chain.sealCurrentBlock();
  }
}

describe('ChainStore', () => {
  it('appends blocks and loads them back hash-identical', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainstore-'));
    try {
      const chain = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(chain, 3);
      const store = new ChainStore(dir);
      await store.open();
      for (const block of chain.blocks) await store.appendBlock(block);
      const loaded = await store.loadBlocks();
      expect(loaded).toHaveLength(3);
      expect(loaded.map((b) => b.hash)).toEqual(chain.blocks.map((b) => b.hash));
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('drops a torn trailing line (partial append) on load', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chaintorn-'));
    try {
      const chain = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(chain, 2);
      const store = new ChainStore(dir);
      await store.open();
      await store.appendBlock(chain.blocks[0]!);
      await store.appendBlock(chain.blocks[1]!);
      await store.close();
      // Simulate a crash mid-append: cut the file inside the second line.
      const logPath = path.join(dir, 'blocks.jsonl');
      const raw = await readFile(logPath, 'utf8');
      const secondLineStart = raw.indexOf('\n') + 1;
      await truncate(logPath, secondLineStart + 40);
      const loaded = await store.loadBlocks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.hash).toBe(chain.blocks[0]!.hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('truncates at a block whose payload no longer matches its hash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chaincorrupt-'));
    try {
      const chain = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(chain, 3);
      const store = new ChainStore(dir);
      await store.open();
      for (const block of chain.blocks) await store.appendBlock(block);
      await store.close();
      // Tamper with block 2's nonce so its hash no longer matches.
      const logPath = path.join(dir, 'blocks.jsonl');
      const lines = (await readFile(logPath, 'utf8')).split('\n').filter((l) => l !== '');
      const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
      tampered.nonce = (tampered.nonce as number) + 1;
      lines[1] = JSON.stringify(tampered);
      await writeFile(logPath, lines.join('\n') + '\n', 'utf8');
      const loaded = await store.loadBlocks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.height).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('survives a missing file and an empty file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainempty-'));
    try {
      const store = new ChainStore(dir);
      await store.open();
      expect(await store.loadBlocks()).toEqual([]);
      const logPath = path.join(dir, 'blocks.jsonl');
      await writeFile(logPath, '', 'utf8');
      expect(await store.loadBlocks()).toEqual([]);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('QuizChain.restoreFromBlocks', () => {
  it('restores answers, actions, cumulative work and milestone cursor', () => {
    const chain = new QuizChain({ baseDifficultyBits: 4 });
    chain.queueAdminAction({
      id: 'ACT-1', kind: 'EDIT_ANSWER', questionId: 'q-000001', oldAnswer: null,
      newAnswer: { answerIndex: 0, alternatives: [1] }, newQuestion: null, by: 'admin', at: 0, actionHash: sha256Hex('a'),
    });
    mineNBlocks(chain, 5);
    const { blocks } = chain.snapshot();

    const revived = new QuizChain({ baseDifficultyBits: 4 });
    revived.restoreFromBlocks(blocks);
    expect(revived.height).toBe(5);
    expect(revived.answers.map((a) => a.commitmentHash)).toEqual(chain.answers.map((a) => a.commitmentHash));
    expect(revived.adminActions).toEqual(chain.adminActions);
    expect(revived.lastMilestoneHeight).toBe(chain.lastMilestoneHeight);
    expect(revived.snapshot().totalCumulativeWork).toBe(chain.snapshot().totalCumulativeWork);
    expect(revived.verifyChain().valid).toBe(true);
  });

  it('counts milestones correctly from loaded history', () => {
    const chain = new QuizChain({ baseDifficultyBits: 4 });
    mineNBlocks(chain, 1_000);
    expect(chain.lastMilestoneHeight).toBe(1_000);
    expect(chain.blocks.filter((b) => b.milestone !== null).map((b) => b.height)).toEqual([1_000]);

    const revived = new QuizChain({ baseDifficultyBits: 4 });
    revived.restoreFromBlocks(chain.blocks);
    expect(revived.lastMilestoneHeight).toBe(1_000);
    // The next 1,000 produce exactly one more milestone.
    mineNBlocks(revived, 1_000, 1_000);
    expect(revived.lastMilestoneHeight).toBe(2_000);
    expect(revived.blocks.filter((b) => isMilestoneHeight(b.height) && b.height !== 1).map((b) => b.height)).toEqual([1_000, 2_000]);
    expect(revived.verifyChain().valid).toBe(true);
  });

  it('refuses to restore over a non-empty chain', () => {
    const chain = new QuizChain({ baseDifficultyBits: 4 });
    mineNBlocks(chain, 1);
    const revived = new QuizChain({ baseDifficultyBits: 4 });
    revived.restoreFromBlocks(chain.blocks.slice(0, 1));
    expect(() => revived.restoreFromBlocks(chain.blocks.slice(0, 1))).toThrow('RESTORE_ONLY_ON_EMPTY_CHAIN');
  });
});

describe('node restart (real entry point)', () => {
  it('keeps height, hashes, questions, admin actions and verification intact, then extends', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainnode-'));
    // ---- Session 1: mine 3 blocks (one carrying an admin action) --------
    const session1 = new QuizChain({ baseDifficultyBits: 6 });
    session1.startNextBlock('s1');
    session1.submitAnswer({ blockHeight: 1, miner: 'm', choice: session1.openQuestion!.answerIndex });
    session1.sealCurrentBlock();
    session1.startNextBlock('s1');
    session1.queueAdminAction({
      id: 'ACT-N1', kind: 'EDIT_ANSWER', questionId: session1.openQuestion!.id, oldAnswer: null,
      newAnswer: { answerIndex: 0, alternatives: [1, 2] }, newQuestion: null, by: 'admin', at: 0, actionHash: sha256Hex('n1'),
    });
    session1.sealCurrentBlock();
    session1.startNextBlock('s1');
    session1.sealCurrentBlock();
    const store1 = new ChainStore(dir);
    await store1.open();
    for (const block of session1.blocks) await store1.appendBlock(block);
    await store1.close();
    const expectedHashes = session1.blocks.map((b) => b.hash);

    // ---- Session 2: boot the node over the same dir ---------------------
    const node = await startChainNode({
      dataDir: dir,
      port: 0, // ephemeral port; the node reports the bound one
      adminPassword: 'x-test-pass',
      powBits: 6, // must match session 1 so the boot-time PoW check passes
      intervalMs: 60_000, // scheduler armed but first seal is a minute away
      jitterMs: 0,
    });
    try {
      const store2 = new ChainStore(dir);
      const restored = await store2.loadBlocks();
      await store2.close();
      // Session 2 appended nothing yet (60 s window); disk = session 1's 3.
      expect(restored).toHaveLength(3);
      expect(restored.map((b) => b.hash)).toEqual(expectedHashes);
      // Embedded admin action survived the restart via the chain itself.
      expect(restored[1]!.adminActions).toHaveLength(1);
      expect(restored[1]!.adminActions[0]!.id).toBe('ACT-N1');
      // Embedded question payloads survived byte-for-byte.
      expect(restored.map((b) => b.question.contentHash)).toEqual(session1.blocks.map((b) => b.question.contentHash));
      // The restored chain verifies (node threw at boot otherwise).
      const revived = new QuizChain({ baseDifficultyBits: 6 });
      revived.restoreFromBlocks(restored);
      expect(revived.verifyChain()).toEqual({ valid: true, errors: [] });

      // ---- Extend over HTTP: login, answer, seal & advance --------------
      const base = `http://127.0.0.1:${node.port}`;
      const login = await fetch(`${base}/api/admin/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'x-test-pass' }),
      });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };
      const current = await (await fetch(`${base}/api/question/current`)).json() as { blockHeight: number; question: { id: string } };
      expect(current.blockHeight).toBe(4); // successor of the restored tip
      const submit = await fetch(`${base}/api/answer`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockHeight: current.blockHeight, miner: 'm2', choice: 0 }),
      });
      expect(submit.status).toBe(200);
      const mine = await fetch(`${base}/api/admin/mine`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(mine.status).toBe(200);
      const verify = await (await fetch(`${base}/api/verify`)).json() as { valid: boolean; height: number };
      expect(verify.valid).toBe(true);
      expect(verify.height).toBe(4);
    } finally {
      await node.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed at boot when the on-disk chain cannot be verified', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainbadboot-'));
    try {
      // Mine with 6 bits, then boot claiming 14 bits → PoW check must fail.
      const session = new QuizChain({ baseDifficultyBits: 6 });
      mineNBlocks(session, 1);
      const store = new ChainStore(dir);
      await store.open();
      for (const block of session.blocks) await store.appendBlock(block);
      await store.close();
      await expect(startChainNode({ dataDir: dir, port: 0, adminPassword: 'x', powBits: 14, intervalMs: 60_000, jitterMs: 0 }))
        .rejects.toThrow('CHAIN_VERIFY_FAILED_AT_BOOT');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
