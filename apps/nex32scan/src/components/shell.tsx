import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { dictionary, durationWords, fill, isLang, timeWords, type Lang } from '@/i18n';
import { chainStatus } from '@/lib/chain-data';
import { remoteApiUrl } from '@/lib/explorer';
import { formatCount, formatDuration, formatNex, formatPercent, shortHash } from '@/lib/format';
import { GENESIS_FACTS, scheduledBlockReward } from '@/lib/reward';
import { AutoRefresh, RelativeTime } from './live';
import { LanguageSwitcher } from './language-switcher';
import { SearchBox } from './search-box';

/**
 * The explorer's look is a warm, easy-on-the-eyes cream: an off-white page
 * (`#FAF6EC`), white cards, warm ink type and one amber/gold accent taken from
 * the brand mark — the gold pyramid in `public/logo.png`. Meaning that used to
 * ride on hue still rides on fill where clarity matters: solid = the strongest
 * statement (milestone, correct, winner), outline = negative, muted = neutral.
 */

/** Every link in the explorer: black with a grey underline that darkens on hover. */
export const LINK_CLASS = 'text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700';

/** Route segment → supported language (anything else falls back to English). */
export function langFrom(value: string): Lang {
  return isLang(value) ? value : 'en';
}

/** Panel used for every grouped section of the explorer. */
export function Card({
  title,
  action,
  children,
  bodyClassName = 'p-4',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-stone-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** One cell of the global stat bar. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-stone-900">{value}</div>
      {hint ? <div className="text-xs text-stone-600">{hint}</div> : null}
    </div>
  );
}

