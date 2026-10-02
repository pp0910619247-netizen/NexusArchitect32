import { createHash, randomUUID } from 'node:crypto';

/** SHA-256 hex digest of a UTF-8 string, `0x`-prefixed (64 hex chars). */
export function sha256Hex(input: string): `0x${string}` {
  return `0x${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively, no
 * whitespace, `undefined` values dropped. Identical data always produces an
 * identical string, so hashing it is stable across processes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value ${String(value)}`);
}

/** Counts leading zero bits of a `0x`-prefixed hex digest (PoW check). */
export function leadingZeroBits(hex: string): number {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  let bits = 0;
  for (const char of body) {
    const nibble = Number.parseInt(char, 16);
    if (!Number.isFinite(nibble)) return bits;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    if (nibble < 2) bits += 3;
    else if (nibble < 4) bits += 2;
    else if (nibble < 8) bits += 1;
    break;
  }
  return bits;
}

/** Compact deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes two integers into one 32-bit seed (FNV-1a style). */
export function mixSeeds(a: number, b: number): number {
  let h = 0x811c9dc5;
  const parts = [a, b];
  for (const part of parts) {
    h ^= part & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (part >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (part >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (part >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform integer in `[min, max]` inclusive from an RNG. */
export function ri(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Picks a random element from a non-empty array. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('PICK_FROM_EMPTY');
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[index];
  if (item === undefined) throw new Error('PICK_UNDEFINED');
  return item;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function randomActionId(): string {
  return `ACT-${randomUUID()}`;
}
