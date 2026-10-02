'use client';

import { useRouter } from 'next/navigation';
import { LANG_COOKIE, type Lang } from '@/i18n';

/**
 * Toggles the landing page's language without a full reload: writes the
 * language cookie, then re-renders the server component via router.refresh().
 */
export function LandingLanguageSwitcher({ lang, enLabel, thLabel }: { lang: Lang; enLabel: string; thLabel: string }) {
  const router = useRouter();
  const next: Lang = lang === 'en' ? 'th' : 'en';
  const label = next === 'en' ? enLabel : thLabel;
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        router.refresh();
      }}
      className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-700 hover:border-stone-400 hover:text-stone-900"
    >
      {label}
    </button>
  );
}
