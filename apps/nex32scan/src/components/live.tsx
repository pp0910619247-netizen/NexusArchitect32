'use client';
/**
 * The only client-side pieces of the explorer: a ticking relative age and a
 * bounded auto-refresh. Both render identically on the server and on the first
 * client render (ages start as a placeholder), so hydration never mismatches.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { durationParts } from '@/lib/format';
import { fill, type TimeWords } from '@/i18n';

const UNIT_KEYS = { second: 'unitSecond', minute: 'unitMinute', hour: 'unitHour', day: 'unitDay' } as const;

/** Live "7 secs ago" label that re-renders once per second. */
export function RelativeTime({
  timestamp,
  words,
  className,
}: {
  timestamp: number | null | undefined;
  words: TimeWords;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (!timestamp) return <span className={className}>—</span>;
  if (now === null) return <span className={className}>—</span>;

  const age = Math.max(0, now - timestamp);
  const { value, unit } = durationParts(age);
  const label =
    age < 1_000 ? words.justNow : fill(words.agoTemplate, { value: `${value} ${words[UNIT_KEYS[unit]]}` });
  return (
    <span className={className} title={new Date(timestamp).toISOString()}>
      {label}
    </span>
  );
}

/**
 * Re-fetches the current server component tree on an interval. Bounded and
 * silent: the label is the only UI, and unmounting clears the timer.
 */
export function AutoRefresh({ seconds, label }: { seconds: number; label: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), Math.max(5, seconds) * 1_000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-600">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {label}
    </span>
  );
}
