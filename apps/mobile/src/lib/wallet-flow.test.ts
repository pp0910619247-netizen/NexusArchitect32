import { describe, expect, it } from 'vitest';

import { nextWalletSaveStep } from './wallet-flow';

describe('nextWalletSaveStep — two-confirm overwrite rule', () => {
  const saved = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  const different = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';

  it('writes directly when no wallet is saved yet (happy path)', () => {
    expect(nextWalletSaveStep(null, saved)).toBe('write');
  });

  it('requires confirmation when replacing a different address (happy path)', () => {
    expect(nextWalletSaveStep(saved, different)).toBe('confirm1');
  });

  it('treats a re-entered identical address as a no-op write (edge)', () => {
    expect(nextWalletSaveStep(saved, saved)).toBe('write');
    expect(nextWalletSaveStep(saved, saved.toLowerCase())).toBe('write');
  });
});
