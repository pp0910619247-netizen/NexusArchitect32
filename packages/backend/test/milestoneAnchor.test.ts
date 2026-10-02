import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, http } from 'viem';
import { createMilestoneAnchor, AMOY_CHAIN_ID } from '../src/chain/anchor.js';
import { MilestoneAnchorCoordinator } from '../src/chain/milestone-anchor.js';
import type { AnchorResult, MilestoneAnchorClient } from '../src/chain/anchor.js';
import type { MilestoneHash } from '../src/chain/types.js';

const HEX32 = `0x${'ab'.repeat(32)}`;
const HEX32_B = `0x${'cd'.repeat(32)}`;
const HEX32_C = `0x${'ef'.repeat(32)}`;

function milestone(overrides: Partial<MilestoneHash> = {}): MilestoneHash {
  return {
    blockHeight: 1_000,
    milestoneHash: HEX32,
    spanFromBlockHash: HEX32_B,
    spanToBlockHash: HEX32_C,
    spanBlocks: 1_000,
    totalCumulativeWork: '123456',
    at: 1_700_000_000_000,
    ...overrides,
  };
}

/** Deterministic fake anchor for coordinator tests (no network). */
function fakeAnchor(overrides: Partial<MilestoneAnchorClient> = {}): MilestoneAnchorClient & {
  calls: { height: number; hash: string }[];
  failNext: (times: number) => void;
} {
  const calls: { height: number; hash: string }[] = [];
  const anchored = new Set<number>();
  let failures = 0;
  return {
    calls,
    failNext(times: number) {
      failures = times;
    },
    anchorAddress: '0x1111111111111111111111111111111111111111',
    chainId: AMOY_CHAIN_ID,
    async anchorMilestone(input) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('RPC_UNAVAILABLE');
      }
      calls.push({ height: input.blockHeight, hash: input.milestoneHash });
      anchored.add(input.blockHeight);
      const result: AnchorResult = {
        txHash: `0x${'11'.repeat(32)}`,
        status: 'success',
        blockNumber: 42n,
        gasUsed: 91_000n,
        effectiveGasPrice: 30n,
      };
      return result;
    },
    async isAnchored(height) {
      return anchored.has(height);
    },
    ...overrides,
  };
}

function silentLog(): (message: string) => void {
  return vi.fn();
}

describe('createMilestoneAnchor (env validation)', () => {
  it('rejects a missing/invalid contract address without touching the network', () => {
    expect(() => createMilestoneAnchor({ contractAddress: '', privateKey: `0x${'11'.repeat(32)}` }))
      .toThrow('ANCHOR_CONTRACT_ADDRESS_MISSING_OR_INVALID');
    expect(() => createMilestoneAnchor({ contractAddress: '0x1234', privateKey: `0x${'11'.repeat(32)}` }))
      .toThrow('ANCHOR_CONTRACT_ADDRESS_MISSING_OR_INVALID');
  });

  it('rejects a malformed private key', () => {
    expect(() => createMilestoneAnchor({
      contractAddress: '0x1111111111111111111111111111111111111111',
      privateKey: 'not-a-key',
    })).toThrow('ANCHOR_BAD_PRIVATE_KEY');
  });

  it('refuses mainnet RPC endpoints (testnet-only rule)', () => {
    expect(() => createMilestoneAnchor({
      contractAddress: '0x1111111111111111111111111111111111111111',
      privateKey: `0x${'11'.repeat(32)}`,
      rpcUrl: 'https://polygon-mainnet.infura.io/v3/x',
    })).toThrow('ANCHOR_MAINNET_RPC_FORBIDDEN');
  });

  it('builds clients on Polygon Amoy by default', () => {
    const client = createMilestoneAnchor({
      contractAddress: '0x1111111111111111111111111111111111111111',
      privateKey: `0x${'11'.repeat(32)}`,
    });
    expect(client.chainId).toBe(80_002);
  });
});

