# Work item: EPIC-000.demo Demo seed framework, idempotence, production/demo-flag guard, seed_runs bookkeeping

- **Epic:** EPIC-000   **Owner:** wp-backend
- **Depends on:** EPIC-000.2, EPIC-000.6, EPIC-000.7   **Parallel-safe:** no
- **Covers:** AC-1, AC-2
- **Class:** C (wp-security mandatory on review — the production-boot guard is a security-relevant control)

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `packages/db/src/seed/**`
- `packages/db/test/seed.idempotence.test.ts`
- `packages/db/package.json`

## DOES NOT
- touch `packages/db/src/schema/**`, `tenancy.ts`, `context.ts`, `audit.ts`, `rls.ts`, or any migration file (those are EPIC-000.2's; `app.seed_runs` already exists from that item's migrations)
- touch `apps/api` or `apps/web` — the demo chip already renders from `instance.isDemo`, sourced from a data row this item writes, not from new code
- touch `e2e/routes.json` — no new route is introduced by seeding demo data
- touch `scripts/start.mjs` (EPIC-000.1 already wires `--demo` to shell out to the script this item creates)

## Handoff contract
`pnpm --filter @devon/db seed:demo` and `pnpm --filter @devon/db seed:reset --demo` are the only entry points. Seeding: `pg_advisory_lock(hashtext('devon.seed'))` for the run's duration + `app.seed_runs(name)` primary key + deterministic UUIDv5 demo ids + `on conflict do nothing`; a second run prints `demo seed already applied (checksum …) — 0 rows written` and exits 0. Guard (AC-2, disproof-critical): the seed refuses when `NODE_ENV === 'production'` unless `DEVON_DEMO=1` is explicitly set — implement as a single testable `assertSeedAllowed(env)` function. On success it sets `app.instance_settings.is_demo = true`. `seed:reset --demo` deletes only rows in the demo UUIDv5 namespace matching `seed_runs.name`, then the `seed_runs` row itself; never touches `audit.*`; refuses under the same production guard. Add scripts to `packages/db/package.json`: `seed:demo`, `seed:reset`, `seed:demo:matrix` (NODE_ENV × flag truth table), `counts` (per-table row counts).

## Done when
- gates profile `item` green; `migrate:verify` step 6 (seed idempotence) passes
- `wp-reviewer` and `wp-security` have no open SEV1/SEV2
- evidence: clean-clone transcript with before/after row counts identical after a second `seed:demo` run; `seed:demo:matrix` showing the seed refused under `NODE_ENV=production` without the flag and the demo chip absent on a non-demo boot
