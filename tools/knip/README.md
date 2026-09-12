# Dead-code check (knip) -- HARDENING H28.1, H20.1

## Run it

```bash
pnpm -w knip
```

(root `package.json`'s `knip` script runs `knip --config tools/knip/knip.jsonc`; `knip` itself is a
pinned root devDependency, `6.34.0`.)

## What this package (ops-tooling) did

The config this script uses (`tools/knip/knip.jsonc`) previously produced ~330 findings, almost all
false positives: `apps/api`'s and `packages/db`'s **module-loader pattern** (`apps/api/src/
module-loader.ts`, `packages/db/src/seed/module-loader.ts`) discovers and `import()`s every module by
a *runtime template-literal path* (`` `./modules/${name}/index.js` ``) so that new modules never need a
static registration list -- but that also means knip's static import graph could not see past
`app.ts`/the seed CLIs into any module at all, so every module file (repo.ts, schemas.ts, service.ts,
and every `packages/db/src/schema/*.ts` table only a seed module reaches directly) read as dead. This
package fixed that by listing `src/modules/*/index.ts` / `src/seed/modules/*.ts` as additional entry
points (real reachability, not suppression) -- see `knip.jsonc`'s comments on those two workspaces for
the full explanation. That took the finding count from ~330 to the ~106 below, all now either a real,
confirmed-by-hand finding or a documented, justified `ignoreDependencies`/`ignoreBinaries` entry in
`knip.jsonc` itself (the tool's own allowlist mechanism -- e.g. `@devon/config`, consumed only via a
`--config` CLI flag in five workspaces' `lint` scripts, never an `import`; `semgrep`/`trivy`, shelled
out to directly, never npm packages; `turbo`, spawned only as a string argument to `pnpm exec`).

**Ops-tooling could not fix what remains below** -- this package's edit scope is `infra/`, `tools/`,
`docs/ops/`, Dockerfiles, `scripts/`, and root `package.json` scripts only; every remaining finding
lives in `apps/api`, `apps/web`, or `packages/*` source, which is out of scope here. This file is the
"documented allowlist" H28.1 asks for in that case: a maker with edit access to the modules below
should triage each row (delete if genuinely dead, or add a real caller if it was meant to be used) --
re-run `pnpm -w knip` after any of `tools/knip/knip.jsonc`'s entry points change, since editing
`apps/api/src/app.ts`'s or `packages/db/src/seed/demo.ts`'s own import graph could also legitimately
shift what shows up here.

## Findings as of this package (2026-09-08), triaged

### Confirmed real dead files (4) -- highest-confidence, safe to delete
`packages/db/src/schema/accounts.ts`, `admin.ts`, `analytics.ts`, `pages.ts` -- verified by hand (not
just knip's say-so): grepped for any relative import of each file's basename anywhere under
`packages/db/src`, found none. Every *other* `schema/*.ts` file in this same package (`departments.ts`,
`projects.ts`, `work.ts`, `events.ts`, `structure.ts`) IS imported, directly, by its corresponding
`packages/db/src/seed/modules/*.ts` file -- these four are the exception, not the pattern. Likely
orphaned by parallel module development (Drizzle table definitions written for a module whose seed
data ended up modeled differently, or written ahead of a seed module that was never added). A
`packages/db` maker should confirm nothing in a not-yet-written migration/feature depends on these
before deleting.

### Unused dependencies/devDependencies (6) -- real, but package.json edits are out of scope here
| Package | Where | Note |
|---|---|---|
| `@number-flow/react` | `apps/web/package.json` | Not imported anywhere under `apps/web/src`. |
| `@tiptap/markdown` | `apps/web/package.json` | Not imported anywhere under `apps/web/src`. |
| `@radix-ui/react-visually-hidden` | `packages/ui/package.json` | Not imported anywhere under `packages/ui/src`. |
| `testcontainers` | `apps/api/package.json` (dev) | `@testcontainers/postgresql` (used, in `apps/api/test/checks/pg-fixture.ts`) already depends on this internally -- the direct entry here is very likely a redundant duplicate (H20.1 "duplicates deduped"), not a second, differently-used copy. |
| `@axe-core/playwright` | `apps/web/package.json` (dev) | Not imported under `apps/web/src` or `apps/web/test` -- likely belongs in `e2e/package.json` instead (a11y testing lives there), misplaced rather than truly unused. |
| `tailwindcss` | `apps/web/package.json` (dev) | Almost certainly a false positive, not a real removal candidate: Tailwind v4 is consumed via `@import "tailwindcss"` inside a `.css` file, and this config does not register a CSS compiler for knip (seen in `pnpm -w knip`'s own "Configuration hints" -- `.css apps/web: Compiled extension excluded by project`). Wiring a CSS compiler into `knip.jsonc` would resolve this without touching `apps/web` at all, and is a reasonable follow-up for whoever next edits this config. |

### Unused exports / unused exported types (~96)
The full current list is in this package's evidence file (`agentic/ledger/hardening/
2026-09-08T06-45-00-05-00/ops-tooling.md`, "H28.1" section) and reproducible any time via `pnpm -w
knip`. Not triaged item-by-item here -- at this volume, doing so honestly requires the same domain
context the module's own maker already has (e.g. is an exported `*Dto` type part of a deliberate public
contract another package is expected to grow into importing, or dead from a refactor). Two patterns
worth a future maker's attention, noticed while reading this list:
- Several `apps/web/src/features/*/schemas.ts` types (`EventCategory`, `FeedbackDto`, ...) share an
  exact name with a same-named type already exported from the corresponding `apps/api/src/modules/*/
  schemas.ts` -- these read as independently hand-duplicated contracts (apps/web does not import types
  from apps/api directly in this codebase's architecture) rather than dead code; still worth a maker
  confirming they haven't drifted apart.
- `_internal` exports (`apps/api/src/modules/analytics/aggregate.ts`, `.../notifications/jobs.ts`) are
  a common "exported only for that module's own test file to reach into" pattern -- check whether the
  test that needed this actually still does before removing.
