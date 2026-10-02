import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SectionCard } from '@/components/section-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getSetting, setSetting } from '@/lib/db';
import { isValidEip55, normalizeAddress } from '@/lib/eip55';
import { nextWalletSaveStep } from '@/lib/wallet-flow';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/providers/language-provider';
import type { TranslationKey } from '@nexus/shared';

const WALLET_SETTING = 'wallet_address';

type ConfirmStep = 'idle' | 'confirm1' | 'confirm2';

/**
 * Wallet address entry (AGENTS.md §6):
 * - EIP-55 checksum validated before any write;
 * - the stored address is permanent — replacing it requires TWO explicit
 *   confirmations (Confirm 1/2 → Confirm 2/2);
 * - the canonical checksummed form is what actually gets persisted.
 */
export function WalletSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState<ConfirmStep>('idle');
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    void getSetting(WALLET_SETTING).then((stored) => {
      if (stored !== null && isValidEip55(stored)) {
        setCurrent(normalizeAddress(stored));
      }
    });
  }, []);

  const persist = (canonical: string) => {
    void setSetting(WALLET_SETTING, canonical)
      .then(() => {
        setCurrent(canonical);
        setDraft('');
        setStep('idle');
        setFlashKey('settings.wallet.saved');
      })
      .catch(() => setFlashKey('error.generic'));
  };

  const cancelConfirm = () => {
    setStep('idle');
    setFlashKey(null);
  };

  const submit = () => {
    if (step === 'confirm1') {
      setStep('confirm2');
      setFlashKey('settings.wallet.overwrite');
      return;
    }
    if (step === 'confirm2') {
      persist(draft.trim().length > 0 ? normalizeAddress(draft.trim()) : (current ?? ''));
      return;
    }
    const input = draft.trim();
    if (!isValidEip55(input)) {
      setFlashKey('error.invalidWallet');
      return;
    }
    const canonical = normalizeAddress(input);
    if (nextWalletSaveStep(current, canonical) === 'confirm1') {
      setStep('confirm1');
      setFlashKey('settings.wallet.overwrite');
      return;
    }
    persist(canonical);
  };

  const buttonLabelKey: TranslationKey =
    step === 'confirm1'
      ? 'settings.wallet.confirm1'
      : step === 'confirm2'
        ? 'settings.wallet.confirm2'
        : 'common.save';

  return (
    <SectionCard title={t('settings.wallet')}>
      <ThemedText type="code">
        {current ?? t('settings.wallet.never')}
      </ThemedText>
      <TextInput
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.backgroundSelected,
            backgroundColor: theme.background,
          },
        ]}
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          if (step !== 'idle') {
            setStep('idle');
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('settings.wallet')}
      />
      <View style={styles.row}>
        <ActionButton label={t(buttonLabelKey)} onPress={submit} />
        {step !== 'idle' ? (
          <ActionButton label={t('common.cancel')} onPress={cancelConfirm} tone="muted" />
        ) : null}
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
