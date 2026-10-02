import Link from 'next/link';
import { AddressCell, Badge, Card, Shell, Table, langFrom } from '@/components/shell';
import { RelativeTime } from '@/components/live';
import { dictionary, timeWords } from '@/i18n';
import { indexer } from '@/lib/explorer';
import { formatCount, formatNex } from '@/lib/format';
import { scheduledBlockReward } from '@/lib/reward';

/** Reads ?page=, so it stays a single serverless function (see DEPLOY.md). */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

function pageNumber(raw: string | undefined): number {
  const parsed = Number(raw ?? '1');
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export default async function Page({ params, searchParams }: { params: { lang: string }; searchParams: { page?: string } }) {
  const lang = langFrom(params.lang);
  const t = dictionary(lang);
  const words = timeWords(lang);
  const requested = pageNumber(searchParams.page);
  const snapshot = await (await indexer()).snapshot();
  const all = snapshot.quizBlocks ?? [];
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  const rows = all
    .slice()
    .reverse()
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Shell lang={lang}>
      <Card
        title={`${t.blocksPage} · ${formatCount(all.length)}`}
        action={
          <span className="flex items-center gap-3 text-xs text-stone-600">
            <span>
              {t.page} {formatCount(page)}/{formatCount(totalPages)}
            </span>
            {page > 1 ? (
              <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/blocks?page=${page - 1}`}>
                ← {t.previousBlock}
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/blocks?page=${page + 1}`}>
                {t.nextBlock} →
              </Link>
            ) : null}
          </span>
        }
        bodyClassName=""
      >
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-stone-600">{t.noData}</p>
        ) : (
          <Table
            head={[t.block, t.tableAge, t.tableMiner, t.tableAnswers, t.statDifficulty, t.tableReward]}
            rows={rows.map((block) => {
              const reward = scheduledBlockReward(block.height);
              return [
                <div key="height" className="flex flex-wrap items-center gap-2">
                  <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${block.height}`}>
                    #{formatCount(block.height)}
                  </Link>
                  {block.isHard ? <Badge tone="outline">{t.hard}</Badge> : null}
                  {block.isMilestone ? <Badge tone="solid">{t.milestone}</Badge> : null}
                </div>,
                <RelativeTime key="age" timestamp={block.timestamp} words={words} />,
                <AddressCell key="miner" address={block.miner} lang={lang} />,
                <span key="answers">
                  {formatCount(block.totalAnswers)}
                  <span className="ml-2 text-xs text-stone-600">
                    {t.correct}: {formatCount(block.correctAnswers)}
                  </span>
                </span>,
                <span key="difficulty" className="text-xs text-stone-600">
                  {formatCount(block.difficultyBits)} bits
                </span>,
                <span key="reward" className="text-stone-700">
                  {reward ? `${formatNex(reward.rewardWei)} NEX` : '—'}
                </span>,
              ];
            })}
          />
        )}
      </Card>
    </Shell>
  );
}
