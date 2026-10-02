import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import type { TranslationKey } from '@nexus/shared';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getVerifiedModels, saveVerifiedModels } from '@/lib/db';
import type { VerifiedModelsRecord } from '@/lib/db';
import { intlLocale } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';
import {
  readApiKey,
  readMaskedApiKey,
  writeApiKey,
  deleteApiKey,
} from '@/lib/secure-storage';
import { verifyApiKey } from '@/lib/api-keys';
import type { ProviderId, VerifyErrorKind } from '@/lib/api-keys';
import { useTranslation } from '@/providers/language-provider';

type VerifyState =
  | { phase: 'idle' }
  | { phase: 'verifying' }
  | { phase: 'no_key' }
  | { phase: 'ok'; models: string[]; verifiedAt: number }
  | { phase: 'error'; kind: VerifyErrorKind };

/** The three required error families, mapped to i18n keys. */
const ERROR_KEYS: Readonly<Record<VerifyErrorKind, TranslationKey>> = {
  invalid_key: 'settings.error.invalidKey',
  quota_exceeded: 'settings.error.quota',
  network: 'error.network',
  unknown: 'error.generic',
};

export function ApiKeyRow({ provider }: { provider: ProviderId }) {
  const { t, lang } = useTranslation();
  const theme = useTheme();
  const [masked, setMasked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ phase: 'idle' });
  const [stored, setStored] = useState<VerifiedModelsRecord | null>(null);

  const reload = useCallback(() => {
    void readMaskedApiKey(provider).then(setMasked);
    void getVerifiedModels(provider).then((record) => {
      setStored(record);
      if (record !== null) {
        setVerify({ phase: 'ok', models: record.models, verifiedAt: record.verifiedAt });
      }
    });
  }, [provider]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = () => {
    const key = draft.trim();
    if (key.length === 0) {
      setFlashKey('settings.apiKey.required');
      return;
    }
    void writeApiKey(provider, key)
      .then(() => {
        setDraft('');
        setFlashKey('settings.apiKey.stored');
        reload();
      })
      .catch(() => setFlashKey('error.generic'));
  };

  const clear = () => {
    void deleteApiKey(provider)
      .then(() => {
        setFlashKey('settings.saved');
        setVerify({ phase: 'idle' });
        setStored(null);
        reload();
      })
      .catch(() => setFlashKey('error.generic'));
  };

  const verifyKey = () => {
    setVerify({ phase: 'verifying' });
    void (async () => {
      const raw = await readApiKey(provider);
      if (raw === null) {
        setVerify({ phase: 'no_key' });
        return;
      }
      const result = await verifyApiKey(provider, raw);
      if (result.ok) {
        await saveVerifiedModels(provider, result.models).catch(() => undefined);
        setVerify({ phase: 'ok', models: result.models, verifiedAt: Date.now() });
        setStored(null);
      } else {
        setVerify({ phase: 'error', kind: result.kind });
      }
    })();
  };

  const inputStyle = [
    styles.input,
    {
      color: theme.text,
      borderColor: theme.backgroundSelected,
      backgroundColor: theme.background,
    },
  ];

  const renderModels = (models: string[], verifiedAt: number) => (
    <View style={styles.verifyBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        {`${t('settings.verify.checkedAt')}: ${new Date(verifiedAt).toLocaleString(intlLocale(lang))}`}
      </ThemedText>
      {models.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.verify.noModels')}
        </ThemedText>
      ) : (
        <ScrollView style={styles.modelList}>
          <ThemedText type="smallBold">{t('settings.verify.models')}</ThemedText>
          {models.map((model) => (
            <ThemedText key={model} type="code">
              {model}
            </ThemedText>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderVerification = () => {
    switch (verify.phase) {
      case 'verifying':
        return (
          <ThemedText type="small" themeColor="textSecondary">
            {t('common.loading')}
          </ThemedText>
        );
      case 'no_key':
        return (
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.apiKey.required')}
          </ThemedText>
        );
      case 'error':
        return (
          <ThemedText type="small" themeColor="textSecondary">
            {t(ERROR_KEYS[verify.kind])}
          </ThemedText>
        );
      case 'ok':
        return (
          <View style={styles.verifyBlock}>
            <ThemedText type="small">{t('settings.verify.ok')}</ThemedText>
            {renderModels(verify.models, verify.verifiedAt)}
          </View>
        );
      case 'idle':
        if (stored !== null) {
          return renderModels(stored.models, stored.verifiedAt);
        }
        return (
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.verify.never')}
          </ThemedText>
        );
    }
  };

  return (
    <View style={styles.root}>
      {masked !== null ? <ThemedText type="code">{masked}</ThemedText> : null}
      <TextInput
        style={inputStyle}
        value={draft}
        onChangeText={setDraft}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('settings.apiKey.placeholder')}
        placeholder={t('settings.apiKey.placeholder')}
        placeholderTextColor={theme.textSecondary}
      />
      <View style={styles.actions}>
        <ActionButton label={t('settings.apiKey.save')} onPress={save} />
        <ActionButton label={t('settings.apiKey.clear')} onPress={clear} tone="muted" />
        <ActionButton label={t('settings.verifyKey')} onPress={verifyKey} tone="muted" />
      </View>
      {flashKey !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t(flashKey)}
        </ThemedText>
      ) : null}
      {renderVerification()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  verifyBlock: {
    gap: Spacing.half,
  },
  modelList: {
    maxHeight: 160,
  },
});
