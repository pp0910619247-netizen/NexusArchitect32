import { describe, expect, it } from 'vitest';
import { durationParts, formatCount, formatDuration, formatNex, formatPercent, group, optionText, shortHash, truncate } from './format';

const NEX = 10n ** 18n;

describe('explorer formatters', () => {
  it('formats wei as NEX without float rounding', () => {
    expect(formatNex(1_051n * NEX)).toBe('1,051');
    expect(formatNex(1_051n * NEX + NEX / 2n)).toBe('1,051.5');
    expect(formatNex(525_500_000_000_000_000_000n)).toBe('525.5');
    expect(formatNex(2_052_734_375_000_000_000n)).toBe('2.052734375'); // smallest era reward
    expect(formatNex(1n)).toBe('0'); // below the display precision
    expect(formatNex(1n, 18)).toBe('0.000000000000000001');
    expect(formatNex(0n)).toBe('0');
    expect(formatNex(-2n * NEX)).toBe('-2');
  });

  it('keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatNex(21_000_000n * NEX)).toBe('21,000,000');
    expect(group(21_000_000n)).toBe('21,000,000');
  });

  it('shortens hashes and handles missing values', () => {
    expect(shortHash('0x1234567890abcdef')).toBe('0x1234567890abcdef');
    expect(shortHash('0x' + 'a'.repeat(64))).toBe(`0x${'a'.repeat(8)}…${'a'.repeat(8)}`);
    expect(shortHash(null)).toBe('—');
  });

  it('formats rates and counts defensively', () => {
    expect(formatPercent(3, 4)).toBe('75.0%');
    expect(formatPercent(1, 0)).toBeNull();
    expect(formatPercent(Number.NaN, 10)).toBeNull();
    expect(formatCount(1_234)).toBe('1,234');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });

  it('splits durations into the largest whole unit', () => {
    expect(durationParts(900)).toEqual({ value: 0, unit: 'second' });
    expect(durationParts(45_000)).toEqual({ value: 45, unit: 'second' });
    expect(durationParts(120_000)).toEqual({ value: 2, unit: 'minute' });
    expect(durationParts(7_200_000)).toEqual({ value: 2, unit: 'hour' });
    expect(durationParts(2 * 86_400_000)).toEqual({ value: 2, unit: 'day' });
    expect(durationParts(-5)).toEqual({ value: 0, unit: 'second' });
    expect(durationParts(Number.NaN)).toEqual({ value: 0, unit: 'second' });
    expect(formatDuration(4_200, { second: 'sec', minute: 'min', hour: 'hr', day: 'day' })).toBe('4 sec');
  });

  it('names a picked option in words and never as a letter (edge)', () => {
    // Happy path: the explorer shows the option's own wording, in both languages.
    expect(optionText(['ก', 'ข', 'ค', 'ง'], 2)).toBe('ค');
    expect(optionText(['River', 'Desert'], 0)).toBe('River');
    // Edge: a commitment/height without options must yield null, so callers
    // print the localized placeholder instead of `undefined` or a letter.
    expect(optionText(['River'], 3)).toBeNull();
    expect(optionText(['   '], 0)).toBeNull();
    expect(optionText([], 0)).toBeNull();
  });

  it('flattens and cuts long question text', () => {
    expect(truncate('a\n  b   c')).toBe('a b c');
    expect(truncate('x'.repeat(20), 10)).toBe('xxxxxxxxx…');
    expect(truncate('short', 10)).toBe('short');
  });
});
