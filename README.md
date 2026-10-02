# Nexus Architect (NEX)

Knowledge-Mining Blockchain + Personal AI Agent (Digital Twin) + Impact Treasury.

> **TESTNET ONLY** — Polygon Amoy Testnet (chainId 80002). See `AGENTS.md` for thefull rulebook.

## Monorepo layout

```
nexus-architect/
├── apps/mobile/        # React Native (Expo) app
├── apps/nex32scan/     # Block Explorer (EN/TH)
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

## Packages

- [`packages/shared`](packages/shared/README.md) — tokenomics constants (bigint), domain types, EN/TH i18n.
- [`packages/backend`](packages/backend/README.md) — Random Hourly Block Scheduler service.
