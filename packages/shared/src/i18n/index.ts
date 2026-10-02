import { en } from './en.js';
import { th } from './th.js';
import type { TranslationKey } from './en.js';

export { en } from './en.js';
export { th } from './th.js';
export type { TranslationKey } from './en.js';

/** Supported UI languages. */
export type Lang = 'en' | 'th';

/** A complete dictionary for one language. */
export type Dictionary = Readonly<Record<TranslationKey, string>>;

const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { en, th };

/**
 * Type-safe translation lookup.
 *
 * @param key - Must be a key of the English dictionary (unknown keys fail `tsc`).
 * @param lang - Target language (`'en'` or `'th'`).
 * @returns The translated string for `key` in `lang`.
 *
 * @example
 * ```ts
 * t('nav.explorer', 'th'); // => 'เอ็กซ์พลอเรอร์'
 * ```
 */
export function t(key: TranslationKey, lang: Lang): string {
  return DICTIONARIES[lang][key];
}
