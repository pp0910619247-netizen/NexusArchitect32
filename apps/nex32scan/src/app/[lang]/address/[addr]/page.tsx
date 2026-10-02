import { notFound } from 'next/navigation';
import type { HexAddress } from '@nexus/indexer';
import { Badge, Card, HashValue, Nex, Shell, ShortAddress, Table, langFrom } from '@/components/shell';
import { RelativeTime } from '@/components/live';
import { dictionary, timeWords } from '@/i18n';
import { recentAnswers } from '@/lib/chain-data';
import { indexer } from '@/lib/explorer';
import { formatCount, optionText, truncate } from '@/lib/format';

/** Reads the address from the path, so it stays a single serverless function. */
export default async function Page({ params }: { params: { lang: string; addr: string } }) {
  const lang = langFrom(params.lang);
  const t = dictionary(lang);
  const words = timeWords(lang);
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.addr)) notFound();
  const address = params.addr.toLowerCase();
  const explorer = await indexer();
  const [history, feed, snapshot] = await Promise.all([
    explorer.getAddressHistory(address as HexAddress),
    recentAnswers(200),
    explorer.snapshot(),
  ]);
  const answers = feed.filter((row) => row.miner.toLowerCase() === address);
  // Option texts per height: the explorer names the picked option in words,
  // never as "A"/"ก" (a letter would let anyone copy an answer).
  const optionsByHeight = new Map((snapshot.quizBlocks ?? []).map((block) => [block.height, block.options]));

  return (
    <Shell lang={lang}>
      <h1 className="mb-1 text-2xl font-bold text-stone-900">{t.addressOverview}</h1>
      <p className="mb-4 break-all font-mono text-sm text-stone-700">{address}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${t.answersByMiner} · ${formatCount(answers.length)}`} bodyClassName="">
          {answers.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">{t.noActivity}</p>
          ) : (
            <Table
              head={[t.block, t.tableChoice, t.tableResult, t.tableAge, t.tableCommitment]}
              rows={answers.map((answer) => [
                <a key="block" className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${answer.height}`}>
                  #{formatCount(answer.height)}
                </a>,
                <span key="choice" className="text-stone-800">
                  {truncate(optionText(optionsByHeight.get(answer.height) ?? [], answer.choice) ?? t.answerUnknown, 48)}
                </span>,
                <Badge key="result" tone={answer.correct ? 'solid' : 'outline'}>
                  {answer.correct ? t.correct : t.incorrect}
                </Badge>,
                <RelativeTime key="age" timestamp={answer.answeredAt} words={words} />,
                <HashValue key="commit" value={answer.commitmentHash} href={`/${lang}/block/${answer.height}`} />,
              ])}
            />
          )}
        </Card>

        <Card title={t.addressHistory} bodyClassName="">
          {history.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">{t.noData}</p>
          ) : (
            <Table
              head={[t.block, t.share, t.amount]}
              rows={history.map((item) => [
                <a key="block" className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${item.block.height}`}>
                  #{item.block.height}
                </a>,
                <ShortAddress key="share" address={item.share.address} />,
                <Nex key="amount" value={item.share.amountWei} />,
              ])}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
