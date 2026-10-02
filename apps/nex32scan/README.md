# NEX32SCAN

Block explorer for the Nexus Architect **knowledge chain** (Polygon Amoy testnet only).
Next.js 14 App Router + TypeScript + TailwindCSS, Thai/English UI, read-only.

## Run

```bash
pnpm --filter @nexus/nex32scan dev     # http://localhost:3000
pnpm --filter @nexus/nex32scan build   # production build
pnpm --filter @nexus/nex32scan test    # vitest
```

## Pages

| Route | What it shows |
| --- | --- |
| `/[lang]` | Stat bar, Genesis reward tiles, **Latest blocks**, **Latest answers**, latest questions |
| `/[lang]/blocks?page=n` | All sealed blocks, 25 per page |
| `/[lang]/block/[height]` | Overview table, Genesis reward split (10 / 40 / 60) **plus the block's winner** (fastest correct answer), question + options, answers in the block (the winner's row carries a `Winner` badge) |
| `/[lang]/address/[addr]` | An address's answers plus legacy mining history |
| `/[lang]/search?q=` | Block height, address, commitment hash, or words from a question |
| `/[lang]/token` | Tokenomics: supply/allocation and the Genesis halving schedule |
| `/[lang]/impact` | Impact-treasury proposals (empty until the bridge has data) |

`/[lang]/block/[height]`, `/blocks`, `/address/[addr]` and `/search` render on demand;
`/[lang]`, `/token`, `/impact`, `/_not-found` and `/sitemap.xml` are prerendered.

## Read-only API

| Endpoint | Result |
| --- | --- |
| `GET /api/explorer` | Full indexer snapshot (`stats`, `quizBlocks`, `problems`, `proposals`). In live mode the node's block list carries counts only, so the per-block `answers` from the feed are merged back in — the payload has the same shape in live and snapshot mode |
| `GET /api/status` | Chain aggregates (`503` when no data source is readable) |
| `GET /api/answers?limit=20` | Newest answers, newest first (`limit` capped at 200) |
| `GET /api/search?q=` | `200` → `{kind:"block",height}` / `{kind:"address"}` / `{kind:"transaction",hash}` · `404` `{kind:"notFound"}` · `400` `{kind:"invalid"}` |

All four share one catch-all route handler on purpose: each extra route file costs
a serverless function (see DEPLOY.md).

## Data modes

Chosen automatically from env — see DEPLOY.md for the table. `src/lib/explorer.ts`
serves the indexer views; `src/lib/chain-data.ts` serves the stat bar and the answer
feed from the same source:

- **live node** (`QUIZ_CHAIN_API_URL`): `/api/status` for aggregates, `/api/blocks`
  + `/api/blocks/:height` for the answer feed. Never used during `next build`, so
  prerendered pages stay static.
- **snapshot** (`INDEXER_SNAPSHOT_PATH` locally, otherwise the JSON baked into the
  build): `status`, `recentAnswers` and `quizBlocks[].answers` written by
  `pnpm --filter @nexus/backend chain:export`.
- Every read is fail-soft: a dead node falls back to the snapshot, and a snapshot
  without the new fields simply renders "no data" instead of zeros. The chrome
  prints “live” only when a live read actually succeeded (verified against a real
  local node: `/api/status` reports `source: "live"`).
- A fresh chain reports `lastMilestoneHeight: 0`; the parser folds that to “none”
  so the stat bar shows `—` instead of `#0`.

Reward figures on the block/token pages come from `@nexus/shared` (`getBlockRewardWei`,
`splitBlockReward`) — the same locked constants the contracts use, so the explorer can
never display a reward the chain would not schedule.

## Design (warm cream + brand gold)

The explorer is a light, easy-on-the-eyes cream theme: page `#FAF6EC` (soft
yellow-white), white cards, warm `stone` ink, and one accent — the gold of the brand
mark (`public/logo.png`, the pyramid also used as the favicon) shown in the header of
every page and on the token page. Meaning that used to ride on hue still rides on
**fill** where clarity matters:

| Badge tone | Look | Used for |
| --- | --- | --- |
| `solid` | gold fill, white text | MILESTONE, correct answer, `Winner`, revealed answer |
| `outline` | warm hairline, white fill | HARD, incorrect answer |
| `muted` | warm grey fill | not-yet-revealed metadata |
| `soft` | faint warm fill | discipline tag |

`Card`, `Table`, `Stat`, `Badge`, `AddressCell`, `HashValue` and `LINK_CLASS` (gold
underline) in `src/components/shell.tsx` are the single source of these styles; pages only
compose them. If you add a page, reuse those components instead of writing new colour
classes. `src/app/globals.css` holds the cream page base.

The chain's cadence is surfaced in the UI too: the hero line and the mobile mining tab both
state **one question per hour** (block interval `3,600 s ± 600 s`, see `@nexus/backend`).
**Answers are never shown as a letter.** The owner's rule: printing "Answer B" / "เฉลย ข" would
let anyone copy an answer without understanding the question, so every surface that names an
answer or a pick prints the option's **wording** instead — the revealed-answer badge and the feed,
and the choice column of every answers table (`optionText(options, index)` in `src/lib/format.ts`,
truncated for tables, `answerUnknown` when a legacy row has no options). The AI that mines is
expected to reason its way to the answer, not to match a letter.

## i18n

Every string lives in `src/i18n/en.ts` and `src/i18n/th.ts`; the key sets, template
placeholders and non-empty values are enforced by `src/i18n/index.test.ts`.
`fill(template, values)` substitutes `{placeholders}`; client components receive the
time words through `timeWords(lang)`.

## Tests

```bash
pnpm --filter @nexus/nex32scan typecheck
pnpm --filter @nexus/nex32scan test
```

Covers i18n parity/templates, bigint-safe NEX formatting, the Genesis reward view
model (incl. the 2,100,000 NEX cap), the status/answer parsers, and the live-read
paths against a stubbed node (live vs snapshot source, feed ordering, limit).

## Ops

- `public/robots.txt` is static; `src/app/sitemap.ts` lists both locales plus the
  newest 100 blocks.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy`, `Permissions-Policy`) and `poweredByHeader: false`
  are set in `next.config.mjs`; `X-Frame-Options` is security-relevant because the
  explorer is meant to be embedded nowhere.
- 404s render `src/app/not-found.tsx` in both languages (a not-found boundary has no
  route params).
