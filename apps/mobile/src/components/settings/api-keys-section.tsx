import { ThemedText } from '@/components/themed-text';
import { SectionCard } from '@/components/section-card';
import { ApiKeyRow } from '@/components/settings/api-key-row';
import { PROVIDERS, PROVIDER_LABEL_KEYS } from '@/lib/api-keys';
import { useTranslation } from '@/providers/language-provider';

/**
 * One card per provider (Gemini / OpenAI / Claude).
 * Keys are stored in SecureStore only (AGENTS.md §6) and shown masked.
 */
export function ApiKeysSection() {
  const { t } = useTranslation();

  return (
    <>
      <ThemedText type="smallBold">{t('settings.apiKeys')}</ThemedText>
      {PROVIDERS.map((provider) => (
        <SectionCard key={provider} title={t(PROVIDER_LABEL_KEYS[provider])}>
          <ApiKeyRow provider={provider} />
        </SectionCard>
      ))}
    </>
  );
}
