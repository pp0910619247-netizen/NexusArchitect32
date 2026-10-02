import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyVerifyFailure,
  maskApiKey,
  verifyApiKey,
} from './api-keys';

describe('maskApiKey', () => {
  it('masks a long key as prefix...last4 (sk-...abcd)', () => {
    expect(maskApiKey('sk-proj-abcdef123456')).toBe('sk-...3456');
    expect(maskApiKey('  AIzaSyExampleKey1234  ')).toBe('AIz...1234');
  });

  it('fully hides keys that are too short to mask safely (edge)', () => {
    expect(maskApiKey('short')).toBe('••••••••');
    expect(maskApiKey('12345678')).toBe('••••••••');
  });
});

describe('classifyVerifyFailure — three required error families', () => {
  it('classifies 401/403 as an invalid key (happy path)', () => {
    expect(classifyVerifyFailure(401)).toBe('invalid_key');
    expect(classifyVerifyFailure(403)).toBe('invalid_key');
  });

  it('classifies 429 as exhausted quota (happy path)', () => {
    expect(classifyVerifyFailure(429)).toBe('quota_exceeded');
  });

  it('classifies provider-specific 4xx payloads (edge)', () => {
    const geminiBody = '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","details":[{"identifier":"API_KEY_INVALID"}]}}';
    expect(classifyVerifyFailure(400, geminiBody)).toBe('invalid_key');
    expect(classifyVerifyFailure(400, '{"error":"You exceeded your current quota"}')).toBe(
      'quota_exceeded',
    );
  });

  it('falls back to unknown for unrelated failures (edge)', () => {
    expect(classifyVerifyFailure(500)).toBe('unknown');
    expect(classifyVerifyFailure(418, "I'm a teapot")).toBe('unknown');
    expect(classifyVerifyFailure(400)).toBe('unknown');
  });
});

describe('verifyApiKey — network vs payload handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the model list on a successful response (happy path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const result = await verifyApiKey('openai', 'sk-test-key');
    expect(result).toEqual({ ok: true, models: ['gpt-4.1', 'gpt-4.1-mini'] });
  });

  it('reports offline fetch failures as a network error (edge)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    );
    const result = await verifyApiKey('claude', 'sk-ant-test');
    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('reports 401 responses as an invalid key (edge)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { type: 'invalid_api_key' } }), { status: 401 }),
      ),
    );
    const result = await verifyApiKey('openai', 'sk-wrong');
    expect(result).toEqual({ ok: false, kind: 'invalid_key' });
  });
});
