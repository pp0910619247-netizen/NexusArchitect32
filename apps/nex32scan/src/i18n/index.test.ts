import { describe, expect, it } from 'vitest';
import { dictionary, en, fill, isLang, requireLang, th, timeWords } from './index';

describe('explorer i18n', () => {
  it('has identical English and Thai key sets', () => {
    expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort());
  });

  it('validates supported language routes', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('th')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(requireLang('th')).toBe('th');
    expect(() => requireLang('fr')).toThrow();
  });

  it('returns only the selected dictionary', () => {
    expect(dictionary('en')).toBe(en);
    expect(dictionary('th')).toBe(th);
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(en[key]), `en.${key}`).toEqual(placeholders(th[key]));
    }
  });

  it('has no empty strings and fills templates', () => {
    for (const [key, value] of Object.entries(en)) expect(value.trim().length, `en.${key}`).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(th)) expect(value.trim().length, `th.${key}`).toBeGreaterThan(0);
    // Templates take already-formatted strings (number grouping stays in lib/format).
    expect(fill(en.rewardAtHeight, { height: '1,397' })).toBe('Genesis reward @ block 1,397');
    expect(fill(th.answerFoundInBlock, { height: 7 })).toBe('พบ commitment ในบล็อก 7');
    expect(fill('{unknown} stays', {})).toBe('{unknown} stays');
  });

  it('exposes the client time words for both languages', () => {
    expect(timeWords('en').unitMinute).toBe('min');
    expect(timeWords('en').unitDay).toBe('days');
    expect(timeWords('th').unitMinute).toBe('นาที');
    expect(timeWords('th').agoTemplate).toContain('{value}');
  });
});