/** Striped table used by every listing page (head labels + row cells). */
export function Table({ head, rows }: { head: readonly string[]; rows: readonly ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-stone-500">
            {head.map((label, index) => (
              <th key={`${label}-${index}`} className="px-4 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} className="border-t border-stone-200 hover:bg-stone-50">
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Monochrome pill labels. The four fills are the whole vocabulary:
 * `solid` = the strongest statement (milestone, correct, winner),
 * `outline` = negative or blocking (incorrect, hard),
 * `muted` = secondary metadata (not yet revealed),
 * `soft`  = neutral tag (discipline).
 */
const BADGE_TONES = {
  soft: 'bg-stone-100 text-stone-700',
  /** Gold = positive/revealed: milestone, correct answer, winner. */
  solid: 'bg-amber-700 text-white',
  outline: 'border border-stone-400 bg-white text-stone-700',
  muted: 'bg-stone-200 text-stone-800',
} as const;

/** Small pill label (HARD, MILESTONE, correct/incorrect, …). */
export function Badge({ tone = 'muted', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${BADGE_TONES[tone]}`}>{children}</span>;
}

/** `0x1234…abcd` address cell. */
export function ShortAddress({ address }: { address: string | null }) {
  return <span className="font-mono text-xs text-stone-700">{shortHash(address, 8, 6)}</span>;
}

/** Address cell that links to the address page whenever it is a real 0x address. */
export function AddressCell({ address, lang }: { address: string | null; lang: Lang }) {
  if (!address) return <span className="text-stone-500">—</span>;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return <ShortAddress address={address} />;
  return (
    <Link href={`/${lang}/address/${address.toLowerCase()}`} className={LINK_CLASS}>
      <ShortAddress address={address} />
    </Link>
  );
}

/** Monospace hash cell with the full value in the tooltip. */
export function HashValue({ value, href, className = '' }: { value: string | null | undefined; href?: string; className?: string }) {
  if (!value) return <span className="text-stone-500">—</span>;
  const label = <span className={`font-mono text-xs ${className}`}>{shortHash(value)}</span>;
  return href ? (
    <Link href={href} title={value} className={LINK_CLASS}>
      {label}
    </Link>
  ) : (
    <span title={value}>{label}</span>
  );
}

/** NEX amount rendered from wei without float rounding. */
export function Nex({ value }: { value: bigint | string }) {
  let wei: bigint;
  try {
    wei = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    return <span>—</span>;
  }
  return <span>{formatNex(wei)} NEX</span>;
}

/**
 * Explorer chrome: header with search, the chain-wide stat bar, the testnet
 * notice, and the footer. Server component — the stat bar reads the same
 * request-memoized status the pages use, and hides itself when there is no
 * data at all instead of printing zeros as facts.
 */
export async function Shell({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = dictionary(lang);
  const words = durationWords(lang);
  const status = await chainStatus();
  // Data-source badge: truthful per read (a configured-but-dead node is not "live").
  const live = status?.source === 'live' || (status === null && Boolean(remoteApiUrl()));
  const reward = status && status.height > 0 ? scheduledBlockReward(status.height) : null;
  const correctRate = status ? formatPercent(status.correctAnswers, status.totalAnswers) : null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href={`/${lang}`} className="flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900">
            <Image
              src="/logo.png"
              alt={t.brand}
              width={26}
              height={26}
              className="rounded-[6px]"
            />
            {t.brand}
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm text-stone-600">
            <Link className="hover:text-stone-900" href={`/${lang}`}>
              {t.home}
            </Link>
            <Link className="hover:text-stone-900" href={`/${lang}/blocks`}>
              {t.blocksPage}
            </Link>
            <Link className="hover:text-stone-900" href={`/${lang}/token`}>
              {t.tokenomics}
            </Link>
            <Link className="hover:text-stone-900" href={`/${lang}/impact`}>
              {t.impact}
            </Link>
            <a className="hover:text-stone-900" href="/api/explorer">
              {t.api}
            </a>
          </nav>
          <div className="ml-auto flex min-w-[15rem] flex-1 items-center gap-2">
            <SearchBox placeholder={t.searchPlaceholder} lang={lang} />
            <LanguageSwitcher lang={lang} label={t.languageSwitch} current={lang === 'en' ? t.en : t.th} />
          </div>
        </div>
        <p className="mx-auto max-w-7xl px-4 pb-2 text-xs text-stone-500">{t.siteTagline}</p>
      </header>

      {status && status.totalBlocks > 0 ? (
        <div className="border-b border-stone-200 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 px-2 py-2 sm:grid-cols-3 lg:grid-cols-7">
            <Stat
              label={t.latestBlock}
              value={`#${formatCount(status.height)}`}
              hint={<RelativeTime timestamp={status.lastBlockAt} words={timeWords(lang)} />}
            />
            <Stat
              label={t.statBlockTime}
              value={status.avgBlockIntervalMs === null ? '—' : formatDuration(status.avgBlockIntervalMs, words)}
            />
            <Stat label={t.statDifficulty} value={`${formatCount(status.difficultyBits)} bits`} />
            <Stat label={t.statTotalBlocks} value={formatCount(status.totalBlocks)} />
            <Stat
              label={t.statTotalAnswers}
              value={formatCount(status.totalAnswers)}
              hint={
                correctRate === null ? undefined : (
                  <>
                    {t.statCorrectRate} {correctRate}
                  </>
                )
              }
            />
            <Stat
              label={t.statMilestone}
              value={status.lastMilestoneHeight === null ? '—' : `#${formatCount(status.lastMilestoneHeight)}`}
            />
            <Stat
              label={fill(t.rewardAtHeight, { height: formatCount(status.height) })}
              value={reward ? `${formatNex(reward.rewardWei)} NEX` : '—'}
              hint={
                reward
                  ? fill(t.rewardEra, {
                      era: reward.era,
                      from: formatCount(reward.era * GENESIS_FACTS.halvingInterval + GENESIS_FACTS.startBlock),
                      to: formatCount((reward.era + 1) * GENESIS_FACTS.halvingInterval),
                    })
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-stone-700">
          <span>{t.testnet}</span>
          <span className="flex items-center gap-3">
            <span className="text-stone-500">{live ? t.dataSourceLive : t.dataSourceSnapshot}</span>
            {live ? <AutoRefresh seconds={15} label={fill(t.autoRefresh, { seconds: 15 })} /> : null}
          </span>
        </div>
        {children}
      </div>

      <footer className="border-t border-stone-200 px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
          <span>{t.footerNote}</span>
          <span>
            {t.brand} · {t.siteTagline}
          </span>
        </div>
      </footer>
    </div>
  );
}
