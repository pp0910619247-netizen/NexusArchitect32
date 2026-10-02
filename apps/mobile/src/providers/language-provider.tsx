import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { t as sharedTranslate } from '@nexus/shared';
import type { Lang, TranslationKey } from '@nexus/shared';

import { getSetting, setSetting } from '@/lib/db';

/**
 * Live EN/TH language switch over the shared `@nexus/shared` i18n
 * dictionaries. `setLang` re-renders every consumer immediately — no app
 * restart required. The choice persists in on-device SQLite.
 */

export type Translate = (key: TranslationKey) => string;

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const LANGUAGE_SETTING_KEY = 'language';

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    let cancelled = false;
    void getSetting(LANGUAGE_SETTING_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'en' || stored === 'th')) {
          setLangState(stored);
        }
      })
      .catch(() => {
        // First launch without a stored preference keeps the default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next); // Immediate re-render — every t() call switches language now.
    void setSetting(LANGUAGE_SETTING_KEY, next).catch(() => {
      // Persistence failure must never block the live switch.
    });
  }, []);

  const t = useCallback<Translate>((key) => sharedTranslate(key, lang), [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Access the active language, its setter, and the bound translator. */
export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === null) {
    throw new Error('useTranslation must be used inside a LanguageProvider');
  }
  return context;
}
