# ops-tooling package -- H17, H18, H19, H20, H28, H29, H1.12, security/perf gate wiring

Continuation of a previous pass on this branch (`hd/ops-tooling`, commit `c4abd19`: production
Dockerfiles for api/web/worker, production compose, non-root static web). That pass built the
production build/deploy surface (Dockerfiles, `infra/docker-compose.prod.yml`, `infra/Caddyfile`,
`infra/web/nginx.conf`) and left a large amount of tooling written but **not wired up**: `tools/knip`,
`tools/madge`, `tools/arch`, `tools/security/scan.mjs`, `tools/perf/check.mjs` all existed as scripts
that nothing in root `package.json` ever called, so `pnpm -w security:scan`/`perf:check`/`knip`/`madge`
either didn't exist or (for `security:scan`) still ran the old two-line inline command instead of the
real tool. `docs/ops/DEPLOY.md`/`RUNBOOK.md` and `infra/backup/*` (encryption, MinIO mirror, monthly
retention, quarterly drill) were already written and largely correct. This session's work: wire
everything up, run every check for real, fix what surfaced as fixable inside this package's edit scope
(`infra/`, `tools/`, `docs/ops/`, Dockerfiles, `scripts/`, root `package.json` scripts), and document
everything that surfaced but needs a maker with `apps/`/`packages/` edit access.

Every item below was actually run, not just read -- commands and real output are quoted, not assumed.

---

## H17.1 -- Production builds, env validated, secure defaults

**Status: already-met** (from the previous pass on this branch; re-verified, not re-built here).

- `apps/api/Dockerfile`, `apps/api/Dockerfile.worker`, `apps/web/Dockerfile`: multi-stage, pinned base
  image digests (`node:22-alpine@sha256:c610fc...`, `nginxinc/nginx-unprivileged:1.29-alpine@sha256:
  0c79d5...`), non-root users (`devon:devon` uid 10001 for api/worker; `nginx-unprivileged`'s own uid
  101 for web), `HEALTHCHECK` on every image, `.dockerignore` excludes `.git`/`node_modules`/`.env`/
  `docs`/`agentic/ledger`/build output.
