import { NEX_DECIMALS } from '@nexus/shared';

/**
 * Formats a wei amount as a whole-token NEX string for display.
 * Truncates (never rounds up) the fraction to 6 decimal places so the
 * shown value never claims more precision than the chain pays out.
 */
export function formatNex(wei: bigint): string {
  if (wei < 0n) {
    throw new RangeError(`NEX amount cannot be negative: ${wei}`);
  }
  const base = 10n ** NEX_DECIMALS;
  const whole = wei / base;
  const fraction = (wei % base)
    .toString()
    .padStart(Number(NEX_DECIMALS), '0')
    .slice(0, 6)
    .replace(/0+$/, '');
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
}

/** Maps a UI language to a BCP-47 locale for date/number rendering. */
export function intlLocale(lang: 'en' | 'th'): string {
  return lang === 'th' ? 'th-TH' : 'en-US';
}
