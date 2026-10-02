import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { signInWithGoogle } from '@/lib/auth/google-sign-in';
import type { GoogleUserInfo } from '@/lib/auth/google-sign-in';
import { getPlayIntegrityProvider } from '@/lib/integrity/play-integrity';
import { useTranslation } from '@/providers/language-provider';
import type { TranslationKey } from '@nexus/shared';

/**
 * Account section: Google Sign-In through expo-auth-session (stays in the
 * documented "not configured" state until a client ID is provided — see
 * `.env.example`) plus the Play Integrity status line backed by the
 * interface-first provider.
 */
export function AccountSection() {
  const { t } = useTranslation();
  const [user, setUser] = useState<GoogleUserInfo | null>(null);
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const integrity = getPlayIntegrityProvider();

  const signIn = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setFlashKey(null);
    void signInWithGoogle().then((outcome) => {
      setBusy(false);
      switch (outcome.status) {
        case 'success':
          setUser(outcome.user);
          setFlashKey('settings.google.signedIn');
          break;
        case 'not_configured':
          setFlashKey('settings.google.notConfigured');
          break;
        case 'error':
          setFlashKey('settings.google.failed');
          break;
        case 'dismissed':
          break;
      }
    });
  };

  return (
    <SectionCard title={t('settings.account')}>
      {user !== null ? (
        <View style={styles.row}>
          <ThemedText type="small">{`${t('settings.google.signedIn')}: ${user.email}`}</ThemedText>
          <ActionButton
            label={t('settings.google.signOut')}
            onPress={() => {
              setUser(null);
              setFlashKey(null);
            }}
            tone="muted"
          />
        </View>
      ) : (
        <ActionButton
          label={busy ? t('common.loading') : t('settings.google.signIn')}
          onPress={signIn}
          disabled={busy}
        />
      )}
      {flashKey !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t(flashKey)}
        </ThemedText>
      ) : null}
      {integrity.isAvailable ? null : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.integrity.pending')}
        </ThemedText>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
});
