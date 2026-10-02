import type { MetadataRoute } from 'next';
import { indexer } from '@/lib/explorer';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nex32scan.vercel.app';
const MAX_BLOCK_ENTRIES = 100;
const LOCALES = ['en', 'th'] as const;
const STATIC_PATHS = ['', '/blocks', '/token', '/impact', '/search'] as const;

/** Built from the same snapshot the pages read, so it works on a static host. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const snapshot = await (await indexer()).snapshot();
  const heights = (snapshot.quizBlocks ?? []).slice(-MAX_BLOCK_ENTRIES).map((block) => block.height);
  const entries: MetadataRoute.Sitemap = [];
  for (const lang of LOCALES) {
    for (const path of STATIC_PATHS) {
      entries.push({
        url: `${SITE_URL}/${lang}${path}`,
        changeFrequency: path === '' ? 'hourly' : 'daily',
        priority: path === '' ? 1 : 0.7,
      });
    }
    for (const height of heights) {
      entries.push({
        url: `${SITE_URL}/${lang}/block/${height}`,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  }
  return entries;
}
