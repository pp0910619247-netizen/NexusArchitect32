'use client';

import { usePathname } from 'next/navigation';
import { LANG_COOKIE, type Lang } from '@/i18n';

/** Locale-swaps the CURRENT path (`/th/block/12` → `/en/block/12`). */
export function LanguageSwitcher({ lang, label, current }: { lang: Lang; label: string; current: string }) {
  const pathname = usePathname();
  const next: Lang = lang === 'en' ? 'th' : 'en';
  const segments = (pathname ?? `/${lang}`).split('/').filter(Boolean);
  segments[0] = next;
  const target = `/${segments.join('/')}`;
  return (
    <a
      href={target}
      aria-label={label}
      className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-700 hover:border-stone-400 hover:text-stone-900"
      onClick={(event) => {
        event.preventDefault();
        document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        window.location.assign(target);
      }}
    >
      {current}
    </a>
  );
}
