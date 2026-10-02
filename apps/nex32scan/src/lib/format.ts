/**
 * Display formatting for the explorer. All NEX math stays in `bigint` wei so a
 * 21,000,000-supply figure never loses precision to a float.
 */
import { NEX_DECIMALS } from '@nexus/shared';

const WEI_PER_NEX = 10n ** BigInt(NEX_DECIMALS);
const DECIMAL_DIGITS = Number(NEX_DECIMALS);

/** Groups an integer with `en-US` separators (stable across render environments). */
export function group(value: bigint | number): string {
  return value.toLocaleString('en-US');
}

/**
 * Formats wei as a NEX amount, trimming trailing zeroes.
 *
 * @param wei - Amount in wei.
 * @param maxFractionDigits - Digits kept after the decimal point. The default
 *   of 9 shows every Genesis-era reward exactly (the smallest is 2.052734375).
 * @returns e.g. `1,051`, `525.5`, `2.052734375`.
 */
export function formatNex(wei: bigint, maxFractionDigits = 9): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const whole = value / WEI_PER_NEX;
  const fraction = (value % WEI_PER_NEX).toString().padStart(DECIMAL_DIGITS, '0');
  const trimmed = fraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, '');
  const text = trimmed.length > 0 ? `${group(whole)}.${trimmed}` : group(whole);
  return negative ? `-${text}` : text;
}

/**
 * The text of the option a miner picked. The explorer never shows an answer as
 * "A" / "ก": a letter would let anyone copy the answer without understanding
 * the question, so the answer is always rendered as its own wording.
 *
 * @param options - The question's options in display order.
 * @param index - 0-based option index recorded with the answer.
 * @returns The option text, or `null` when the index has no option.
 */
export function optionText(options: readonly string[], index: number): string | null {
  const text = options[index];
  return typeof text === 'string' && text.trim().length > 0 ? text : null;
}

/** Flattens whitespace and cuts to `max` characters with an ellipsis. */
export function truncate(value: string, max = 96): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** `0x1234…abcd` style shortening for hashes and addresses in tables. */
export function shortHash(value: string | null | undefined, lead = 10, tail = 8): string {
  if (!value) return '—';
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Formats a count with separators; non-finite input renders as a dash. */
export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? group(value) : '—';
}

/** Percentage with one decimal, e.g. `72.4%`; `null` when the base is zero. */
export function formatPercent(part: number, total: number): string | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return `${((part / total) * 100).toFixed(1)}%`;
}

export type DurationUnit = 'second' | 'minute' | 'hour' | 'day';

/**
 * Splits a duration into the largest whole unit that fits (Polygonscan-style
 * compact ages). Negative/NaN input is clamped to zero.
 */
export function durationParts(ms: number): { value: number; unit: DurationUnit } {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const seconds = safe / 1_000;
  if (seconds < 60) return { value: Math.floor(seconds), unit: 'second' };
  const minutes = seconds / 60;
  if (minutes < 60) return { value: Math.floor(minutes), unit: 'minute' };
  const hours = minutes / 60;
  if (hours < 24) return { value: Math.floor(hours), unit: 'hour' };
  return { value: Math.floor(hours / 24), unit: 'day' };
}

/** Duration string using dictionary words, e.g. `2 min` or `2 นาที`. */
export function formatDuration(ms: number, words: Record<DurationUnit, string>): string {
  const { value, unit } = durationParts(ms);
  return `${value} ${words[unit]}`;
}
