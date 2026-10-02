import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import type { Account, Chain, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygonAmoy } from 'viem/chains';

/**
 * Amoy testnet anchor: sends each quiz-chain milestoneHash to the
 * MilestoneAnchor contract via viem. TESTNET ONLY — the chain is hard-wired
 * to Polygon Amoy (80002) per AGENTS.md; mainnet RPCs are rejected.
 *
 * The wallet key NEVER touches disk or logs; it is read from
 * ANCHOR_PRIVATE_KEY (or the option) and lives only in memory.
 */

/** Minimal ABI — mirrors what the backend calls on MilestoneAnchor.sol. */
export const MILESTONE_ANCHOR_ABI = parseAbi([
  'function recordMilestone(uint256 blockHeight, bytes32 milestoneHash, bytes32 spanFromBlockHash, bytes32 spanToBlockHash, uint256 spanBlocks, uint256 totalCumulativeWork)',
  'function isAnchored(uint256 blockHeight) view returns (bool)',
  'event MilestoneAnchored(uint256 indexed blockHeight, bytes32 indexed milestoneHash, bytes32 spanFromBlockHash, bytes32 spanToBlockHash, uint256 spanBlocks, uint256 totalCumulativeWork, uint64 anchoredAt)',
]);

/** Polygon Amoy testnet (chainId 80002) — the only permitted destination. */
export const AMOY_CHAIN_ID = 80_002;

export interface MilestoneAnchorInput {
  readonly blockHeight: number;
  readonly milestoneHash: string;
  readonly spanFromBlockHash: string;
  readonly spanToBlockHash: string;
  readonly spanBlocks: number;
  readonly totalCumulativeWork: string;
}

export interface AnchorResult {
  readonly txHash: string;
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint | null;
  readonly gasUsed: bigint | null;
  readonly effectiveGasPrice: bigint | null;
}

export interface MilestoneAnchorClient {
  /** Sends recordMilestone() and waits for one confirmation. */
  anchorMilestone(input: MilestoneAnchorInput): Promise<AnchorResult>;
  /** Reads whether a height is already anchored (used to skip re-sends). */
  isAnchored(blockHeight: number): Promise<boolean>;
  /** Anchor wallet address (for display/log; no key material). */
  readonly anchorAddress: string;
  readonly chainId: number;
}

/** Test seam so unit tests can inject fake viem clients. */
export interface AnchorClients {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly account: Account;
}

function assertHexBytes32(value: string, name: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`ANCHOR_BAD_HEX32: ${name}`);
  }
  return value as `0x${string}`;
}

function createClients(options: MilestoneAnchorOptions): AnchorClients {
  const rpcUrl = options.rpcUrl ?? 'https://rpc-amoy.polygon.technology';
  if (/polygon-mainnet|mainnet\.polygon/i.test(rpcUrl)) {
    throw new Error('ANCHOR_MAINNET_RPC_FORBIDDEN');
  }
  const privateKey = options.privateKey ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('ANCHOR_BAD_PRIVATE_KEY');
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const chain = options.chain ?? polygonAmoy;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });
  return { publicClient, walletClient, account };
}

export interface MilestoneAnchorOptions {
  /** Amoy JSON-RPC endpoint (default: the public Amoy gateway). */
  readonly rpcUrl?: string;
  /** Anchor wallet private key (0x…). Falls back to ANCHOR_PRIVATE_KEY. */
  readonly privateKey?: string;
  /** Deployed MilestoneAnchor address. Falls back to ANCHOR_CONTRACT_ADDRESS. */
  readonly contractAddress?: string;
  /** Chain descriptor override (tests: a fake chain). */
  readonly chain?: Chain;
  /** Client override (tests). Built from rpcUrl/key when omitted. */
  readonly clients?: AnchorClients;
  /** ms to wait for the receipt (default 120_000). */
  readonly confirmTimeoutMs?: number;
}

/** Builds the default Amoy anchor client from env/options. */
export function createMilestoneAnchor(options: MilestoneAnchorOptions = {}): MilestoneAnchorClient {
  const contractAddress = (options.contractAddress ?? process.env.ANCHOR_CONTRACT_ADDRESS ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error('ANCHOR_CONTRACT_ADDRESS_MISSING_OR_INVALID');
  }
  const privateKey = options.privateKey ?? process.env.ANCHOR_PRIVATE_KEY ?? '';
  const clients = options.clients ?? createClients({ rpcUrl: options.rpcUrl, privateKey, chain: options.chain });
  const confirmTimeoutMs = options.confirmTimeoutMs ?? 120_000;
  const anchorAddress = contractAddress as `0x${string}`;

  return {
    anchorAddress,
    get chainId(): number {
      return clients.walletClient.chain?.id ?? AMOY_CHAIN_ID;
    },
    async anchorMilestone(input: MilestoneAnchorInput): Promise<AnchorResult> {
      const milestoneHash = assertHexBytes32(input.milestoneHash, 'milestoneHash');
      const spanFrom = assertHexBytes32(input.spanFromBlockHash, 'spanFromBlockHash');
      const spanTo = assertHexBytes32(input.spanToBlockHash, 'spanToBlockHash');
      if (!Number.isSafeInteger(input.blockHeight) || input.blockHeight <= 0) {
        throw new Error('ANCHOR_BAD_HEIGHT');
      }
      if (!/^\d+$/.test(input.totalCumulativeWork)) {
        throw new Error('ANCHOR_BAD_CUMULATIVE_WORK');
      }
      const hash = await clients.walletClient.writeContract({
        address: anchorAddress,
        abi: MILESTONE_ANCHOR_ABI,
        functionName: 'recordMilestone',
        args: [
          BigInt(input.blockHeight),
          milestoneHash,
          spanFrom,
          spanTo,
          BigInt(input.spanBlocks),
          BigInt(input.totalCumulativeWork),
        ],
        chain: clients.walletClient.chain ?? undefined,
        account: clients.account,
      });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash, timeout: confirmTimeoutMs });
      return {
        txHash: hash,
        status: receipt.status === 'reverted' ? 'reverted' : 'success',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice ?? null,
      };
    },
    async isAnchored(blockHeight: number): Promise<boolean> {
      const anchored = (await clients.publicClient.readContract({
        address: anchorAddress,
        abi: MILESTONE_ANCHOR_ABI,
        functionName: 'isAnchored',
        args: [BigInt(blockHeight)],
      })) as boolean;
      return anchored;
    },
  };
}
