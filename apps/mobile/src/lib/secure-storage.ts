import * as SecureStore from 'expo-secure-store';

import { maskApiKey } from './api-keys';
import type { ProviderId } from './api-keys';

/**
 * API-key storage (AGENTS.md §6): keys live ONLY in the iOS Keychain /
 * Android Keystore via expo-secure-store — never in SQLite, config files,
 * or logs. The UI only ever sees the masked form.
 *
 * SecureStore key names allow alphanumerics plus `.`, `-`, `:` only.
 */
const KEY_IDS: Readonly<Record<ProviderId, string>> = {
  gemini: 'api-key-gemini',
  openai: 'api-key-openai',
  claude: 'api-key-claude',
};

/** Reads the raw key. Returns `null` when absent or unavailable on device. */
export async function readApiKey(provider: ProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_IDS[provider]);
  } catch {
    return null;
  }
}

/** Reads the key and immediately masks it — raw keys never reach component state. */
export async function readMaskedApiKey(provider: ProviderId): Promise<string | null> {
  const raw = await readApiKey(provider);
  return raw === null ? null : maskApiKey(raw);
}

/** Persists a key in SecureStore. Throws when the device keystore rejects it. */
export async function writeApiKey(provider: ProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_IDS[provider], key.trim());
}

/** Removes a stored key. */
export async function deleteApiKey(provider: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_IDS[provider]);
}
