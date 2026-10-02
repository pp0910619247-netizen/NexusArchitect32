import { ScrollView, StyleSheet } from 'react-native';

import { ApiKeysSection } from '@/components/settings/api-keys-section';
import { IdentitySection } from '@/components/settings/identity-section';
import { LanguageSection } from '@/components/settings/language-section';
import { VoiceSection } from '@/components/settings/voice-section';
import { WalletSection } from '@/components/settings/wallet-section';
import { AccountSection } from '@/components/settings/account-section';
import { Spacing } from '@/constants/theme';

export default function SettingsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <LanguageSection />
      <ApiKeysSection />
      <IdentitySection />
      <VoiceSection />
      <WalletSection />
      <AccountSection />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
});
