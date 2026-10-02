import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getSetting, setSetting } from '@/lib/db';
import { listVoiceOptions, normalizeVoiceSpeed, VOICE_SPEEDS } from '@/lib/voices';
import type { VoiceOption } from '@/lib/voices';
import { useTranslation } from '@/providers/language-provider';
import type { TranslationKey } from '@nexus/shared';

const VOICE_URI_SETTING = 'voice_uri';
const VOICE_SPEED_SETTING = 'voice_speed';

/**
 * Speech voice + rate picker. Both values persist permanently in on-device
 * SQLite, so the choice survives restarts.
 */
export function VoiceSection() {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedUri, setSelectedUri] = useState('');
  const [speed, setSpeed] = useState(1);
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    void listVoiceOptions().then(setVoices);
    void getSetting(VOICE_URI_SETTING).then((stored) => setSelectedUri(stored ?? ''));
    void getSetting(VOICE_SPEED_SETTING).then((stored) =>
      setSpeed(normalizeVoiceSpeed(stored)),
    );
  }, []);

  const pickVoice = (uri: string) => {
    setSelectedUri(uri);
    void setSetting(VOICE_URI_SETTING, uri)
      .then(() => setFlashKey('settings.saved'))
      .catch(() => setFlashKey('error.generic'));
  };

  const pickSpeed = (value: number) => {
    setSpeed(value);
    void setSetting(VOICE_SPEED_SETTING, String(value))
      .then(() => setFlashKey('settings.saved'))
      .catch(() => setFlashKey('error.generic'));
  };

  return (
    <SectionCard title={t('settings.voice')}>
      <View style={styles.row}>
        <ActionButton
          label={t('settings.voice.default')}
          onPress={() => pickVoice('')}
          tone={selectedUri === '' ? 'primary' : 'muted'}
        />
      </View>
      {voices.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.voice.none')}
        </ThemedText>
      ) : (
        <ScrollView style={styles.voiceList}>
          {voices.map((voice) => (
            <ActionButton
              key={voice.uri}
              label={`${voice.name} · ${voice.language}`}
              onPress={() => pickVoice(voice.uri)}
              tone={selectedUri === voice.uri ? 'primary' : 'muted'}
            />
          ))}
        </ScrollView>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.voiceSpeed')}
      </ThemedText>
      <View style={styles.row}>
        {VOICE_SPEEDS.map((value) => (
          <ActionButton
            key={value}
            label={String(value)}
            onPress={() => pickSpeed(value)}
            tone={speed === value ? 'primary' : 'muted'}
          />
        ))}
      </View>
      {flashKey !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t(flashKey)}
        </ThemedText>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  voiceList: {
    maxHeight: 200,
    gap: Spacing.two,
  },
});
