import { StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { Spacing } from '@/constants/theme';
import { useTranslation } from '@/providers/language-provider';

/**
 * EN/TH switch — every screen reads the same context, so flipping the
 * language re-renders the whole app instantly (no restart) and the choice
 * persists to on-device SQLite.
 */
export function LanguageSection() {
  const { t, lang, setLang } = useTranslation();

  return (
    <SectionCard title={t('settings.language')}>
      <View style={styles.row}>
        <ActionButton
          label={t('settings.language.en')}
          onPress={() => setLang('en')}
          tone={lang === 'en' ? 'primary' : 'muted'}
        />
        <ActionButton
          label={t('settings.language.th')}
          onPress={() => setLang('th')}
          tone={lang === 'th' ? 'primary' : 'muted'}
        />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
