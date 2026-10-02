import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadIdentityNames, saveIdentityNames } from '@/lib/core-memory';
import { useTranslation } from '@/providers/language-provider';
import type { TranslationKey } from '@nexus/shared';

/**
 * Owner + AI names — both are written to Core Memory (AGENTS.md §5):
 * identity data that never expires and never leaves the device.
 */
export function IdentitySection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [ownerName, setOwnerName] = useState('');
  const [aiName, setAiName] = useState('');
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    void loadIdentityNames().then((names) => {
      setOwnerName(names.ownerName);
      setAiName(names.aiName);
    });
  }, []);

  const save = () => {
    if (ownerName.trim().length === 0 || aiName.trim().length === 0) {
      setFlashKey('settings.identity.required');
      return;
    }
    void saveIdentityNames(ownerName, aiName)
      .then(() => setFlashKey('settings.saved'))
      .catch(() => setFlashKey('error.generic'));
  };

  const inputStyle = [
    styles.input,
    {
      color: theme.text,
      borderColor: theme.backgroundSelected,
      backgroundColor: theme.background,
    },
  ];

  return (
    <SectionCard title={t('settings.identity')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('profile.displayName')}
      </ThemedText>
      <TextInput
        style={inputStyle}
        value={ownerName}
        onChangeText={setOwnerName}
        accessibilityLabel={t('profile.displayName')}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {t('profile.aiName')}
      </ThemedText>
      <TextInput
        style={inputStyle}
        value={aiName}
        onChangeText={setAiName}
        accessibilityLabel={t('profile.aiName')}
      />
      <View style={styles.row}>
        <ActionButton label={t('common.save')} onPress={save} />
        {flashKey !== null ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t(flashKey)}
          </ThemedText>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
});