describe('MilestoneAnchorCoordinator', () => {
  it('does nothing when anchoring is disabled (no env)', async () => {
    const coordinator = new MilestoneAnchorCoordinator(null, { log: silentLog() });
    expect(coordinator.enabled).toBe(false);
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(coordinator.pendingHeights).toEqual([]);
    expect(coordinator.results).toEqual([]);
  });

  it('anchors an enqueued milestone and records the receipt', async () => {
    const anchor = fakeAnchor();
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog() });
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(anchor.calls).toEqual([{ height: 1_000, hash: HEX32 }]);
    expect(coordinator.results).toHaveLength(1);
    expect(coordinator.results[0]!.status).toBe('success');
  });

  it('skips heights already anchored on-chain (idempotent restart)', async () => {
    const anchor = fakeAnchor();
    await anchor.anchorMilestone({
      blockHeight: 1_000,
      milestoneHash: HEX32,
      spanFromBlockHash: HEX32_B,
      spanToBlockHash: HEX32_C,
      spanBlocks: 1_000,
      totalCumulativeWork: '1',
    });
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog() });
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(anchor.calls).toHaveLength(1); // only the pre-anchor call above
    expect(coordinator.results).toHaveLength(0);
  });

  it('retries transient failures and succeeds on a later attempt', async () => {
    const anchor = fakeAnchor();
    anchor.failNext(2);
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog(), retryDelayMs: 0 });
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(anchor.calls).toHaveLength(1);
    expect(coordinator.results).toHaveLength(1);
  });

  it('keeps a milestone queued when retries are exhausted, and delivers it on the next drain', async () => {
    const anchor = fakeAnchor();
    anchor.failNext(99);
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog(), retryDelayMs: 0 });
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(anchor.calls).toHaveLength(0); // still failed 3 times
    expect(coordinator.pendingHeights).toEqual([1_000]); // kept for retry

    anchor.failNext(0); // heal the network
    await coordinator.close(); // next drain (e.g. triggered by shutdown)
    expect(anchor.calls).toHaveLength(1);
    expect(coordinator.pendingHeights).toEqual([]);
  });

  it('does not enqueue the same height twice', async () => {
    const anchor = fakeAnchor();
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog() });
    coordinator.enqueue(milestone());
    coordinator.enqueue(milestone());
    await coordinator.close();
    expect(anchor.calls).toHaveLength(1);
  });

  it('delivers multiple milestones in height order', async () => {
    const anchor = fakeAnchor();
    const coordinator = new MilestoneAnchorCoordinator(anchor, { log: silentLog() });
    coordinator.enqueue(milestone({ blockHeight: 3_000 }));
    coordinator.enqueue(milestone({ blockHeight: 1_000 }));
    await coordinator.close();
    expect(anchor.calls.map((c) => c.height)).toEqual([3_000, 1_000]);
  });
});

describe('anchor input validation', () => {
  it('rejects non-bytes32 hashes before sending', async () => {
    // Build a real client but stub its wallet/public clients so no network is
    // touched; validation must fire before any client call.
    const client = createMilestoneAnchor({
      contractAddress: '0x1111111111111111111111111111111111111111',
      privateKey: `0x${'11'.repeat(32)}`,
      clients: {
        publicClient: createPublicClient({ transport: http('http://127.0.0.1:1') }),
        walletClient: {
          chain: { id: 80_002, name: 't', nativeCurrency: { name: 'x', symbol: 'x', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:1'] } } },
        } as never,
        account: { address: '0x1111111111111111111111111111111111111111' } as never,
      },
    });
    await expect(client.anchorMilestone(milestone({ milestoneHash: '0x1234' }))).rejects.toThrow('ANCHOR_BAD_HEX32');
    await expect(client.anchorMilestone(milestone({ totalCumulativeWork: '12x34' }))).rejects.toThrow('ANCHOR_BAD_CUMULATIVE_WORK');
    await expect(client.anchorMilestone(milestone({ blockHeight: 0 }))).rejects.toThrow('ANCHOR_BAD_HEIGHT');
  });
});
