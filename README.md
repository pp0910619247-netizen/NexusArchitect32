# Nexus Architect (NEX)

Knowledge-Mining Blockchain + Personal AI Agent (Digital Twin) + Impact Treasury.

> **TESTNET ONLY** — Polygon Amoy Testnet (chainId 80002). See `AGENTS.md` for the
> full rulebook. Repository: https://github.com/pp0910619247-netizen/NexusArchitect32

## What's here

- **Landing page + explorer** — `apps/nex32scan`: a project landing page at `/`
  (English / Thai) and the block explorer at `/en` and `/th`.
- **Mobile app** — `apps/mobile` (React Native + Expo + TypeScript): chat, knowledge
  mining, the Memory Book (Core + 30-day Rolling), SecureStore API keys.
- **Smart contracts** — `packages/contracts` (Solidity 0.8.24 + Foundry): NexToken,
  NexusMining, ImpactTreasury, TeamVesting, MilestoneAnchor, QuizQuestionSet.
- **Backend** — `packages/backend` (Fastify): Problem Bank API, admin injection,
  Random Hourly BlockScheduler, world-v1 / world-v2 question banks.
- **Indexer** — `packages/indexer`: reads chain events for the explorer.
- **Shared** — `packages/shared`: locked tokenomics constants (bigint), reward math,
  domain types, EN/TH i18n.

## Monorepo layout

```
nexus-architect/
├── apps/mobile/        # React Native (Expo) app
├── apps/nex32scan/     # Landing page + Block Explorer (EN/TH)
├── packages/contracts/ # Solidity + Foundry tests
├── packages/backend/   # Problem Bank API + admin injection + BlockScheduler
├── packages/indexer/   # Reads chain events for the explorer
├── packages/shared/    # types, constants, i18n dictionaries
└── AGENTS.md
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build every package (Turborepo pipeline) |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Run all Vitest suites |
| `pnpm lint` | ESLint across apps and packages |

## Packages

- [`packages/shared`](packages/shared/README.md) — tokenomics constants (bigint), domain types, EN/TH i18n.
- [`packages/backend`](packages/backend/README.md) — Random Hourly Block Scheduler service.
- [`apps/nex32scan`](apps/nex32scan/README.md) — landing page + block explorer.
