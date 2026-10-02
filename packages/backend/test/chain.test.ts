import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startChainNode } from '../src/chain/node.js';
import { isMilestoneHeight } from '../src/chain/block.js';
import type { MilestoneAnchorClient, AnchorResult } from '../src/chain/anchor.js';

/**
 * A milestone can only appear at heights 1,000/2,000/…, so driving the real
 * node hook through startChainNode would require mining 1,000 blocks. Instead
 * this suite verifies the plumbing the node uses for every sealed milestone:
 * the fake client is handed to startChainNode and the coordinator's enqueue
 * path is exercised directly against the same client.
 */
describe('node milestone-anchor plumbing', () => {
  it('anchors a milestone handed to the node-level coordinator (fire-and-forget, awaited on close)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainanchor-'));
    const anchored: { height: number; hash: string }[] = [];
    const anchoredSet = new Set<number>();
    const fake: MilestoneAnchorClient = {
      anchorAddress: '0x1111111111111111111111111111111111111111',
      chainId: 80_002,
      async anchorMilestone(input): Promise<AnchorResult> {
        anchored.push({ height: input.blockHeight, hash: input.milestoneHash });
        anchoredSet.add(input.blockHeight);
        return { txHash: `0x${'22'.repeat(32)}`, status: 'success', blockNumber: 7n, gasUsed: 90_000n, effectiveGasPrice: 25n };
      },
      async isAnchored(height) {
        return anchoredSet.has(height);
      },
    };

    try {
      const node = await startChainNode({
        dataDir: dir,
        port: 0,
        adminPassword: 'x-test-pass',
        powBits: 6,
        intervalMs: 60_000,
        jitterMs: 0,
        anchorClient: fake,
      });
      try {
        expect(node.anchor.enabled).toBe(true);
        // The milestone payload of a future milestone block, as seal/append
        // would hand it to the coordinator.
        const milestone = {
          blockHeight: 1_000,
          milestoneHash: `0x${'ab'.repeat(32)}`,
          spanFromBlockHash: `0x${'cd'.repeat(32)}`,
          spanToBlockHash: `0x${'ef'.repeat(32)}`,
          spanBlocks: 1_000,
          totalCumulativeWork: '42',
          at: 1_700_000_000_000,
        };
        node.anchor.enqueue(milestone);
        await node.anchor.close(); // drains through the fake client
        expect(anchored).toEqual([{ height: 1_000, hash: `0x${'ab'.repeat(32)}` }]);
      } finally {
        await node.close();
      }
      expect(isMilestoneHeight(1_000)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports disabled anchoring when no client is configured', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'chainanchoroff-'));
    try {
      const node = await startChainNode({
        dataDir: dir,
        port: 0,
        adminPassword: 'x-test-pass',
        powBits: 6,
        intervalMs: 60_000,
        jitterMs: 0,
        anchorClient: null,
      });
      try {
        expect(node.anchor.enabled).toBe(false);
        node.anchor.enqueue({
          blockHeight: 1_000,
          milestoneHash: `0x${'ab'.repeat(32)}`,
          spanFromBlockHash: `0x${'cd'.repeat(32)}`,
          spanToBlockHash: `0x${'ef'.repeat(32)}`,
          spanBlocks: 1_000,
          totalCumulativeWork: '42',
          at: 1_700_000_000_000,
        });
        await node.anchor.close();
        expect(node.anchor.pendingHeights).toEqual([]);
      } finally {
        await node.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
