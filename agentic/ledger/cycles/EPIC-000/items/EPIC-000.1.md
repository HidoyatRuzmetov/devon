# Work item: EPIC-000.1 Toolchain, workspace, CI, .env.example, setup.mjs

- **Epic:** EPIC-000   **Owner:** wp-devops
- **Depends on:** none   **Parallel-safe:** no (root files everyone else reads)
- **Covers:** AC-1, AC-14
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `.gitattributes`
- `.npmrc`
- `.env.example`
- `setup.mjs`
- `scripts/start.mjs`
- `packages/config/**`
- `.github/workflows/ci.yml`
- `README.md`

## DOES NOT
- create any file under `apps/**` or other `packages/*/src/**` — those belong to the items that own those packages
- add the nightly release job to `ci.yml` beyond a placeholder comment (that job is EPIC-000.10's)
- implement the demo seed logic — `scripts/start.mjs` only conditionally shells out to `pnpm --filter @devon/db seed:demo`; EPIC-000.demo writes that script

## Handoff contract
Root `package.json` declares `packageManager` and `engines.node`. `scripts/start.mjs` is the body of `pnpm start`: `docker compose up -d postgres valkey` → wait for readiness → apply migrations → start api+web → if `--demo`/`DEVON_DEMO=1`, run `pnpm --filter @devon/db seed:demo` and propagate its exit code. `.env.example` carries the full variable set from design.md §7.4 (NODE_ENV, DEVON_PUBLIC_URL, ports, POSTGRES_*, DATABASE_URL, MIGRATION_DATABASE_URL, VALKEY_URL, SESSION_*, CSRF_SECRET, AUDIT_ANCHOR_PATH, DEVON_SETUP_REMOTE, DEVON_DEMO, DEVON_E2E, SENTINEL_*) — nobody else edits this file. `packages/config/test/workspace-scripts.test.ts` enumerates `pnpm-workspace.yaml` and fails if any package lacks `typecheck`/`lint`/`test:unit`/`build` — every downstream item must declare all four, even as stubs, from day one. README documents the dual bootstrap path (`corepack enable && pnpm setup` OR `node setup.mjs` for a Node-only machine) and the idempotent-seed guarantee.

## Done when
- gates profile `item` green (mainly `lint`/`secrets`/`build` on `packages/config`, plus a CI dry-run)
- `wp-reviewer` has no open SEV1/SEV2
- evidence: a clean-clone dry run exits 0 with no manual step beyond `.env` copy; `workspace-scripts.test.ts` exists and starts enforcing as soon as the first package lands
