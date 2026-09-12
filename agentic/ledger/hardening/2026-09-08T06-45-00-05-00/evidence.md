# EPIC-014 hardening — merged evidence (H1–H30)

One table, assembled when the seven hardening branches were integrated into `master` on 2026-09-12.
Sources: the packages' own evidence files in this folder (`baseline.md`, `ops-tooling.md`,
`security.md`, `h18-graceful-shutdown.md`) and the commits listed per row. **"open" means no package
reached the item in this pass** — it is a statement about coverage, not a claim that the item fails.

Integration order (each `--no-ff`, fast gate green before the next): `hd/tests` → `hd/ops-tooling` →
`claude/dazzling-wu-97fed9` → `hd/web-perf-a11y` → `hd/resilience-observability` → `hd/api-data` →
`hd/security`. `claude/exciting-shaw-5b4f05` was skipped: `git diff` proved it identical to
`c4abd19`, already the first commit of `hd/ops-tooling`.

Post-merge verification on the integrated tree (commit `cb11bc4`):

| Check | Result |
| --- | --- |
| `node agentic/scripts/gate.mjs --profile fast` | **ok=true**, failed=[], skipped=[] (typecheck, lint, unit, i18n, secrets all PASS) |
| `pnpm --filter @devon/web build` | PASS — 90 source maps moved out of `dist/assets` into `dist-sourcemaps/` (H6.3) |
| `pnpm --filter @devon/db migrate:verify` | PASS — 588/588 checks across 7 sections (RLS, PgBouncer isolation, audit immutability, poll-vote races) |
| `pnpm start --demo` | Boots. `GET /healthz` → `200 {"status":"ok"}`; `POST /api/v1/auth/login` as `demo.boshliq` → `204` + session cookie; `GET /api/v1/me` with that cookie → `200` (Anvar Aliyev). Processes stopped afterwards. |
| `apps/api` unit+integration suite | 52 files, 461 passed, 6 `it.fails` (the product bugs still open, listed under H10 below) |

## H item → status → evidence → commit

