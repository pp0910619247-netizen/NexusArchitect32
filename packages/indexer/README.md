# @nexus/indexer

Stateless explorer data service. It reads immutable public Problem Bank YAML and an optional indexed-event snapshot supplied by a server-side chain event adapter. It never calls an RPC endpoint itself.

## Commands

```bash
pnpm --filter @nexus/indexer build
pnpm --filter @nexus/indexer test
```

Set `NEX_PROBLEM_BANK_ROOT` and, optionally, `NEX_INDEXED_EVENTS_FILE` in the deployment environment. Secrets and private Problem Bank files are never read by this package.