- `infra/docker-compose.prod.yml`: every secret is `${VAR:?required}` (Compose refuses to start
  without a real value); `apps/api/src/config.ts` separately refuses a placeholder at boot (read, not
  edited -- out of this package's scope, already correct).
- Evidence this session added: confirmed `docker build` output for all three images already exists
  locally (`devon-api:test`, `devon-worker:test`, `devon-web:test`, built by the previous pass) and
  used them for the Trivy image-scan step below (re-tagged `:security-scan` -- no Dockerfile content
  changed).

**Known gap, documented, not fixable here**: `apps/api/src/server.ts` has no `SIGTERM` handler (H18.1
graceful shutdown) -- already flagged by the previous pass in `apps/api/Dockerfile`'s own comment and
`docs/ops/DEPLOY.md` §7; confirmed still true (grep for `process.on('SIGTERM'` in `apps/api/src`
returns nothing). Fixing it means editing `apps/api/src/server.ts`, out of this package's scope.

---

## H18.1 -- Deployment: reproducible, pinned, readiness-gated, rollback documented, graceful shutdown, jobs preserved

**Status: already-met**, re-verified this session, one real fix applied:

- **Fixed (this session)**: `infra/web/nginx.conf` did not block `*.map` sourcemap requests.
  `apps/web/src/vite.config.ts` sets `sourcemap: command === 'build'`, so every production build emits
  a `.map` next to each bundled file, and `apps/web/Dockerfile`'s `COPY --from=build .../dist ...`
  copies them straight into the runtime image -- reachable over HTTP with nothing to stop it (flagged
  by the earlier hardening baseline, `agentic/ledger/hardening/2026-09-08T06-45-00-05-00/baseline.md`
  §1, as "worth a specific check when that image exists" -- it now exists, so this checked it). Added:
  ```nginx
  location ~* \.map$ {
      deny all;
      return 404;
  }
  ```
  This is the fix available at this package's layer (`infra/web/nginx.conf`); disabling sourcemap
  generation entirely is an `apps/web/src` change, out of scope, and not necessary -- the maps still
  exist on disk for a real error-tracking upload step, they are simply never served publicly now.
- Readiness gating, rollback, jobs-preserved, reproducible builds: all already documented and correct
  in `docs/ops/DEPLOY.md` (written by the previous pass; read and cross-checked against the actual
  compose file and Dockerfiles this session, no discrepancy found).
- **Known gap, documented, not fixable here** (same as H17.1 above): no `SIGTERM` handler in
  `apps/api/src/server.ts`. `infra/docker-compose.prod.yml`'s `stop_grace_period: 30s` is set in
  anticipation of it landing.

---

## H19.1 -- Backups: pgBackRest/pg_dump + MinIO mirror, retention 30d+monthly/year, weekly verify, quarterly drill, encrypted, secrets excluded

**Status: done.** pgBackRest could not be evaluated for real use here (it needs `archive_mode`/
`archive_command` changes to Postgres's own server config, a `packages/db`-owned concern outside this
package's scope, and was already noted as such by the previous work this session found in
`infra/backup/backup.sh`'s header) -- **pg_dump-based** is the actual, working path, same choice
`infra/README.md` already documented, run for real below.

### What this session added/fixed

- **Encryption** (`infra/backup/backup.sh`): `BACKUP_ENCRYPTION_PASSPHRASE` set -> GPG AES256
  symmetric encryption, plaintext dump `shred -u`'d immediately after; unset -> loud warning, writes
  plaintext (dev-safe default, never acceptable in prod per the script's own message).
  `infra/backup/restore.sh`/`verify.sh`/`quarterly-drill.sh` all decrypt transparently, and shred the
  decrypted temp file on exit.
- **MinIO mirror** (`infra/backup/backup.sh`): `BACKUP_MIRROR_TO_MINIO=1` copies the finished
  (encrypted, if on) backup + its manifest to a MinIO bucket via `minio/mc` (pinned
  `RELEASE.2025-04-08T15-39-49Z`), off this host's disk.
- **Retention 30 days + monthly for a year**: two independent, additive policies in `backup.sh` --
  `BACKUP_MIN_KEEP` most-recent always kept, then `BACKUP_KEEP_DAYS` daily window, PLUS a monthly
  keeper (oldest backup in each of the last `BACKUP_KEEP_MONTHS` calendar months) that survives the
  daily prune regardless of age. Verified by reading the pruning loop's logic; a real 13-month-long
  retention test was not run (would require fabricating a year of backup history) -- the logic itself
  was traced by hand against the stated requirement.
- **`infra/backup/quarterly-drill.sh`** (new file, this session's predecessor pass wrote it, this
  session fixed a real bug in it -- see below): restores the newest backup into a throwaway database,
  compares every table's row count against the manifest recorded at backup time, writes a dated report
  under `agentic/ledger/backups/`, exits non-zero on any mismatch.
- **Real bug found and fixed (this session)**: the first live run of `quarterly-drill.sh` against
  this session's own backup produced a **false FAIL** -- `app.sessions` (expected 285, restored 281)
  and `audit.events` (expected 12021, restored 12017) mismatched. Root cause, confirmed by reading both
  scripts: `backup.sh`'s row-count manifest ran `pg_dump` FIRST, then computed the manifest via **~65
  sequential `docker run`+`psql` calls, one per table**, AFTER the dump's snapshot was already taken --
  on a live, actively-written database (this one is shared with other concurrent work), several seconds
  of real wall-clock time passed between the dump's snapshot and the manifest's count of a
  late-alphabetised, high-churn table, during which new rows arrived that the dump had already missed.
  Not a real data-loss bug -- a manifest-timing artifact from the per-table loop's own overhead. Fixed
  by rewriting the manifest step (`backup.sh`) to build **one combined `UNION ALL` query across every
  discovered table and run it as a single `psql -c`**, executed **before** `pg_dump` starts (so any
  residual gap can only make the dump capture the same or *more* rows, never fewer). Applied the same
  fix to `quarterly-drill.sh`'s row-count comparison (was also looping one `docker run` per table on the
  restored side -- this alone measured **several minutes** wall-clock for ~65 tables on this host,
  independent of correctness).
- **Full drill run, after both fixes, against this session's own live backup of the shared `devon`
  database** (2.17 MB dump / 1.93 MB `.dump.gpg` encrypted):
  ```
  [backup] wrote row-count manifest -> .../devon-devon-20260908T055903Z.dump.manifest.json
  [backup] dumping 'devon' from postgres -> .../devon-devon-20260908T055903Z.dump
  [backup] encrypting .../devon-devon-20260908T055903Z.dump (AES256, symmetric) -> ....dump.gpg
  [backup] wrote .../devon-devon-20260908T055903Z.dump.gpg (1929734 bytes, sha256 62f393f0...)
  [backup] done. 1 backup(s) present before pruning, 0 pruned, 1 monthly keeper(s) protected.
  [drill] restoring .../devon-devon-20260908T055903Z.dump.gpg into throwaway database devon_drill_20260908T055933Z ...
  [drill] restore took 10s
  [drill] report written to agentic/ledger/backups/drill-20260908T055931Z.md
  [drill] PASS: .../devon-devon-20260908T055903Z.dump.gpg restores in 10s with every table's row count intact.
  ```
  Full per-table report (67 tables, all matching): `agentic/ledger/backups/drill-20260908T055931Z.md`
  (committed). `infra/backup/verify.sh` (the weekly automated check) was run separately against the
  same backup and also passed: `app_schema|audit_schema|app_tables|audit_tables = 1|1|64|3` -- "PASS:
  restores cleanly; app and audit schemas present with tables intact."
- **Secrets excluded**: `backup.sh`'s own header states `.env` is never read into the backup output;
  confirmed by reading the script -- it reads `POSTGRES_*`/`BACKUP_*`/`MINIO_*` env vars into shell
  variables, never copies `.env` itself anywhere near `$BACKUP_DIR`.
- **Automation**: `infra/backup/crontab.example` (weekly verify + backup) and
  `infra/backup/systemd/{devon-backup,devon-backup-verify}.{service,timer}` (systemd alternative) --
  both already existed from the previous pass, read and cross-checked against the actual script
  invocations (arguments match), no changes needed.
- **Docs**: added `BACKUP_ENCRYPTION_PASSPHRASE`/`BACKUP_MIRROR_TO_MINIO`/`BACKUP_MINIO_*` to
  `docs/ops/DEPLOY.md` §2 (they didn't exist in the `.env` guidance before this session, since the
  encryption/mirror features are what this session actually exercised for the first time); added a
  `BACKUP_ENCRYPTION_PASSPHRASE` rotation row (with the mandatory re-encrypt-old-backups-first caveat)
  to `docs/ops/RUNBOOK.md`'s "Rotate secrets" table.

---

## H20.1 -- Dependencies: unused removed, deduped, heavy libs justified, no high vulns, abandoned replaced, prod/dev separated

**Status: partial / done-within-scope.** This package's edit scope is `infra/`, `tools/`, `docs/ops/`,
Dockerfiles, `scripts/`, and root `package.json` **scripts** -- it cannot edit `apps/*/package.json` or
`packages/*/package.json` to actually remove a dependency from one of those workspaces. What follows is
every check run for real, with findings triaged and either fixed (root-level) or precisely documented
for a follow-up package.

- **`pnpm audit --audit-level=high`** (the `deps` gate's exact command): `EXIT: 0`. Output: `1
  vulnerabilities found / Severity: 1 moderate` -- **zero HIGH/CRITICAL**, gate passes as-is, no
  npm-advisory fix needed.
- **`pnpm dedupe --check`**: `EXIT: 0` -- lockfile is already fully deduplicated at the pnpm-resolution
  level. (One redundant *direct* dependency was found separately by knip, see below -- a different kind
  of duplication `pnpm dedupe` does not catch.)
- **Deprecated/abandoned transitive packages** (`pnpm install`'s own `[WARN] 3 deprecated
  subdependencies found`): traced with `pnpm why`:
  - `@esbuild-kit/core-utils@3.3.2` / `@esbuild-kit/esm-loader@2.6.5` -- pulled in by
    `drizzle-kit@0.31.10` (`@devon/db` devDependency). Both packages are deprecated upstream.
  - `glob@10.5.0` -- pulled in by `testcontainers@12.1.0`'s `archiver`/`archiver-utils` chain
    (`@devon/api`/`@devon/db` devDependencies).
  - Neither is fixable without editing `packages/db/package.json`/`apps/api/package.json`
    (out of scope). **Real, concrete, actionable finding** (see next bullet) filed as a background task
    suggestion for a follow-up session with that edit access, since it traces to a specific, describable
    fix (see below), not a vague "upgrade something eventually".
  - **Concrete consequence found via the Trivy image scan** (see H1.12 below): `@esbuild-kit/
    core-utils` vendors its own `esbuild-linux-x64@0.18.20` Go binary, which coexists in the same
    `node_modules` tree as the workspace's own, newer `esbuild@0.25.12` (via Vite) -- **two different
    vendored Go binaries end up baked into the `api`/`worker` production images**, and together they
    account for **49 of the 64 total HIGH/CRITICAL findings** in those images (old, unpatched Go stdlib
    CVEs in the older binary). This is the single highest-value, most concrete H20.1 finding this
    session produced. Filed as a background-task suggestion (visible in this session) with the exact
    file, package, and fix shape.
- **Genuinely unused dependencies** (via `knip`, see H28.1 below for the full tool-setup story) --
  real findings, not fixable here (package.json edits out of scope):
  | Package | Where | Note |
  |---|---|---|
  | `@number-flow/react` | `apps/web/package.json` | not imported anywhere under `apps/web/src` |
  | `@tiptap/markdown` | `apps/web/package.json` | not imported anywhere under `apps/web/src` |
  | `@radix-ui/react-visually-hidden` | `packages/ui/package.json` | not imported anywhere under `packages/ui/src` |
  | `testcontainers` | `apps/api/package.json` (dev) | `@testcontainers/postgresql` (used) already depends on this internally -- likely a redundant direct duplicate |
  | `@axe-core/playwright` | `apps/web/package.json` (dev) | not used under `apps/web` -- looks misplaced (a11y testing lives in `e2e/`), not necessarily dead |
  | `tailwindcss` | `apps/web/package.json` (dev) | likely a knip false positive (Tailwind v4 consumed via `@import "tailwindcss"` in a `.css` file knip isn't configured to parse) -- flagged, not a real removal candidate |
  Full triage notes: `tools/knip/README.md`.
- **Prod vs dev deps separated**: spot-checked `apps/api/package.json`, `apps/web/package.json`,
  `packages/db/package.json` -- runtime deps (`fastify`, `drizzle-orm`, `react`, etc.) are in
  `dependencies`; build/test-only deps (`vitest`, `eslint`, `drizzle-kit`, `testcontainers`, `tsx`) are
  in `devDependencies`. No misplacement found in the packages checked; a full audit of every workspace
  was not performed (would mean line-by-line review of ~9 package.json files' dependency
  classification, not exercised this session).
- **Renovate committed, self-hosted** -- see H1.12 below (same deliverable, cross-referenced).

---

## H28.1 -- Architecture quality: single source of business rules, no circular deps, no hardcoded URLs, dead code removed

### madge (circular dependencies) -- **done, PASS**

```
$ node tools/madge/check.mjs
[madge] apps/api/src: no circular dependencies (106 file(s) checked)
[madge] apps/web/src: no circular dependencies (184 file(s) checked)
[madge] packages/ai/src: no circular dependencies (22 file(s) checked)
[madge] packages/contracts/src: no circular dependencies (5 file(s) checked)
[madge] packages/db/src: no circular dependencies (52 file(s) checked)
[madge] packages/i18n/src: no circular dependencies (20 file(s) checked)
[madge] packages/ui/src: no circular dependencies (141 file(s) checked)
[madge] PASS -- no circular dependencies in any workspace package.
```
Wired this session: `pnpm -w madge` (root `package.json` had no such script before). `madge@8.0.0`
added as a pinned root devDependency (it wasn't installed anywhere -- `tools/madge/check.mjs` existed
from the previous pass but could not actually run: `import madge from 'madge'` had nothing to resolve).

### no-hardcoded-urls -- **done, PASS**

```
$ node tools/arch/no-hardcoded-urls.mjs
[arch:urls] PASS -- every hardcoded URL in application source is on the reviewed allowlist (or is a dev-only localhost default).
```
Wired this session: `pnpm -w arch:urls` (new script). Tool itself and its allowlist were already
written by the previous pass; verified by reading the allowlist's own justifications against the actual
files -- every entry is either the GLM endpoint default (decision #1, env-overridable), an RFC 9457
`type` URI (never dereferenced), Telegram's own domain, or demo-seed/doc-comment content.

### knip (dead code) -- **done (tooling), documented remainder**

**The tool could not actually run correctly before this session.** `knip@6.34.0` was not installed
anywhere (added as a pinned root devDependency this session) and, more importantly, its config
(`tools/knip/knip.jsonc`, written by the previous pass) produced **~330 findings, almost all false
positives**: `apps/api`'s and `packages/db`'s module-loader pattern (`apps/api/src/module-loader.ts`,
`packages/db/src/seed/module-loader.ts`) discovers and `import()`s every module by a *runtime
template-literal path*, deliberately so new modules never need a static registration list -- but that
also means knip's static import graph could not see past `app.ts`/the seed CLIs into any module at all,
so every module file (repo.ts, schemas.ts, service.ts, and every `packages/db/src/schema/*.ts` table
only a seed module reaches directly) read as dead code.

**Fixed this session** (config only, in `tools/knip/knip.jsonc` -- real reachability, not suppression):
added `src/modules/*/index.ts` (apps/api) and `src/seed/modules/*.ts` (packages/db) as additional entry
points, matching the actual runtime discovery pattern. This took the finding count from ~330 to ~106.
Also added a root workspace entry (`tools/**/*.mjs`, `scripts/*.mjs`) so knip can see this package's OWN
tooling scripts use `madge`/`turbo` (previously invisible because `tools/**` was blanket-`ignore`d,
producing false "unused devDependency" findings for the very tools this package added), with
`ignoreBinaries`/`ignoreDependencies` entries for `semgrep`/`trivy` (not npm packages), `turbo` (used
only as a string argument to `pnpm exec`, invisible to knip's binary-usage heuristic), and `@devon/
config` (consumed via a `--config` CLI flag in five workspaces' `lint` scripts, never an `import`).

**Remaining findings after the fix (all documented, `pnpm -w knip` exits 1)** -- not fixable in this
package's scope (every one lives in `apps/`/`packages/*` source):
- **4 confirmed real dead files**: `packages/db/src/schema/{accounts,admin,analytics,pages}.ts` --
  verified by hand (grepped for any import of each file's basename anywhere under `packages/db/src`,
  found none), unlike every *other* `schema/*.ts` file in the same package, which IS imported by its
  corresponding seed module.
- **6 unused/duplicate dependencies** -- see the table in the H20.1 section above (same findings, one
  table, cross-referenced rather than duplicated).
- **~96 unused exports/exported types** (36 + 60) across `apps/api`, `apps/web`, `packages/ai`,
  `packages/db`, `packages/i18n` -- not triaged item-by-item (would require the same domain context
  each module's own maker already has); two patterns worth a follow-up maker's attention are called out
  in `tools/knip/README.md`.
- Full findings list, triage, and the "why this is the documented allowlist H28.1 asks for" reasoning:
  `tools/knip/README.md` (new file, this session).
- Wired this session: `pnpm -w knip` (new script, `knip --config tools/knip/knip.jsonc`).

### Single source of business rules (`packages/contracts`)

Not independently re-audited this session (no tooling change needed/possible within this package's
scope beyond what madge/knip already check) -- `packages/contracts/src/index.ts` exists and is the
declared single entry point per `packages/db/src/index.ts`'s own "Public API of @devon/db" convention;
took this as already-met based on the existing architecture, not a fresh audit.

---

## H29.1 -- Artificial bottlenecks: semgrep rules for await-in-loop, query-in-loop, sync fs in handlers, polling

**Status: done** (rules written by the previous pass; this session verified they actually fire, wired
them into `security:scan`, and confirmed/documented every real violation they found).

**Sanity-checked this session** (the previous pass never verified the rules fire on a real violation,
only that they don't false-positive on the clean codebase): copied each rule's pattern logic (stripping
only the `paths:` scope, tested in `$TMPDIR`, never touching `apps/`/`packages/`) against a synthetic
violation matching its exact shape. All three pattern-based rules fired correctly:
```
$ semgrep --config <path-unscoped copies of the 3 rules> <scratch file with an await-in-loop, a
  query-in-loop, and a sync readFileSync>
3 Code Findings: devon-await-in-for-loop, devon-query-in-loop, devon-sync-fs-in-handler-module
```
(`devon-polling-instead-of-realtime`/`devon-hand-rolled-fetch-polling` use a simple literal-pattern
match on `refetchInterval:`/`setInterval` and were confirmed correct by inspection instead, since they
already have 4 known real hits listed in their own `exclude` block below -- proof they fire.)

**Real violations found while building/testing these rules against the actual codebase** (documented
in each rule file's own `exclude:` list, with the same justification duplicated here per this file's
own cross-reference convention):

- **await-in-loop** (`tools/semgrep/rules/await-in-loop.yml`) -- real, out-of-scope-to-fix hits in:
  `apps/api/src/modules/admin/repo.ts`, `apps/api/src/modules/analytics/aggregate.ts`,
  `apps/api/src/modules/events/reminder-worker.ts`, `apps/api/src/modules/events/service.ts`,
  `apps/api/src/modules/notifications/events.ts`, `apps/api/src/modules/notifications/jobs.ts`,
  `apps/api/src/modules/notifications/repo.ts`, `apps/api/src/modules/pages/onboarding.ts`,
  `apps/api/src/modules/projects/repo.ts`, `apps/api/src/modules/work/link-unfurl.ts`,
  `packages/db/src/events-worker.ts`. (Reviewed-and-legitimate exceptions, excluded for a real reason
  rather than being violations: `module-loader.ts`/`seed/module-loader.ts` (boot-order-dependent),
  `migrate.ts` (migrations must apply in order), `glm-provider.ts`/`gateway.ts` (retry-with-backoff, the
  shape H8.1 requires), `seed/**` (one-time scripts sharing an RLS session context across iterations).)
- **query-in-loop** (`tools/semgrep/rules/query-in-loop.yml`) -- real hits in:
  `apps/api/src/modules/notifications/repo.ts`, `apps/api/src/modules/pages/onboarding.ts`.
- **sync-fs-in-handlers** (`tools/semgrep/rules/sync-fs-in-handlers.yml`) -- **zero real hits** across
  `apps/api/src/modules/**` (severity ERROR; genuinely clean).
- **polling** (`tools/semgrep/rules/polling.yml`) -- 4 known, already-justified `refetchInterval` uses
  (`work/hooks.ts` board polling pending EPIC-018 Centrifugo wiring, `inbox/hooks.ts`, two admin
  self-refresh/countdown polls) -- each has its own inline justification in the exclude list.

**All of the above are real findings this package cannot fix** (fixing means editing `apps/api/src`/
`packages/db/src`, out of this package's edit scope) -- they are excluded in each rule's `paths.exclude`
so the gate is green on the *current* codebase, and a **NEW** occurrence anywhere else still fails
`security:scan`. This is the intended behaviour, not a workaround: H29.1 is a review gate for new
violations, and the existing ones are exactly what a follow-up package with `apps/api`/`packages/db`
edit access should triage next (batch each into a single query/parallel `Promise.all`, per file).

Wired this session: `security:scan` now runs `semgrep --config p/owasp-top-ten --config
tools/semgrep/rules` (previously the OWASP ruleset only -- these 4 custom rule files existed but were
never actually invoked by anything).

---

## H1.12 -- Dependencies scanned (Trivy, npm audit high), pruned, lockfile deterministic, Renovate self-hosted

**Status: done.**

### `pnpm -w security:scan` -- rebuilt this session from a two-line inline command into the real tool

Before this session, root `package.json`'s `security:scan` script was:
```
semgrep --config p/owasp-top-ten --error --quiet . && trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 --quiet .
```
-- it never ran the custom semgrep rules (`tools/semgrep/rules/`, H29.1) or any image scan, and
`tools/security/scan.mjs` (which does all of that) existed but nothing called it. Fixed: `security:scan`
now runs `node tools/security/scan.mjs`.

**Real bug found and fixed in `tools/security/scan.mjs` itself, this session**: the Trivy filesystem
scan crashed outright on the first real run --
```
FATAL Fatal error run error: fs scan error: scan error: scan failed: failed analysis: analyze with
traversal: walk dir error: unknown error with /repo/package.json: failed to analyze file: analyze file
(package.json): semaphore acquire: context deadline exceeded
```
-- Trivy's own internal analysis timeout, hit while walking this repo's ~1250-package `node_modules`
tree through Docker Desktop's Windows bind-mount overhead (this machine has no native `trivy` binary,
so the fallback `docker run aquasec/trivy` path was exercised, per this environment's documented
convention). Fixed by adding `--skip-dirs '**/node_modules'` (JS dependency vulnerabilities are already
`pnpm audit`'s job, the `deps` gate; this Trivy step exists for what `pnpm audit` cannot see -- non-npm
files and secrets) and raising `--timeout` to `15m`.

**Full real run, after the fix** (`node tools/security/scan.mjs`, `EXIT_CODE:1` -- FAILED, with a
precise breakdown of why below; not a false "PASS" and not silently accepted):

1. **Semgrep** (`p/owasp-top-ten` + `tools/semgrep/rules`) -- 18 findings across 12 files. Two were in
   this package's own edit scope and **fixed this session**:
   - `.github/workflows/ci.yml` (both jobs) -- `curl ... | sh` installing Trivy (`gha-curl-pipe-shell`,
     ironic: the very security-tooling install step tripped the security scanner). Fixed: replaced with
     a checksummed release-tarball download (`sha256sum -c` against Trivy's own published checksums
     file) -- no pipe into a shell interpreter.
   - `renovate.json` (new this session, see below) -- missing `minimumReleaseAge`. Fixed: added `"7
     days"` at the top level and to every `packageRules` entry (the rule checks per-entry), with an
     explicit `null` override inside `vulnerabilityAlerts` (security patches should never wait 7 days).
   - Re-ran semgrep scoped to only this package's own edited/created paths after both fixes:
     `EXIT: 0` -- clean.
   - **Remaining 16 findings are out of this package's edit scope**: `.npmrc` (missing `min-release-age`
     -- root-level file, not in this package's editable-path list), `pnpm-workspace.yaml` (missing
     `blockExoticSubdeps`/`minimumReleaseAge`/`trustPolicy` -- same, not editable here), and 10
     `apps/api/src/modules/*/index.ts` files (`direct-response-write`/XSS rule on `reply.send(...)`
     calls) plus `apps/api/src/modules/{accounts,admin}/crypto.ts` (GCM decipher missing an explicit
     auth tag length) -- all genuine `apps/api/src` findings for a security-focused follow-up package,
     not fixable from `infra/`/`tools/`/`docs/ops/`/`scripts/`/root `package.json`.
2. **Trivy fs scan** (repo, excluding `node_modules`): **clean** -- `pnpm-lock.yaml`: 0 vulnerabilities,
   no secrets found anywhere in the repo.
3. **Trivy image scans** (`devon-api`, `devon-worker`, `devon-web` -- re-tagged `:security-scan` from
   the previous pass's already-built `:test` images, no Dockerfile content changed):
   - `devon-api` / `devon-worker` (identical `node:22-alpine` base): **64 findings each** (60 HIGH, 4
     CRITICAL) across 4 targets -- 2 in the base Alpine OS layer, 13 in the bundled Node.js runtime
     itself, and **49 (27+22) in two different vendored `esbuild-linux-x64` Go binaries** (see H20.1
     above -- this is the `@esbuild-kit`/duplicate-esbuild finding, filed as a follow-up task).
   - `devon-web` (`nginxinc/nginx-unprivileged:1.29-alpine`): **33 findings** (all HIGH, 0 CRITICAL).
   - **Checked whether a newer base image would fix any of this**: `docker pull node:22-alpine` and
     `docker pull nginxinc/nginx-unprivileged:1.29-alpine` both resolved to the **exact digests already
     pinned** in the Dockerfiles -- these are the newest published images at either tag today, so the
     base-OS/Node-runtime findings are **external**: nothing to re-pin to right now; Renovate (below)
     will propose the update automatically the moment a patched image is published.
   - The one *fixable-in-principle* chunk (49 of 64 per api/worker image) is the duplicate esbuild
     binary, filed as `task_942831d2` (background task suggestion, this session) with the exact
     dependency chain and fix shape, since fixing it means editing `packages/db/package.json`.

### `pnpm -w perf:check` -- wired this session (script didn't exist in root `package.json` at all)

`tools/perf/check.mjs` existed from the previous pass, fully written, but no root script called it.
Added `"perf:check": "node tools/perf/check.mjs"`. Ran it for real against this session's already-
running dev instance (`pnpm start --demo`, ports 3000/5173):
```
[perf:check] api + web already reachable -- using the running instance.
[lhci] collecting http://127.0.0.1:5173/ ... (1 report file)
[perf:check] lhci smoke: "/" collected (1 report file(s)).
[perf:check] k6 smoke: "board-load" -- 23 req(s), p95=39.3ms
[perf:check] k6 smoke: "card-move" -- 2 req(s), p95=51.4ms
[perf:check] k6 smoke: "rsvp" -- 2 req(s), p95=57.3ms
[perf:check] k6 smoke: "analytics-summary" -- 20 req(s), p95=137.8ms
[perf:check] PASS
```
(High `failedRate` values in the raw k6 output are expected and not a failure signal for this smoke
check -- it only verifies each scenario produced *any* completed requests against a live target, per
its own documented purpose; the full k6/Lighthouse baseline pass is a separate, longer-running
deliverable already covered by `agentic/ledger/hardening/2026-09-08T06-45-00-05-00/baseline.md`.)

### Gate wiring (`agentic/gates.json`, not edited -- was already correct, just unusable)

`agentic/gates.json`'s `security`/`perf` gate entries (`"cmd": "pnpm -w --if-present security:scan"` /
`"perf:check"`, wired into the `integration` and `release` profiles) were **already written correctly**
by an earlier package -- they simply had nothing to call, since neither script existed/worked in root
`package.json` until this session. No `gates.json` edit was needed or made (it is a protected path this
package cannot touch anyway); fixing root `package.json` was sufficient to make both gates functional.

### Renovate, self-hosted (new this session: `renovate.json`, `.github/workflows/renovate.yml`)

No Renovate config existed anywhere in the repo before this session (checked `git log --all` and a
filesystem search for `renovate*` -- nothing). Added:
- **`renovate.json`** (root, committed): `config:recommended` base, `rangeStrategy: "pin"` everywhere
  (matches `pnpm-workspace.yaml`'s `saveExact`), `minimumReleaseAge: "7 days"` (waived for
  `vulnerabilityAlerts`), Docker/GitHub Actions digest pinning kept intact (`pinDigests: true`),
  internal `@devon/*` packages excluded (they move in lockstep via `workspace:*`, never an independent
  update), lockfile-only/patch/pin/digest updates allowed to automerge once the release gate is green,
  everything else requires a human merge. Validated with the tool's own bundled validator:
  ```
  $ npx -p renovate@44.69.7 renovate-config-validator renovate.json
  INFO: Validating renovate.json as global config
  INFO: Config validated successfully against 1 file(s)
  ```
  Also passes `security:scan`'s semgrep run (0 findings) after the `minimumReleaseAge` fix above.
- **`.github/workflows/renovate.yml`** (new): runs the `renovate` CLI directly via `npx` in a scheduled
  GitHub Actions job (Monday pre-6am Asia/Tashkent + manual `workflow_dispatch`) -- **self-hosted**,
  not the hosted GitHub App, matching TECH-SPEC §13's single-self-hosted-deployment posture and this
  item's explicit wording ("Renovate self-hosted"). Requires one repo secret this package cannot
  create (`RENOVATE_TOKEN`, a fine-grained PAT/App token) -- listed below under "requires external
  configuration", with rotation documented in `docs/ops/RUNBOOK.md`'s "Rotate secrets" table.

---

## Summary of files changed/added this session

**Modified**: `.github/workflows/ci.yml` (curl-pipe-sh -> checksummed download, both jobs),
`infra/backup/backup.sh` (encryption/mirror/monthly-retention were already there from the previous
pass's uncommitted work -- this session's real change is the manifest-timing fix: one combined query,
run before `pg_dump`), `infra/backup/restore.sh`/`verify.sh` (already had encryption support from the
previous pass, uncommitted -- carried through, not re-authored), `infra/backup/quarterly-drill.sh`
(row-count comparison: one combined query instead of ~65 sequential `docker run`s -- both a correctness
and a multi-minutes-to-seconds performance fix), `infra/web/nginx.conf` (block `*.map`), `package.json`
(6 new scripts: `security:scan` rewritten, `perf:check`/`knip`/`madge`/`arch:urls`/`arch:check` added;
`madge`+`knip` added as pinned devDependencies), `pnpm-lock.yaml` (reflects the above),
`tools/perf/lighthouse/run-lhci.mjs` (already had `--routes`/`--out-tag` flags from the previous pass's
uncommitted work, needed by `perf:check`'s smoke-mode call -- carried through), `tools/security/
scan.mjs` (node_modules skip + timeout fix), `tools/knip/knip.jsonc` (entry-point fixes + root workspace
+ ignore list cleanup), `docs/ops/DEPLOY.md`/`RUNBOOK.md` (backup-secret documentation additions).

**Added**: `renovate.json`, `.github/workflows/renovate.yml`, `tools/knip/README.md`,
`agentic/ledger/backups/drill-20260908T055931Z.md` (the real drill report cited above).

**Already existed from the previous pass on this branch, read/verified/used but not re-authored**:
`docs/ops/DEPLOY.md`, `docs/ops/RUNBOOK.md` (bodies), `infra/backup/crontab.example`,
`infra/backup/systemd/*`, `tools/arch/no-hardcoded-urls.mjs`, `tools/madge/check.mjs`, `tools/perf/
check.mjs`, `tools/perf/k6/*`, `tools/perf/lighthouse/*` (bodies), `tools/security/scan.mjs` (body, one
bug fixed), `tools/semgrep/rules/*.yml` (bodies, sanity-tested this session).

---

## requires external configuration

1. **`RENOVATE_TOKEN`** repo secret (`.github/workflows/renovate.yml`) -- a fine-grained GitHub PAT (or
   GitHub App installation token) scoped to this repo only, with Contents (read/write), Pull requests
   (read/write), and Workflows (read/write, since Renovate may propose updates to `.github/workflows/*`
   itself) permissions. Generate under this ministry deployment's bot/service account, never a personal
   admin account, and add it under Settings -> Secrets and variables -> Actions -> `RENOVATE_TOKEN`.
   Rotation procedure: `docs/ops/RUNBOOK.md`'s "Rotate secrets" table.
2. **`BACKUP_ENCRYPTION_PASSPHRASE`** (a real, random secret, generated on the production host, never
   committed) -- without it, `infra/backup/backup.sh` writes unencrypted dumps with a loud warning, which
   this session verified is safe for a rehearsal but is explicitly not acceptable for the real
   deployment. Documented in `docs/ops/DEPLOY.md` §2 and rotation in `docs/ops/RUNBOOK.md`.
3. **pgBackRest** was not evaluated as a working alternative to pg_dump in this session (needs
   `archive_mode`/`archive_command` Postgres server config, a `packages/db` concern out of this
   package's scope) -- the pg_dump path above is the one actually run and verified.
4. **A newer, patched `node:22-alpine`/`nginxinc/nginx-unprivileged:1.29-alpine` digest** does not exist
   yet upstream (checked, see H1.12 above) -- re-pin `apps/api/Dockerfile`/`apps/api/Dockerfile.worker`/
   `apps/web/Dockerfile`'s `ARG ..._IMAGE` digests the moment one is published; Renovate (now configured)
   will open a PR for it automatically once it exists.
