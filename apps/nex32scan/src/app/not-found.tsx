import Link from 'next/link';
import { dictionary } from '@/i18n';

/**
 * Root 404. `notFound()` from any locale route lands here, and a not-found
 * boundary has no route params, so the page shows both languages instead of
 * guessing — every string still comes from the dictionaries.
 */
export default function NotFound() {
  const en = dictionary('en');
  const th = dictionary('th');
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="text-3xl font-bold text-stone-900">404</span>
      <p className="text-stone-800">{en.notFoundPage}</p>
      <p className="text-stone-600">{th.notFoundPage}</p>
      <div className="mt-2 flex gap-4 text-sm">
        <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href="/en">
          {en.backHome}
        </Link>
        <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href="/th">
          {th.backHome}
        </Link>
      </div>
    </main>
  );
}
