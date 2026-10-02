import Link from 'next/link';
import { AddressCell, Badge, Card, HashValue, Shell, Table, langFrom } from '@/components/shell';
import { RelativeTime } from '@/components/live';
import { SearchBox } from '@/components/search-box';
import { dictionary, fill, timeWords } from '@/i18n';
import { chainStatus, recentAnswers } from '@/lib/chain-data';
import { indexer } from '@/lib/explorer';
import { formatCount, formatNex, optionText, truncate } from '@/lib/format';
import { GENESIS_FACTS, scheduledBlockReward } from '@/lib/reward';

// Prerendered for both locales at build time → served as static HTML with no
// serverless function (Hobby plan allows only 12 — see DEPLOY.md).
export function generateStaticParams() { return [{ lang: 'en' }, { lang: 'th' }]; }
export const dynamicParams = false; // no fallback serverless function for other locales

const LATEST = 10;
const LATEST_QUESTIONS = 5;

/** Scheduled Genesis reward of a height as a short label, or a dash outside it. */
function rewardLabel(height: number): string {
  const reward = scheduledBlockReward(height);
  return reward ? `${formatNex(reward.rewardWei)} NEX` : '—';
}

export default async function Page({ params }: { params: { lang: string } }) {
  const lang = langFrom(params.lang);
  const t = dictionary(lang);
  const words = timeWords(lang);
  const [snapshot, status, answers] = await Promise.all([
    (await indexer()).snapshot(),
    chainStatus(),
    recentAnswers(LATEST),
  ]);
  const blocks = (snapshot.quizBlocks ?? []).slice(-LATEST).reverse();
  const questions = blocks.slice(0, LATEST_QUESTIONS);
  // Option lists per height, so the answer feed can name the picked option.
  const optionsByHeight = new Map((snapshot.quizBlocks ?? []).map((block) => [block.height, block.options]));
  void status;

  return (
    <Shell lang={lang}>
      <section className="mb-6 rounded-lg border border-stone-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-stone-900">{t.brand}</h1>
        <p className="mt-1 text-sm text-stone-600">{t.siteTagline}</p>
        <div className="mt-4 max-w-2xl">
          <SearchBox placeholder={t.searchHint} lang={lang} />
        </div>
        <p className="mt-2 text-xs text-stone-600">{t.cadenceNote}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-stone-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.initialReward}</div>
            <div className="mt-1 text-lg font-semibold text-stone-900">
              {formatCount(GENESIS_FACTS.initialRewardNex)} NEX
            </div>
            <div className="text-xs text-stone-600">{fill(t.rewardAtHeight, { height: formatCount(GENESIS_FACTS.startBlock) })}</div>
          </div>
          <div className="rounded border border-stone-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.halvingInterval}</div>
            <div className="mt-1 text-lg font-semibold text-stone-900">
              {formatCount(GENESIS_FACTS.halvingInterval)} {t.block}
            </div>
            <div className="text-xs text-stone-600">
              {fill(t.genesisRange, {
                from: formatCount(GENESIS_FACTS.startBlock),
                to: formatCount(GENESIS_FACTS.endBlock),
              })}
            </div>
          </div>
          <div className="rounded border border-stone-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{t.genesisEra}</div>
            <div className="mt-1 text-lg font-semibold text-stone-900">
              {formatCount(GENESIS_FACTS.allocationNex)} NEX
            </div>
            <Link className="text-xs text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/token`}>
              {t.tokenomics} →
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={t.latestBlocks}
          action={
            <Link className="text-xs text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/blocks`}>
              {t.viewAllBlocks} →
            </Link>
          }
          bodyClassName=""
        >
          {blocks.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">{t.noData}</p>
          ) : (
            <Table
              head={[t.block, t.tableAge, t.tableMiner, t.tableAnswers, t.tableReward]}
              rows={blocks.map((block) => [
                <div key="height" className="flex flex-wrap items-center gap-2">
                  <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${block.height}`}>
                    #{formatCount(block.height)}
                  </Link>
                  {block.isHard ? <Badge tone="outline">{t.hard}</Badge> : null}
                  {block.isMilestone ? <Badge tone="solid">{t.milestone}</Badge> : null}
                </div>,
                <RelativeTime key="age" timestamp={block.timestamp} words={words} />,
                <AddressCell key="miner" address={block.miner} lang={lang} />,
                <span key="answers" title={`${t.correct}: ${formatCount(block.correctAnswers)}`}>
                  {formatCount(block.totalAnswers)}
                </span>,
                <span key="reward" className="text-stone-700">
                  {rewardLabel(block.height)}
                </span>,
              ])}
            />
          )}
        </Card>

        <Card title={t.latestAnswers} bodyClassName="">
          {answers.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">{t.noData}</p>
          ) : (
            <Table
              head={[t.tableCommitment, t.tableAge, t.block, t.tableMiner, t.tableResult]}
              rows={answers.map((answer) => [
                <HashValue key="commit" value={answer.commitmentHash} href={`/${lang}/block/${answer.height}`} />,
                <RelativeTime key="age" timestamp={answer.answeredAt} words={words} />,
                <Link key="block" className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${answer.height}`}>
                  #{formatCount(answer.height)}
                </Link>,
                <AddressCell key="miner" address={answer.miner} lang={lang} />,
                <div key="result" className="flex items-center gap-2">
                  <Badge tone={answer.correct ? 'solid' : 'outline'}>{answer.correct ? t.correct : t.incorrect}</Badge>
                  <span className="text-xs text-stone-600">
                    {t.tableChoice}: {truncate(optionText(optionsByHeight.get(answer.height) ?? [], answer.choice) ?? t.answerUnknown, 40)}
                  </span>
                </div>,
              ])}
            />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={t.recentProblems} bodyClassName="">
          {questions.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">{t.noData}</p>
          ) : (
            <Table
              head={[t.block, t.disciplines, t.problem, t.tableResult]}
              rows={questions.map((block) => [
                <Link key="height" className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${block.height}`}>
                  #{formatCount(block.height)}
                </Link>,
                <span key="discipline" className="text-xs text-stone-600">
                  {lang === 'th' ? block.disciplineTh : block.disciplineEn}
                </span>,
                <span key="prompt" className="text-stone-700" title={lang === 'th' ? block.promptTh : block.promptEn}>
                  {truncate(lang === 'th' ? block.promptTh : block.promptEn, 110)}
                </span>,
                block.revealedAnswerIndex === null ? (
                  <span key="result" className="text-xs text-stone-600">
                    {t.notRevealed}
                  </span>
                ) : (
                  <Badge key="result" tone="solid">
                    {t.publicAnswer}: {truncate(block.revealedAnswerText ?? t.answerUnknown, 60)}
                  </Badge>
                ),
              ])}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
