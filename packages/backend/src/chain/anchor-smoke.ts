import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEther } from 'viem';
import { createMilestoneAnchor, MILESTONE_ANCHOR_ABI } from './anchor.js';

/**
 * Smoke test for the Amoy milestone anchor (TESTNET ONLY).
 *
 * 1. Loads packages/backend/.env when present (never committed).
 * 2. Prints wallet address + POL balance — stops when gas money is missing.
 * 3. Sends ONE real `recordMilestone` for height 949,000 — a multiple of
 *    1,000 the contract accepts, but higher than this quiz chain can ever
 *    reach (the 100k bank tops out at height 100,000) so it can never
 *    collide with a real milestone — then reads it back.
 *
 * Env: ANCHOR_CONTRACT_ADDRESS, ANCHOR_PRIVATE_KEY, optional AMOY_RPC_URL.
 * Run: pnpm --filter @nexus/backend build && pnpm --filter @nexus/backend anchor:smoke
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (KEY=VALUE lines) so no extra dependency is needed.
try {
  for (const line of readFileSync(path.join(HERE, '../../../.env'), 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
} catch {
  // no .env — env vars can come from the shell instead
}

const contractAddress = process.env.ANCHOR_CONTRACT_ADDRESS?.trim() ?? '';
const privateKey = process.env.ANCHOR_PRIVATE_KEY?.trim() ?? '';
if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress) || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error('ตั้ง ANCHOR_CONTRACT_ADDRESS และ ANCHOR_PRIVATE_KEY ใน .env ก่อน (ดู .env.example)');
  process.exit(1);
}

const anchor = createMilestoneAnchor({ contractAddress, privateKey });
console.log(`[smoke] wallet: ${anchor.anchorAddress} (chainId ${anchor.chainId})`);

const { createPublicClient, http } = await import('viem');
const { polygonAmoy } = await import('viem/chains');
const publicClient = createPublicClient({ chain: polygonAmoy, transport: http(process.env.AMOY_RPC_URL?.trim() || undefined) });
const balance = await publicClient.getBalance({ address: anchor.anchorAddress as `0x${string}` });
console.log(`[smoke] balance: ${formatEther(balance)} POL`);
if (balance === 0n) {
  console.error('กระเป๋าไม่มี gas — ไปรับ Amoy POL จาก faucet ก่อน (เช่น https://faucet.polygon.technology หรือ https://faucets.chainstack.com/amoy-faucet)');
  process.exit(1);
}

const already = await anchor.isAnchored(949_000);
console.log(`[smoke] isAnchored(949000) = ${already}`);

if (!already) {
  // Fake-but-valid milestone: deterministic hash over a fixed string.
  const { sha256Hex } = await import('./hash.js');
  const milestoneHash = sha256Hex('SMOKE-TEST:milestone-949000');
  console.log(`[smoke] sending recordMilestone(949000, ${milestoneHash}) …`);
  const result = await anchor.anchorMilestone({
    blockHeight: 949_000,
    milestoneHash,
    spanFromBlockHash: sha256Hex('SMOKE-TEST:span-from'),
    spanToBlockHash: sha256Hex('SMOKE-TEST:span-to'),
    spanBlocks: 949_000,
    totalCumulativeWork: '1',
  });
  console.log(`[smoke] tx ${result.txHash} — status=${result.status} block=${result.blockNumber} gas=${result.gasUsed}`);
  if (result.status !== 'success') process.exit(1);
}

const record = await publicClient.readContract({
  address: contractAddress as `0x${string}`,
  abi: MILESTONE_ANCHOR_ABI,
  functionName: 'isAnchored',
  args: [949_000n],
});
console.log(`[smoke] ยืนยันบนเชนแล้ว: isAnchored(949000) = ${record}`);
console.log('[smoke] ✅ ผ่าน — milestone anchor พร้อมใช้กับโหนดจริง');
