import { describe, expect, it } from 'vitest';

import { isHexAddress, isValidEip55, normalizeAddress, toChecksumAddress } from './eip55';

/** Official EIP-55 checksum test vectors. */
const EIP55_VECTORS = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
] as const;

describe('isValidEip55 — happy path', () => {
  it('accepts every official EIP-55 vector unchanged', () => {
    for (const address of EIP55_VECTORS) {
      expect(isValidEip55(address)).toBe(true);
      expect(toChecksumAddress(address)).toBe(address);
    }
  });

  it('accepts all-lowercase input and canonicalizes it to the checksummed form', () => {
    const lower = EIP55_VECTORS[0].toLowerCase();
    expect(isValidEip55(lower)).toBe(true);
    expect(normalizeAddress(lower)).toBe(EIP55_VECTORS[0]);
  });
});

describe('isValidEip55 — edge cases', () => {
  it('rejects mixed-case addresses with a wrong checksum', () => {
    // Flip the case of one letter: still mixed, no longer checksummed.
    const tampered = `0x5A${EIP55_VECTORS[0].slice(4)}`;
    expect(isValidEip55(tampered)).toBe(false);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEip55('')).toBe(false);
    expect(isValidEip55('0x1234')).toBe(false);
    expect(isValidEip55('5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
    expect(isValidEip55(`0x${'z'.repeat(40)}`)).toBe(false);
    expect(isHexAddress(`0x${'a'.repeat(41)}`)).toBe(false);
  });

  it('throws when checksumming a non-address (edge)', () => {
    expect(() => toChecksumAddress('not-an-address')).toThrow(RangeError);
  });
});
