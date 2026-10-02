import Image from 'next/image';
import { Card, Shell, Table, langFrom } from '@/components/shell';
import { dictionary, fill } from '@/i18n';
import { formatCount, formatNex } from '@/lib/format';
import { GENESIS_FACTS, genesisEraRows } from '@/lib/reward';

// Static for both locales (pure constants, no request data).
export function generateStaticParams() { return [{ lang: 'en' }, { lang: 'th' }]; }
export const dynamicParams = false;

const ALLOCATION = [
  { key: 'allocMining', share: 50 },
  { key: 'allocSale', share: 30 },
  { key: 'allocTeam', share: 20 },
] as const;

export default async function Page({ params }: { params: { lang: string } }) {
  const lang = langFrom(params.lang);
  const t = dictionary(lang);
  const eras = genesisEraRows();
  const totalSupply = 21_000_000;

  return (
    <Shell lang={lang}>
      <div className="mb-4 flex items-center gap-3">
        <Image src="/logo.png" alt={t.brand} width={44} height={44} className="rounded-xl ring-1 ring-amber-300" />
        <h1 className="text-2xl font-bold text-stone-900">{t.tokenomics}</h1>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t.totalSupply}>
          <p className="text-2xl font-semibold text-stone-900">{formatCount(totalSupply)} NEX</p>
          <ul className="mt-4 space-y-2 text-sm">
            {ALLOCATION.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-4">
                <span className="text-stone-700">{t[row.key]}</span>
                <span className="text-stone-900">
                  {row.share}% · {formatCount((totalSupply * row.share) / 100)} NEX
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t.genesisEra}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-stone-600">{t.blockRange}</dt>
            <dd className="text-right text-stone-900">
              {fill(t.genesisRange, {
                from: formatCount(GENESIS_FACTS.startBlock),
                to: formatCount(GENESIS_FACTS.endBlock),
              })}
            </dd>
            <dt className="text-stone-600">{t.initialReward}</dt>
            <dd className="text-right text-stone-900">{formatCount(GENESIS_FACTS.initialRewardNex)} NEX</dd>
            <dt className="text-stone-600">{t.halvingInterval}</dt>
            <dd className="text-right text-stone-900">
              {formatCount(GENESIS_FACTS.halvingInterval)} {t.block}
            </dd>
            <dt className="text-stone-600">{t.genesisEra}</dt>
            <dd className="text-right text-stone-900">{formatCount(GENESIS_FACTS.allocationNex)} NEX</dd>
          </dl>
          <p className="mt-4 text-xs text-stone-500">{t.tokenNote}</p>
        </Card>
      </div>

      <Card title={t.halvingTable} bodyClassName="">
        <Table
          head={[t.eraColumn, t.blocksColumn, t.perBlockColumn, t.eraTotalColumn]}
          rows={eras.map((era) => [
            <span key="era" className="text-stone-900">
              #{era.era}
            </span>,
            <span key="blocks" className="font-mono text-xs text-stone-700">
              {formatCount(era.fromBlock)}–{formatCount(era.toBlock)}
            </span>,
            <span key="per-block" className="text-stone-900">
              {formatNex(era.rewardWei)} NEX
            </span>,
            <span key="total" className="text-stone-700">
              {formatNex(era.eraTotalWei)} NEX
            </span>,
          ])}
        />
      </Card>
    </Shell>
  );
}
