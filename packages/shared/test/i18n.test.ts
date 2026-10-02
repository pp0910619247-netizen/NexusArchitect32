import { describe, expect, it } from 'vitest';
import { en, t, th } from '../src/i18n/index.js';
import type { TranslationKey } from '../src/i18n/index.js';

describe('i18n dictionary parity', () => {
  it('en and th expose exactly the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const thKeys = Object.keys(th).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    expect(thKeys).toEqual(enKeys);
  });

  it('has no empty translations in either language (edge)', () => {
    for (const key of Object.keys(en) as TranslationKey[]) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(th[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps identical key ordering in both files', () => {
    expect(Object.keys(th)).toEqual(Object.keys(en));
  });
});

describe('t(key, lang)', () => {
  it('returns the English string for lang = en', () => {
    expect(t('nav.explorer', 'en')).toBe('Explorer');
    expect(t('app.name', 'en')).toBe(en['app.name']);
  });

  it('returns the Thai string for lang = th', () => {
    expect(t('nav.explorer', 'th')).toBe('เอ็กซ์พลอเรอร์');
    expect(t('app.name', 'th')).toBe(th['app.name']);
  });

  it('resolves every key in both languages without falling back (edge)', () => {
    for (const key of Object.keys(en) as TranslationKey[]) {
      expect(t(key, 'en')).toBe(en[key]);
      expect(t(key, 'th')).toBe(th[key]);
    }
  });
});