| H item | Status | Evidence | Commit(s) |
| --- | --- | --- | --- |
| H1.1 No secrets in code/repo/logs | done | `security.md` §H1.1; `secrets` gate green on every merge (two hits introduced by merged material were fixed at source: test password literals, throwaway dev URLs in an evidence file) | `fb95da0`, `c50fc47`, `f9033a8` |
| H1.2 `can()` + RLS everywhere; object-level access tested by swapping ids | done | `security.md` §H1.2 (48-attempt cross-department id swap); `apps/api/test/integration/cross-department-access.test.ts` — the card checklist/comment hole it documented is closed and the test now asserts the fix | `b51edf3`, `83ff748`, `cb11bc4` |
| H1.3 No mass assignment | done | `security.md` §H1.3; `apps/api/test/integration/mass-assignment.test.ts` | `1f67df7`, `1330406` |
| H1.4 argon2id, cookie flags, rotation, CSRF double-submit, logout everywhere | done | `security.md` §H1.4; global CSRF guard (`plugins/csrf-guard.ts`); `test/integration/session-security.test.ts` | `2513237` |
| H1.5 XSS: escaping, Tiptap allow-list, CSP with nonces | done | `security.md` §H1.5; `packages/contracts/src/rich-text.ts` + its unit tests; maintenance page gets its own CSP | `4041368`, `c057cbe`, `db00c91` |
| H1.6 Server-side validation incl. SSRF-safe unfurling | done | `security.md` §H1.6; the unfurler now pins its socket to the address it approved (`fetchHtmlHead`, `modules/work/link-unfurl.ts`) | `c2753c6`, `4041368` |
| H1.7 Parameterised queries only | done | `security.md` §H1.7; Semgrep triage of two findings | `1f67df7`, `83ff748` |
| H1.8 Upload allow-lists, random keys, ClamAV, signed URLs | done | `security.md` §H1.8 | pre-existing, re-verified in `security.md` |
| H1.9 Rate limits, progressive lockout, no enumeration | done | `security.md` §H1.9; `test/integration/rate-limit-lockout.test.ts` — the "429 becomes a 500" bug is fixed and its test flipped from `it.fails` to a plain assertion | `83ff748`, `804a4a8`, `cb11bc4` |
| H1.10 Security headers, HTTPS, CORS allow-list | done | `security.md` §H1.10; `plugins/security-headers.ts` registered before every route; `infra/Caddyfile` | `2513237`, `1f67df7`, `c057cbe` |
| H1.11 Responses never leak; logs redact | done | `security.md` §H1.11; `lib/log-redaction.ts` wired into pino's serializer | `2513237`, `b51edf3`, `cd28973` |
| H1.12 Dependencies scanned/pruned, deterministic lockfile, Renovate | done | `ops-tooling.md` §H1.12; `tools/security/scan.mjs`, self-hosted `renovate.json` + workflow. Note: the `security` gate needs `semgrep`+`trivy` on PATH, absent on this machine, so it is *not* part of the fast profile that was run here | `2962a08`, `4a30f7d` |
| H1.13 Production errors: generic message + request id | done | `security.md` §H1.13; `app.ts`'s single `setErrorHandler` builds every body from `@devon/contracts`' frozen Problem table | `2513237`, `83ff748`, `b51edf3` |
| H1.14 Telegram webhook secret token, replay window | done | `security.md` §H1.14; constant-time compare + replay window; config now Zod-parsed at boot | `cd28973` |
| H1.15 Codes/keys CSPRNG, hashed, expiring, single-use | done | `security.md` §H1.15; GCM tag length pinned | `1f67df7` |
| H1.16 Privilege escalation tested negatively; least-privilege DB roles | done | `security.md` §H1.16; `test/integration/privilege-escalation.test.ts`; `migrate:verify`'s audit-grant section (app role has INSERT/SELECT only) | `2513237`, `b51edf3`, `c2753c6` |
| H2.1 Brotli/gzip on compressible responses | done | `@fastify/compress` global, `br`/`gzip`/`deflate` | `04780ed` |
| H2.2 Sparse fieldsets / summary list shapes | open | not reached by these packages; `baseline.md` §2 holds the measured per-route byte counts | — |
| H2.3 Cursor pagination, server-side filter/sort/search | open | not reached; trigram search landed (H3.4) but pagination was not revisited | — |
| H2.4 Query dedupe, no duplicate requests, no waterfalls | open | measured only (`baseline.md` §2, the pre-existing `380af33` baseline row) | — |
| H2.5 ETag / If-None-Match, immutable assets, no-store on private JSON | done | `@fastify/etag` registered before `compress` so the hash is of the real payload | `04780ed` |
| H2.6 Realtime instead of polling (Centrifugo) | open | deliberately not in this pass — realtime is scoped in the v1.1 specification | — |
| H2.7 Debounce, AbortController, timeouts on every outbound call, capped retries | done (server side) | `lib/resilience/*` timeout primitives on every outbound call; unfurler request/socket timeouts | `267c9c8`, `c2753c6` |
| H2.8 Streaming for exports and large files | done | the audit CSV export streams instead of buffering a hardcoded 1000-row cap | `3c651cc` |
| H2.9 Payload budget on the six main routes (before/after) | open | before-numbers only (`baseline.md` §2); no after-measurement was taken | — |
| H3.1 No N+1; no query in a loop (Semgrep rule) | done | `tools/semgrep/rules/query-in-loop.yml` (both packages' rules consolidated into one file at merge time: the `await`-shape rule `query-in-loop`, which the 26 reviewed `nosemgrep` annotations bind to, plus the `.raw()`-specific `devon-query-in-loop`); three real N+1s fixed | `f365005`, `ad2e8ed`, `01a5122` |
| H3.2 Bulk inserts/updates for seeds, imports, digests | partial | the notification-preferences upsert became one bulk `values (...)` write (and lost its rule exclusion at merge); seeds/imports untouched | `ad2e8ed` |
| H3.3 Pool sizing per process, PgBouncer-safe | done | pool max/min/idle/connection/statement timeouts, env-overridable; `migrate:verify`'s PgBouncer isolation section passes (20 concurrent transactions, zero cross-department rows) | `d4f4c5e`, `441d073` |
| H3.4 Indexes justified by access pattern | done | composite cards index + title/name trigram search via `normalize_uz` (migration `0903`) | `f06dccc` |
| H3.5 No `select *`, aggregates precomputed | open | not reached by these packages | — |
| H3.6 Transactions, row versions, unique constraints for idempotency | partial | poll votes got their unique constraints (migration `0902`) and pass `migrate:verify`'s race section; the card `version` check is still check-then-act (see H10.1) | `b33f49a`, `c74398a` |
| H3.7 Migrations safe, tested twice on Testcontainers | done | `migrate:verify` 588/588 after the merge; PgBouncer container-readiness race in the harness fixed | `441d073` |
| H4.1 Profile before optimising; React Compiler on measured hot spots | done | React Compiler wired for Rolldown-Vite and scoped to measured hot spots rather than the whole app | `eefa503`, `f6ae037`, `c7a0837` |
| H4.2 Virtualise boards, tables, archives, timelines | open | not reached by these packages | — |
| H4.3 Route-level code splitting, heavy libs lazy | done | core routes lazy-loaded; `pnpm --filter @devon/web build` shows per-screen chunks | `f6ae037` |
| H4.4 `size-limit` shell ≤ 200 kB, no duplicate packages | partial | compiler scoping addressed; the build still warns on chunks > 500 kB (`src`, `pages-screen`, `use-analytics`) — no size-limit gate exists yet | `c7a0837` |
| H4.5 No layout thrash, `content-visibility` on long lists | partial | `content-visibility` on the audit log's rows; other long lists untouched | `8564e5e` |
| H4.6 Cleanup of listeners, timers, sockets, observers | done | the Pomodoro tick interval is cleared when the last listener unsubscribes | `1406f10` |
| H5.1 Optimistic updates with rollback | done | personal tasks and event RSVP, with rollback + toast | `ba5b989` |
| H5.2 Skeletons, stale-while-revalidate, prefetch on hover/focus | done | prefetch on hover/focus for board, events and inbox nav entries | `dad08f3` |
| H5.3 Double-submit prevention (idempotency keys, pending state) | partial | poll double-submit is now idempotent at the database (H10.1); a general per-control idempotency-key convention was not added | `b33f49a` |
| H5.4 Instant navigation (kept-alive panels, View Transitions) | open | not reached by these packages | — |
| H6.1 Responsive/lazy images, avatar sizes | done | avatar lazy loading | `2afc16c` |
| H6.2 Font subsetting, `font-display: swap`, critical preload | done | critical font preload | `2afc16c` |
| H6.3 Fingerprinted immutable assets, source maps not public | done | source maps moved out of `dist/` at build time (verified in the post-merge build) and `*.map` requests blocked by the production web server | `2afc16c`, `e25eab5` |
| H6.4 Unused CSS/assets removed | open | `knip` is wired (H28.1) but the remainder it reports is documented, not removed | — |
| H7.1 No sync FS/CPU work in handlers; parallel independent I/O | partial | independent boot/worker loops parallelised; the `sync-fs-in-handlers` Semgrep rule is wired | `01a5122`, `2962a08` |
| H7.2 Clients/pools reused | done | pool sizing (H3.3); the AI provider is built once per process | `d4f4c5e`, `1678c0a` |
| H7.3 Config parsed once at boot, fail fast | done | the Telegram trio moved out of ad-hoc `process.env` reads into the single Zod config parse | `cd28973` |
| H7.4 Limits on body, JSON depth, upload size, AI input | done | one `application/json` parser (the two packages each wrote one; the surviving `plugins/json-body.ts` measures depth on raw text *before* `JSON.parse`, takes its ceiling from `config.JSON_MAX_DEPTH`, and answers `422 validation_failed/too_deep`); explicit `HTTP_BODY_LIMIT_BYTES`, `AI_MAX_INPUT_BYTES` | `55e597f`, `83ff748`, `9e7e263` |
| H8.1 Timeouts + circuit breakers with graceful degradation | done | breakers for AI, Telegram, ClamAV and MinIO (the MinIO one verified against a really-stopped MinIO); ClamAV outage queues uploads as pending-scan; weekly Telegram digest routed through the bounded send path | `267c9c8`, `8ad3eaf`, `d6e9745`, `4f2f001`, `193b5bf` |
| H8.2 No third-party scripts; self-hosted fonts/illustrations | open | not re-verified in this pass (CSP is in place, H1.5/H1.10) | — |
| H8.3 Single points of failure listed with mitigation | partial | `ops-tooling.md` §H19 documents backups + a restore drill; a consolidated SPOF list belongs to the readiness report | `bf0c976` |
| H9.1 Explicit cache map, stampede protection | partial | single-flight stampede protection on analytics summary/personal/export; the explicit cache map (key/TTL/invalidation per layer) is not written | `99369ff` |
| H10.1 Unique constraints, idempotency keys, row versions; races tested | partial | poll double-submit **fixed** (unique constraints + same-voter advisory lock, proven by `migrate:verify`'s race section and by the integration test flipped from `it.fails` to a real assertion); Telegram webhook replay window added. **Still open, documented by 6 `it.fails` probes in `apps/api/test/integration/`:** RSVP capacity, carpool seat claiming and the card `version` check are check-then-act; AI settings lazy-init violates its own RLS policy for a fresh department's head; a member can still patch/delete a structure unit after self-service is disabled; a card can be assigned to a user outside the department | `b33f49a`, `c74398a`, `cd28973`, `fe29fd6` |
| H11.1 Bounded queues/caches/maps, timers cleared, sockets closed, 30-min soak flat | partial | the AI result cache is a bounded LRU; the Pomodoro timer is cleared; the pool closes on drain. No post-change 30-minute soak was run (`baseline.md` §5 holds the 10-minute before-soak) | `1678c0a`, `1406f10`, `1d067d2` |
| H12.1 Stateless API, documented limits, load test to 1 000 VUs | partial | pool/connection limits computed and env-documented (H3.3); the load matrix is the pre-change one in `baseline.md` §4 | `d4f4c5e` |
| H13.1 Behaviour when dependencies are down; health/readiness; graceful shutdown; DLQ; safe restart | done | `/readyz` reports AI/Telegram/ClamAV/MinIO circuit state without gating readiness on them; pg-boss dead-letter queue + retry policy; graceful drain on SIGTERM/SIGINT (`h18-graceful-shutdown.md` proves `docker stop` exit 0 instead of 143). Two packages wrote a drain; at merge they became one implementation (`bootstrap/graceful-shutdown.ts`) behind the Fastify-shaped wrapper (`plugins/shutdown.ts`), both test suites kept | `928d1f1`, `1d067d2`, `f076153`, `6666c95`, `1ee77ea` |
| H14.1 Constraints, FKs, UTC, money types, Uzbek normalisation, state transitions | partial | `normalize_uz`-backed trigram search; `test/integration/state-transitions.test.ts` covers the transition rules. A full constraint/FK/cascade review was not redone | `f06dccc`, `1330406` |
| H15.1 Structured logs, latency histograms, queue metrics, AI cost, slow-request log | done | per-request structured logs with request/user/department ids, HTTP latency histograms, `/metrics`, queue depth + dead-letter gauges, AI latency/cost/token metrics, slow-request log | `277b0c4`, `f71b83a`, `f076153` |
| H16.1 RFC 9457 errors, correct status codes, no swallowed exceptions, fatal handler | done | `security.md` §H16; one error handler mapping every transport 4xx to its own status; `lib/fatal.ts` installs the unhandled-rejection/uncaught-exception handlers in the process entry point only | `2513237`, `83ff748`, `c2753c6`, `804a4a8` |
| H17.1 Production builds, env validated, secure defaults | done | `ops-tooling.md` §H17; production Dockerfiles for api/web/worker, non-root static web, `infra/docker-compose.prod.yml` | `c4abd19`, `2513237` |
| H18.1 Reproducible pinned deployment, readiness-gated, rollback, graceful shutdown, jobs preserved | done | `ops-tooling.md` §H18 + `h18-graceful-shutdown.md`; `docs/ops/DEPLOY.md`; `*.map` requests blocked in production | `c4abd19`, `e25eab5`, `928d1f1` |
| H19.1 Backups, retention, weekly verify, quarterly drill, encrypted | done | `ops-tooling.md` §H19; `infra/backup/quarterly-drill.sh`; drill record `agentic/ledger/backups/drill-20260908T055931Z.md`; row-count manifest timing bug fixed | `bf0c976` |
| H20.1 Dependencies: unused removed, deduped, heavy libs justified, no high vulns | partial | `ops-tooling.md` §H20; `knip`/`madge` wired and passing on circularity; the dead-code remainder is documented rather than removed; `deps` (pnpm audit) is a non-blocking gate outside the fast profile | `2962a08` |
| H21.1 No third-party scripts (CSP + bundle evidence) | open | CSP is in place (H1.5/H1.10) but no CSP-report/bundle verification was produced in this pass | — |
| H22.1 Semantic HTML, keyboard, contrast, axe 0 serious/critical | partial | the real a11y suite is wired to the `a11y` gate (integration/release profiles); no post-change axe run is recorded here | `eefa503` |
| H23.1 Titles/meta on public pages, robots, noindex on app routes | done | per-route SEO meta; the maintenance notice has its own title/meta | `eefa503`, `bc2c119` |
| H24.1 LCP/INP/CLS budgets on six routes at 4G | partial | the React Compiler scoping was driven by measurement, and `tools/perf/check.mjs` + `lhci` are wired; the after-numbers are not measured (`baseline.md` §3 is the before) | `c7a0837`, `2962a08` |
| H25.1 Unit + integration + e2e across auth, authz, CRUD, validation, idempotency, flows | done | nine integration suites on real Postgres via Testcontainers (`apps/api/test/integration/`) and six `@flow` Playwright specs, wired into the `e2e` gate with their own dedicated ports and global setup. 52 api test files, 461 passing | `1330406`, `c50fc47` |
| H26.1 k6 scenarios, first bottleneck found and fixed | open | `baseline.md` §4–§5 holds the k6 matrix and the soak as the before-state; no bottleneck-fix cycle was run after these changes | — |
| H27.1 AI cached by prompt hash, digests batched, logs bounded | done | AI feature calls cached by `(department, feature, input)` hash, 5-minute TTL, bounded LRU, cache hits bypass the budget because they spend no tokens | `1678c0a` |
| H28.1 Single source of rules, no circular deps, no hardcoded URLs, dead code removed | partial | `ops-tooling.md` §H28: `madge` PASS, `no-hardcoded-urls` PASS, `knip` wired with a documented remainder | `2962a08` |
| H29.1 Semgrep rules for await-in-loop, query-in-loop, sync fs, polling; violations fixed | done | `tools/semgrep/rules/` (consolidated at merge, see H3.1); three real N+1s fixed and the reviewed sequential loops annotated | `f365005`, `ad2e8ed`, `01a5122`, `2962a08` |
| H30.1 Six flows traced end to end; report sections 1–10; external configuration listed | partial | the six flows exist as executable `@flow` specs (register→department→join, board move, group project, sprint+Pomodoro, event with carpool+poll, admin pause) and the per-package "requires external configuration" sections are written in `ops-tooling.md` and `security.md`. The per-hop time/CPU/bytes/queries before-and-after table and `PRODUCTION-READINESS.md` are **not** written | `1330406` |

## Merge decisions worth knowing

1. **Two graceful-drain implementations became one.** `claude/dazzling-wu-97fed9`'s
   `bootstrap/graceful-shutdown.ts` (injectable process, force-exit budget, idempotent) is the
   implementation; `hd/resilience-observability`'s `plugins/shutdown.ts` is now the Fastify-shaped
   wrapper that binds it to `app.close()` + `closePool()`. Both packages' unit tests still run.
2. **Two JSON-depth parsers became one.** Fastify permits one `application/json` parser. The
   surviving one measures depth on the raw text before `JSON.parse` (the step a deep body overflows)
   and takes its ceiling from `config.JSON_MAX_DEPTH`. The two packages disagreed only on the status
   code; the product's Problem contract (`422 validation_failed`, `errors:[{path:'body',code:'too_deep'}]`)
   won, and the security package's assertion was updated to it — it still pins an exact code.
3. **Two Semgrep query-in-loop rules became one file.** `tools/semgrep/rules/query-in-loop.yml` holds
   both surviving rules; the weaker third copy (`await-in-loop.yml`, id `devon-await-in-for-loop`) was
   folded into the first rule, which carries the id the 26 reviewed `nosemgrep` annotations name.
   `apps/api/src/modules/notifications/repo.ts` lost its exclusion because the api-data package had
   actually fixed that N+1.
4. **Three `it.fails` probes were flipped to real assertions** because the product fix landed in the
   same integration: the poll double-submit (H10.1), the cross-department card checklist/comment
   insert (H1.2) and the rate-limit 500 (H1.9). No test was weakened or deleted at any point; the
   remaining six `it.fails` are listed under H10.1 above and are the honest open product bugs.
