import { getAvailableVoicesAsync } from 'expo-speech';

/** A device TTS voice the user can pick in Settings. */
export interface VoiceOption {
  /** Stable identifier persisted in local SQLite settings. */
  uri: string;
  /** Human-readable voice name as reported by the device (data, not UI copy). */
  name: string;
  /** BCP-47 language tag of the voice (data, not UI copy). */
  language: string;
}

/** Selectable speech speeds (multiplier of the normal rate). */
export const VOICE_SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Lists device voices; returns `[]` when the platform reports none. */
export async function listVoiceOptions(): Promise<VoiceOption[]> {
  try {
    const voices = await getAvailableVoicesAsync();
    return voices
      .filter((voice) => voice.identifier.length > 0)
      .map((voice) => ({
        uri: voice.identifier,
        name: voice.name,
        language: voice.language,
      }));
  } catch {
    return [];
  }
}

/** Parses a persisted speed, falling back to normal rate (1). */
export function normalizeVoiceSpeed(raw: string | null): number {
  const parsed = Number(raw);
  return VOICE_SPEEDS.includes(parsed) ? parsed : 1;
}
