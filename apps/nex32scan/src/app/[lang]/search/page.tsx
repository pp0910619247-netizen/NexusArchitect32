import Link from 'next/link';
import { AddressCell, Card, HashValue, Shell, langFrom } from '@/components/shell';
import { SearchBox } from '@/components/search-box';
import { dictionary, fill } from '@/i18n';
import { findAnswerByCommitment } from '@/lib/chain-data';
import { indexer } from '@/lib/explorer';
import { formatCount, truncate } from '@/lib/format';
import type { QuizExplorerBlock } from '@nexus/indexer';

// Reads ?q= from the request, so it stays a single serverless function.
export const dynamic = 'force-dynamic';

const MAX_HITS = 25;

/** Keyword search over the sealed quiz blocks (prompt / options / discipline). */
function textHits(blocks: readonly QuizExplorerBlock[], query: string): QuizExplorerBlock[] {
  const needle = query.toLowerCase();
  return blocks
    .filter(
      (block) =>
        block.promptTh.toLowerCase().includes(needle) ||
        block.promptEn.toLowerCase().includes(needle) ||
        block.disciplineTh.toLowerCase().includes(needle) ||
        block.disciplineEn.toLowerCase().includes(needle) ||
        block.options.some((option) => option.toLowerCase().includes(needle)),
    )
    .slice(-MAX_HITS)
    .reverse();
}

export default async function Page({ params, searchParams }: { params: { lang: string }; searchParams: { q?: string } }) {
  const lang = langFrom(params.lang);
  const t = dictionary(lang);
  const query = (searchParams.q ?? '').trim();
  const explorer = await indexer();

  // A 64-hex query is a commitment hash: resolve it to the block that sealed it
  // (the node keeps no hash index, so this scans the newest answers).
  const commitment = /^0x[0-9a-fA-F]{64}$/.test(query) ? await findAnswerByCommitment(query) : undefined;
  const direct = !commitment && query ? await explorer.search(query) : undefined;
  const hits =
    !commitment && !direct && query ? textHits((await explorer.snapshot()).quizBlocks ?? [], query) : [];

  return (
    <Shell lang={lang}>
      <h1 className="mb-4 text-2xl font-bold text-stone-900">{t.search}</h1>
      <div className="mb-2 max-w-2xl">
        <SearchBox placeholder={t.searchHint} lang={lang} />
      </div>
      <p className="mb-6 text-xs text-stone-500">{t.searchHint}</p>

      {query ? (
        <p className="mb-4 text-sm text-stone-600">
          {t.resultsFor}: <b className="text-stone-900">{truncate(query, 80)}</b>
        </p>
      ) : null}

      {commitment ? (
        <Card title={t.resultsTitle}>
          <p className="text-sm text-stone-700">{fill(t.answerFoundInBlock, { height: formatCount(commitment.height) })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <HashValue value={commitment.commitmentHash} href={`/${lang}/block/${commitment.height}`} />
            <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${commitment.height}`}>
              {t.block} #{formatCount(commitment.height)} →
            </Link>
            <AddressCell address={commitment.miner} lang={lang} />
          </div>
        </Card>
      ) : null}

      {direct?.kind === 'block' ? (
        <Card title={t.resultsTitle}>
          <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${direct.height}`}>
            {t.block} #{direct.height} →
          </Link>
        </Card>
      ) : null}

      {direct?.kind === 'address' ? (
        <Card title={t.resultsTitle}>
          <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/address/${direct.address.toLowerCase()}`}>
            {t.addressOverview}: <span className="font-mono text-xs">{direct.address}</span> →
          </Link>
        </Card>
      ) : null}

      {direct?.kind === 'transaction' ? (
        <Card title={t.resultsTitle}>
          <p className="text-sm text-stone-700">
            {t.transactionHash}: <code className="break-all font-mono text-xs">{direct.hash}</code>
          </p>
          <p className="mt-1 text-xs text-stone-500">{t.notFound}</p>
        </Card>
      ) : null}

      {hits.length > 0 ? (
        <div className="grid gap-3">
          {hits.map((block) => (
            <Card key={block.height}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Link className="text-stone-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700" href={`/${lang}/block/${block.height}`}>
                  {t.block} #{formatCount(block.height)} →
                </Link>
                <span className="text-xs text-stone-600">
                  {lang === 'th' ? block.disciplineTh : block.disciplineEn}
                </span>
              </div>
              <p className="text-sm text-stone-800">{truncate(lang === 'th' ? block.promptTh : block.promptEn, 180)}</p>
              <p className="mt-1 text-xs text-stone-500">
                {t.publicAnswer}:{' '}
                {block.revealedAnswerIndex === null
                  ? t.notRevealed
                  : truncate(block.revealedAnswerText ?? t.answerUnknown, 80)}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      {query && !commitment && !direct && hits.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">{t.noResults}</p>
        </Card>
      ) : null}
    </Shell>
  );
}
