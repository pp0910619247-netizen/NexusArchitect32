import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ALLOCATION_MINING_BPS, ALLOCATION_PUBLIC_SALE_BPS, ALLOCATION_TEAM_BPS, TOTAL_SUPPLY_NEX } from '@nexus/shared';
import { LandingLanguageSwitcher } from '@/components/landing-lang-switcher';
import { dictionary, isLang, LANG_COOKIE, type Lang } from '@/i18n';
import { formatCount } from '@/lib/format';
import { GENESIS_FACTS } from '@/lib/reward';

const GITHUB_URL = 'https://github.com/pp0910619247-netizen/NexusArchitect32';

export const metadata: Metadata = {
  title: 'Nexus Architect (NEX) — Mine knowledge. Shape impact.',
  description:
    'Knowledge-mining blockchain, a personal AI agent and an Impact Treasury on Polygon Amoy testnet. Explore sealed blocks, answers and the locked Genesis tokenomics.',
};

/** Allocation bars, derived from the locked tokenomics constants (never typed by hand). */
function allocationRows(t: ReturnType<typeof dictionary>) {
  return [
    { label: t.landingAllocationMining, pct: Number(ALLOCATION_MINING_BPS) / 100 },
    { label: t.landingAllocationSale, pct: Number(ALLOCATION_PUBLIC_SALE_BPS) / 100 },
    { label: t.landingAllocationTeam, pct: Number(ALLOCATION_TEAM_BPS) / 100, note: t.landingTeamVesting },
  ];
}

export default function Home() {
  const cookieLang = cookies().get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(cookieLang ?? '') ? (cookieLang as Lang) : 'en';
  const t = dictionary(lang);

  const stats = [
    { label: t.landingStatSupply, value: `${formatCount(Number(TOTAL_SUPPLY_NEX))} NEX` },
    { label: t.landingStatGenesis, value: `${formatCount(GENESIS_FACTS.allocationNex)} NEX` },
    { label: t.landingStatInitialReward, value: `${formatCount(GENESIS_FACTS.initialRewardNex)} NEX` },
    { label: t.landingStatHalving, value: `${formatCount(GENESIS_FACTS.halvingInterval)} ${t.block}` },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900">
            <Image src="/logo.png" alt="Nexus Architect" width={30} height={30} className="rounded-[7px]" />
            Nexus Architect
          </div>
          <div className="flex items-center gap-2">
            <LandingLanguageSwitcher lang={lang} enLabel={t.en} thLabel={t.th} />
            <Link href={`/${lang}`} className="rounded bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800">
              {t.landingExplorer}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:pt-24">
          <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            {t.landingTestnetBadge}
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl">
            {t.landingTagline}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-stone-600">{t.landingDescription}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={`/${lang}`} className="rounded bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-800">
              {t.landingExplorer} →
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 hover:border-stone-400">
              {t.landingGithub}
            </a>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-3">
          {[
            [t.landingPillarMiningTitle, t.landingPillarMiningText],
            [t.landingPillarAgentTitle, t.landingPillarAgentText],
            [t.landingPillarTreasuryTitle, t.landingPillarTreasuryText],
          ].map(([title, text]) => (
            <div key={title} className="rounded-lg border border-stone-200 bg-white p-6">
              <h2 className="text-base font-semibold text-stone-900">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{text}</p>
            </div>
          ))}
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16">
          <h2 className="text-lg font-semibold text-stone-900">{t.landingTokenomicsTitle}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="text-[11px] uppercase tracking-wide text-stone-500">{stat.label}</div>
                <div className="mt-1 text-lg font-semibold text-stone-900">{stat.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-5">
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.landingAllocationTitle}</div>
            <div className="mt-3 space-y-3">
              {allocationRows(t).map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-stone-800">{row.label}</span>
                    <span className="text-stone-600">
                      {row.pct}%{row.note ? ` · ${row.note}` : ''}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded bg-stone-100">
                    <div className="h-full rounded bg-amber-600" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <h2 className="text-lg font-semibold text-stone-900">{t.landingProductsTitle}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Link href={`/${lang}`} className="rounded-lg border border-stone-200 bg-white p-6 hover:border-amber-300">
              <h3 className="text-base font-semibold text-stone-900">{t.landingProductExplorer} →</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t.landingProductExplorerText}</p>
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 bg-white p-6 hover:border-amber-300">
              <h3 className="text-base font-semibold text-stone-900">{t.landingProductMobile} ↗</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t.landingProductMobileText}</p>
            </a>
            <a href={`${GITHUB_URL}/tree/main/packages/contracts`} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 bg-white p-6 hover:border-amber-300">
              <h3 className="text-base font-semibold text-stone-900">{t.landingProductContracts} ↗</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{t.landingProductContractsText}</p>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 px-4 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
          <span>{t.landingFooter}</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-stone-700">
            {t.landingGithub}
          </a>
        </div>
      </footer>
    </div>
  );
}
