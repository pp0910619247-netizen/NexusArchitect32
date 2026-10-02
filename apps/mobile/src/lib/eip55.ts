import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * EIP-55 checksum validation for wallet addresses (AGENTS.md §6).
 *
 * Pure module — no React Native imports — so it is unit-testable in Node.
 */

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** True when the value is `0x` followed by exactly 40 hex characters. */
export function isHexAddress(address: string): boolean {
  return HEX_ADDRESS.test(address);
}

/**
 * Computes the EIP-55 checksummed form of a hex address.
 *
 * @throws {RangeError} When the input is not a 20-byte hex address.
 */
export function toChecksumAddress(address: string): string {
  if (!isHexAddress(address)) {
    throw new RangeError(`Not a 20-byte hex address: ${address}`);
  }
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower[i]!;
    out += parseInt(hash[i]!, 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/**
 * Validates the EIP-55 checksum of an address.
 *
 * - Mixed-case addresses must match their recomputed checksum exactly.
 * - All-lowercase / all-uppercase addresses carry no checksum to verify,
 *   so they are accepted here and canonicalized via {@link normalizeAddress}
 *   before being stored.
 * - Anything that is not a 20-byte hex address is rejected.
 */
export function isValidEip55(address: string): boolean {
  if (!isHexAddress(address)) {
    return false;
  }
  const body = address.slice(2);
  const isLowercase = body === body.toLowerCase();
  const isUppercase = body === body.toUpperCase();
  if (isLowercase || isUppercase) {
    return true;
  }
  return toChecksumAddress(address) === address;
}

/** Returns the canonical EIP-55 checksummed form used for storage. */
export function normalizeAddress(address: string): string {
  return toChecksumAddress(address);
}
