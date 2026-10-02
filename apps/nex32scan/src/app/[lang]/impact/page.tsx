import { Shell, ShortAddress, Nex } from '@/components/shell';
import { dictionary } from '@/i18n';
import { indexer } from '@/lib/explorer';
// Static for both locales (no request data is read).
export function generateStaticParams() { return [{ lang: 'en' }, { lang: 'th' }]; }
export const dynamicParams = false;
export default async function Page({ params }: { params: { lang: string } }) { const lang = params.lang === 'th' ? 'th' : 'en'; const t = dictionary(lang); const proposals = await (await indexer()).getProposals(); return <Shell lang={lang}><h1 className="mb-6 text-3xl">{t.impact}</h1>{proposals.length === 0 ? <p>{t.noData}</p> : <div className="space-y-4">{proposals.map((proposal) => <article className="rounded border border-stone-200 p-5" key={proposal.id.toString()}><div className="flex justify-between"><b>{t.proposals} #{proposal.id.toString()}</b><span>{proposal.status}</span></div><p><ShortAddress address={proposal.beneficiary} /></p><p>{t.target}: <Nex value={proposal.targetAmountWei} /></p>{proposal.status === 'PINNED' && <p>{t.pinned}</p>}<div className="mt-3 h-2 rounded bg-stone-100"><div className="h-2 rounded bg-stone-900" style={{ width: `${Number(proposal.allocatedAmountWei * 100n / (proposal.targetAmountWei || 1n))}%` }} /></div><p>{t.votes}: {proposal.votes.length}</p></article>)}</div>}</Shell>; }
