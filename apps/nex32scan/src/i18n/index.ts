import { en } from './en';
import { th } from './th';
export { en } from './en';
export { th } from './th';
export type Lang = 'en' | 'th';
export const LANG_COOKIE = 'nex32scan_lang';
export const messages = { en, th } as const;
export function isLang(value: string): value is Lang { return value === 'en' || value === 'th'; }
export function dictionary(lang: Lang) { return messages[lang]; }
export function requireLang(value: string): Lang {
  if (!isLang(value)) throw new Error(`Unsupported language: ${value}`);
  return value;
}

/**
 * Substitutes `{placeholders}` in a dictionary template. Unknown placeholders
 * are left untouched so a missing value is visible instead of silently blank.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/** Words a client component needs to render "x ago" / duration labels. */
export interface TimeWords {
  readonly justNow: string;
  readonly agoTemplate: string;
  readonly unitSecond: string;
  readonly unitMinute: string;
  readonly unitHour: string;
  readonly unitDay: string;
}

/** Time words for one language (safe to pass across the server/client boundary). */
export function timeWords(lang: Lang): TimeWords {
  const t = messages[lang];
  return {
    justNow: t.justNow,
    agoTemplate: t.agoTemplate,
    unitSecond: t.unitSecond,
    unitMinute: t.unitMinute,
    unitHour: t.unitHour,
    unitDay: t.unitDay,
  };
}

/** Unit words keyed by {@link DurationUnit} shape used by `formatDuration`. */
export function durationWords(lang: Lang): Record<'second' | 'minute' | 'hour' | 'day', string> {
  const t = messages[lang];
  return { second: t.unitSecond, minute: t.unitMinute, hour: t.unitHour, day: t.unitDay };
}
