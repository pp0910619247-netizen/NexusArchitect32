import type { TranslationKey } from '@nexus/shared';

/**
 * AI provider API-key utilities: masked display, list-models verification,
 * and classification of the three required error families
 * (invalid key / exhausted quota / no network).
 *
 * Pure module — safe to unit-test in Node (no React Native imports).
 */

export type ProviderId = 'gemini' | 'openai' | 'claude';

/** Providers shown in Settings, in display order. */
export const PROVIDERS: readonly ProviderId[] = ['gemini', 'openai', 'claude'];

/** i18n key for each provider's display label. */
export const PROVIDER_LABEL_KEYS: Readonly<Record<ProviderId, TranslationKey>> = {
  gemini: 'settings.provider.gemini',
  openai: 'settings.provider.openai',
  claude: 'settings.provider.claude',
};

/** The three required error families, plus a safe fallback. */
export type VerifyErrorKind = 'invalid_key' | 'quota_exceeded' | 'network' | 'unknown';

export type VerifyResult =
  | { readonly ok: true; readonly models: string[] }
  | { readonly ok: false; readonly kind: VerifyErrorKind };

/**
 * Masks a stored key for display, e.g. `sk-...abcd`.
 * Keys of 8 characters or fewer are fully hidden (too little entropy to show).
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '•'.repeat(8);
  }
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

/**
 * Maps a non-OK HTTP response to one of the three required error families.
 *
 * @param status - HTTP status code of the list-models response.
 * @param bodyText - Raw response body, used to classify provider-specific 4xx payloads.
 */
export function classifyVerifyFailure(status: number, bodyText?: string): VerifyErrorKind {
  if (status === 401 || status === 403) {
    return 'invalid_key';
  }
  if (status === 429) {
    return 'quota_exceeded';
  }
  const body = (bodyText ?? '').toLowerCase();
  if (/api[ _-]?key[ _-]?invalid|invalid[ _-]?api[ _-]?key|api key .*(invalid|not valid)|incorrect api key/.test(body)) {
    return 'invalid_key';
  }
  if (/quota|rate.?limit|resource[ _-]?exhausted|billing/.test(body)) {
    return 'quota_exceeded';
  }
  return 'unknown';
}

interface ProviderEndpoint {
  url(apiKey: string): string;
  headers(apiKey: string): Record<string, string>;
  extract(json: unknown): string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function extractDataIds(json: unknown): string[] {
  const root = asRecord(json);
  const data = Array.isArray(root?.data) ? root.data : [];
  const ids: string[] = [];
  for (const entry of data) {
    const record = asRecord(entry);
    if (record && typeof record.id === 'string') {
      ids.push(record.id);
    }
  }
  return ids;
}

function extractGeminiNames(json: unknown): string[] {
  const root = asRecord(json);
  const models = Array.isArray(root?.models) ? root.models : [];
  const names: string[] = [];
  for (const entry of models) {
    const record = asRecord(entry);
    if (record && typeof record.name === 'string') {
      names.push(record.name.replace(/^models\//, ''));
    }
  }
  return names;
}

const ENDPOINTS: Readonly<Record<ProviderId, ProviderEndpoint>> = {
  openai: {
    url: () => 'https://api.openai.com/v1/models',
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    extract: extractDataIds,
  },
  claude: {
    url: () => 'https://api.anthropic.com/v1/models',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    extract: extractDataIds,
  },
  gemini: {
    url: (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    headers: () => ({}),
    extract: extractGeminiNames,
  },
};

/**
 * Calls the provider's lightweight list-models endpoint with the stored key
 * and returns the model IDs that key can actually use.
 *
 * Network failures (offline, DNS, timeout) are reported as `network` —
 * they are never confused with a bad key.
 */
export async function verifyApiKey(provider: ProviderId, apiKey: string): Promise<VerifyResult> {
  const endpoint = ENDPOINTS[provider];
  let response: Response;
  try {
    response = await fetch(endpoint.url(apiKey), { headers: endpoint.headers(apiKey) });
  } catch {
    return { ok: false, kind: 'network' };
  }
  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    return { ok: false, kind: classifyVerifyFailure(response.status, bodyText) };
  }
  try {
    return { ok: true, models: endpoint.extract(JSON.parse(bodyText) as unknown) };
  } catch {
    return { ok: false, kind: 'unknown' };
  }
}
