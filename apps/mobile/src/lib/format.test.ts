import { describe, expect, it } from 'vitest';

import { formatNex, intlLocale } from './format';

describe('formatNex', () => {
  it('formats whole-token rewards without a fraction', () => {
    expect(formatNex(1_051n * 10n ** 18n)).toBe('1051');
    expect(formatNex(0n)).toBe('0');
  });

  it('keeps fractional NEX and trims trailing zeros', () => {
    expect(formatNex(525_500_000_000_000_000_000n)).toBe('525.5');
    expect(formatNex(2_052_734_375_000_000_000n)).toBe('2.052734');
  });

  it('rejects negative amounts (edge)', () => {
    expect(() => formatNex(-1n)).toThrow(RangeError);
  });
});

describe('intlLocale', () => {
  it('maps languages to BCP-47 locales', () => {
    expect(intlLocale('en')).toBe('en-US');
    expect(intlLocale('th')).toBe('th-TH');
  });
});
