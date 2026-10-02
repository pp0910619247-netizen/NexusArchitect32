# @nexus/shared

Shared building blocks for the Nexus Architect workspace: tokenomics constants (exact `bigint` wei math), block-reward calculation, domain types, and the EN/TH i18n dictionaries.

> TESTNET ONLY — values follow `AGENTS.md` §4 (tokenomics) and §5 (memory policy). Never recompute these numbers elsewhere.

## Contents

| Path | Purpose |
| --- | --- |
| `src/constants/tokenomics.ts` | Every §4 constant as `bigint` (supply, allocation, vesting, genesis, halving, reward split) |
| `src/rewards.ts` | `getBlockRewardWei` (halving + carry), `buildGenesisRewardSchedule`, `splitBlockReward` |
| `src/types/` | `Block`, `Problem`, `Answer`, `MemoryRecord`, `UserProfile`, `ImpactProposal` |
| `src/i18n/` | `en.ts` / `th.ts` (identical key structure) + type-safe `t(key, lang)` |

## Usage

```ts
import {
  TOTAL_SUPPLY_WEI,
  getBlockRewardWei,
  splitBlockReward,
  t,
} from '@nexus/shared';

getBlockRewardWei(1); // => 1051000000000000000000n (1,051 NEX in wei)
getBlockRewardWei(1_001); // => 525500000000000000000n (halved)

splitBlockReward(getBlockRewardWei(1));
// => { impactTreasuryWei: …10%, winnerWei: …40% of 90%, coMinersWei: …60% of 90% }

t('nav.explorer', 'th'); // => 'เอ็กซ์พลอเรอร์'
```

### Rules encoded here

- All coin values are `bigint` wei — no `number` ever represents an amount.
- Genesis Era (blocks 1–10,000) total emission is **provably ≤ 2,100,000 NEX** (see tests).
- Reward order per block: floor **10% → ImpactTreasury**, then of the remaining 90% **40% winner / 60% co-miners**; integer-division dust goes to the ImpactTreasury.
- Every UI string must be a key in `src/i18n/en.ts` **and** `src/i18n/th.ts` (structure enforced by `tsc` + tests).

## Commands

```bash
pnpm --filter @nexus/shared build       # emit dist/ (JS + d.ts)
pnpm --filter @nexus/shared typecheck   # tsc --noEmit (src + tests)
pnpm --filter @nexus/shared test        # vitest run
```

From the repo root: `pnpm build`, `pnpm typecheck`, `pnpm test` (Turborepo).

## Adding a translation key

1. Add it to `src/i18n/en.ts` (this defines `TranslationKey`).
2. Add the Thai string to `src/i18n/th.ts` — `tsc` fails until it exists.
3. `test/i18n.test.ts` re-checks runtime key parity in both directions.
