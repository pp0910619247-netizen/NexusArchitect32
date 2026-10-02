import { NextResponse, type NextRequest } from 'next/server';
import type { HexHash, QuizExplorerAnswer } from '@nexus/indexer';
import { chainStatus, recentAnswers } from '@/lib/chain-data';
import { indexer } from '@/lib/explorer';

export const dynamic = 'force-dynamic';

/** JSON.stringify that survives bigint fields (impactTreasuryWei, weights…). */
function toJsonSafe(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

/**
 * One catch-all route handler for the whole read-only explorer API.
 * Splitting it into /api/explorer + /api/search cost two extra serverless
 * functions, which the free Hobby plan does not have (12 max — see DEPLOY.md).
 *
 *   GET /api/explorer      → full indexer snapshot (baked or live chain)
 *   GET /api/status        → chain-wide aggregates for the stat bar
 *   GET /api/answers?limit → newest answers (the explorer's tx feed)
 *   GET /api/search?q=…    → block height / address / tx-hash resolution
 */
export async function GET(request: NextRequest, { params }: { params: { path?: string[] } }) {
  const endpoint = (params.path ?? []).join('/');

  if (endpoint === 'explorer') {
    const snapshot = await (await indexer()).snapshot();
    // The node's block LIST carries answer counts only (details live in
    // /api/blocks/:height), so a live snapshot has no per-answer rows. Merge the
    // answer feed back in, so the payload looks the same in live and snapshot
    // mode for every consumer of /api/explorer.
    const feed = await recentAnswers(200);
    const quizBlocks = (snapshot.quizBlocks ?? []).map((block) => {
      if (block.answers || block.totalAnswers === 0) return block;
      const rows: QuizExplorerAnswer[] = feed
        .filter((row) => row.height === block.height)
        .map((row) => ({
          miner: row.miner,
          choice: row.choice,
          correct: row.correct,
          answeredAt: row.answeredAt,
          commitmentHash: row.commitmentHash as HexHash,
        }));
      return rows.length === 0 ? block : { ...block, answers: rows };
    });
    return new NextResponse(toJsonSafe({ ...snapshot, quizBlocks }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (endpoint === 'status') {
    const status = await chainStatus();
    return status
      ? NextResponse.json(status, { headers: { 'cache-control': 'no-store' } })
      : NextResponse.json({ error: 'no data source' }, { status: 503 });
  }

  if (endpoint === 'answers') {
    const rawLimit = Number(request.nextUrl.searchParams.get('limit') ?? '20');
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;
    const answers = await recentAnswers(limit);
    return NextResponse.json({ answers }, { headers: { 'cache-control': 'no-store' } });
  }

  if (endpoint === 'search') {
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (!query) return NextResponse.json({ kind: 'invalid' }, { status: 400 });
    const result = await (await indexer()).search(query);
    // A miss used to serialise to an empty body; answer with a real JSON 404.
    return result ? NextResponse.json(result) : NextResponse.json({ kind: 'notFound' }, { status: 404 });
  }

  return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 });
}
