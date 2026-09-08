# Hardening baseline (BEFORE) — 2026-09-08

Measured against a locally booted `pnpm start --demo` (Postgres 17.11 in Docker, `demo.boshliq` /
`Ishonchli#2026` as the signed-in actor for every route/API measurement) on the machine described in
"Environment" below. No product code was changed to produce these numbers; only measurement scripts
under `tools/perf/` and one infra change (`pg_stat_statements` enabled on the `postgres` Compose
service — see H3 below) were added. Every command needed to repeat a measurement is given in place, so
this file doubles as the reproduction recipe for the AFTER pass.

This corresponds to HARDENING.md H2.9 (payload budget), H3 (no N+1 / SQL query counts), H4.4/H6
(bundle budget), H24.1 (Core Web Vitals), H26.1/H12.1 (load testing), H11.1 (soak memory), and H12
(gate status).

## Environment

- Windows 11, Docker Desktop (WSL2 backend) — `devon-postgres`, `devon-valkey`, `devon-minio` containers.
- Node v24.18.0, pnpm 11.15.0, Docker 27.5.1.
- Postgres 17.11 (`pgvector/pgvector:0.8.6-pg17`), app booted via `pnpm start --demo` (API on
  `http://127.0.0.1:3000`, Vite dev server on `http://127.0.0.1:5173`).
- Playwright 1.63.0 (`e2e/package.json`'s pinned version, browsers already downloaded to
  `%LOCALAPPDATA%\ms-playwright`), Lighthouse CI `@lhci/cli@0.15.1` (pinned), k6 `grafana/k6:2.2.0`
  (pinned Docker tag).
- All numbers are a **single run** (not averaged across repeats) — treat them as directional, not
  statistically tight; the AFTER pass should use the same single-run methodology for a fair diff, or
  both passes should be repeated 3× if tighter numbers are wanted later.

## 0. One-time setup this baseline needed (infra, not product code)

`pg_stat_statements` was not in `shared_preload_libraries` (confirmed: `SHOW shared_preload_libraries`
returned empty), so it could not be `CREATE EXTENSION`'d in a way that actually counts anything.
`infra/docker-compose.yml`'s `postgres` service now sets:

```yaml
command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "pg_stat_statements.track=all", "-c", "pg_stat_statements.max=10000"]
```

Applied once with:

```bash
docker compose -f infra/docker-compose.yml up -d --force-recreate postgres
docker exec devon-postgres psql -U postgres -d devon -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

This is a durable, low-overhead (<1% per the extension's own docs) change to the dev/staging compose
file and is expected to ship as part of the observability work (H15.1), not reverted after this
baseline. **Recreating the `postgres` container drops all live connections** — the API process (a
`tsx watch` dev server) crashed on the next query and had to be restarted (`pnpm start --demo` again,
after freeing the stale port with the previous Vite process still holding 5173). Do this step *before*
booting the app for the AFTER pass, not after, to avoid the same restart.

---

## 1. Production bundle

```bash
pnpm --filter @devon/web build
node agentic/scripts/check-bundle.mjs
node tools/perf/bundle/report.mjs      # full per-extension breakdown (added by this task)
```

`check-bundle.mjs` (the `bundle` gate, budget `bundle_main_kb_max: 350` in `agentic/gates.json`):

```
[bundle] 295.6 kB gz  1024 kB raw  apps/web/dist/assets/api-client-CjTj_oPB.js
[bundle] 132.2 kB gz   432 kB raw  apps/web/dist/assets/pages-screen--rBrB90U.js
[bundle] 129.0 kB gz   440 kB raw  apps/web/dist/assets/index-hq9ClQ8k.js
[bundle] 119.2 kB gz   424 kB raw  apps/web/dist/assets/use-analytics-CjCBP1DY.js
[bundle]  23.4 kB gz   105 kB raw  apps/web/dist/assets/personal-screen-BtEVWR8x.js
[bundle]  18.9 kB gz    99 kB raw  apps/web/dist/assets/events-screen-D2EXsnMr.js
[bundle]  15.0 kB gz    52 kB raw  apps/web/dist/assets/board-screen-DhD_NC93.js
[bundle]  11.9 kB gz    39 kB raw  apps/web/dist/assets/table-screen-CFU2o6pm.js
[bundle] largest chunk 295.6 kB gz (budget 350 kB); total JS 888 kB gz
```

**Gate result: PASS** (295.6 kB ≤ 350 kB budget) — but note TECH-SPEC §12's own perf-gate row states a
**200 kB shell** target ("`size-limit` 200 kB shell") that disagrees with `gates.json`'s 350 kB budget;
the largest chunk (`api-client`, 295.6 kB gz — the whole typed API client + all Zod schemas bundled as
one chunk, not route-split) already exceeds the *spec's* number even though it passes the *gate's*
number. Worth reconciling, not fixed here (measurement task).

Full breakdown (`tools/perf/bundle/report.mjs`), `apps/web/dist`:

| extension | files | on disk | delivered to a browser |
|---|---:|---:|---:|
| `.map` (sourcemaps) | 80 | 11 249.6 kB | **0 kB — must never be served publicly (H6.3)** |
| `.js` | 81 | 3 118.3 kB | 888.0 kB (gzip) |
| `.woff2` (fonts) | 7 | 326.2 kB | 326.2 kB (already compressed) |
| `.css` | 1 | 82.5 kB | 14.2 kB (gzip) |
| `.txt` / `.html` | 4 | 13.9 kB | 6.3 kB |
| **Total shippable (excl. sourcemaps)** | | | **≈ 1 234.7 kB** |

Sourcemaps are 11.2 MB on disk — larger than the entire rest of the build combined. H6.3 says
"source maps not public (uploaded to error tracking only)"; nothing in this repo's Caddyfile or static
server config currently blocks `*.map` requests, so whether they are reachable in production depends
entirely on whichever web server ships with the (not-yet-built) `web` container image — worth a
specific check when that image exists.

---

## 2. Six main routes: requests, bytes, API calls, duplicates, waterfalls, SQL query count

Script: `tools/perf/playwright/measure-routes.mjs` (Playwright 1.63.0, driven via a small
`tools/perf/playwright/package.json` so it can reuse the browser Playwright already downloaded for
`e2e/`, without touching `pnpm-workspace.yaml`). Logs in as `demo.boshliq` once, then for each route:
resets `pg_stat_statements`, navigates (`waitUntil: networkidle` + 500 ms settle), records every
network event via the Chrome DevTools Protocol (`Network.*` — `encodedDataLength` is the actual wire
byte count, not a `content-length` header guess), then reads `pg_stat_statements` totals since the
reset.

```bash
cd tools/perf/playwright
npm install                 # first time only — installs @playwright/test 1.63.0, reuses the shared browser cache
node measure-routes.mjs     # requires `pnpm start --demo` already running on 127.0.0.1:5173/3000
```

| route | requests | bytes (wire) | API calls | API bytes | duplicate groups | SQL calls (raw, since reset) | SQL rows | wall ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` (home) | 232 | 5 646 725 | 11 | 18 205 | **16** | 155 | 204 | 1 811 |
| `/work` (board) | 241 | 1 140 319 | 7 | 164 708 | 0 | 224 | 436 | 1 758 |
| `/work/table` | 227 | 523 986 | 9 | 246 872 | 0 | 247 | 737 | 1 575 |
| `/events` | 225 | 543 765 | 4 | 6 660 | 0 | 106 | 66 | 1 557 |
| `/inbox` | 208 | 147 226 | 4 | 3 606 | 0 | 104 | 57 | 1 564 |
| `/analytics` | 228 | 279 548 | 8 | 171 758 | 0 | 232 | 543 | 1 594 |

Full waterfalls (every request, method, status, byte size, start/duration offset) and the top-10 SQL
statements by call count per route are in `tools/perf/playwright/out/*.json` (`root.json`, `work.json`,
`work-table.json`, `events.json`, `inbox.json`, `analytics.json`, plus the combined `summary.json`).

**Methodology caveats (read before comparing AFTER numbers):**

- **Dev server, not production build.** `pnpm start --demo` serves Vite's dev-mode unbundled ES module
  graph (200+ small file requests per route: every `.tsx`/`.ts` module, every `node_modules/.vite/deps`
  chunk, is its own HTTP request). This is why request *counts* are ~200-240 on every route regardless
  of the route's real complexity — it is measuring Vite dev-server overhead, not the shipped bundle.
  The bundle section above (§1) and the production-mode Lighthouse run (§3) are the numbers that
  reflect what a real deployment serves. Request counts / bytes here are still useful for **duplicate
  request** and **API call count** analysis, which are dev/prod-independent (same React Query/router
  code runs either way).
- **`/` (home) has real duplicate API calls** — `GET /api/v1/instance`, `/api/v1/notifications`,
  `/api/v1/analytics/personal`, `/api/v1/analytics/pins`, `/api/v1/analytics/summary` were each
  requested **twice** on a single page load (full list of 16 duplicate groups, including duplicated
  module fetches, in `out/root.json`). `apps/web/src/main.tsx` wraps the app in `React.StrictMode`,
  whose dev-only double-invocation of effects is a plausible mechanical cause — **but that alone
  doesn't explain why only `/` shows duplicates**: StrictMode wraps every route equally, and the other
  five had **zero** duplicate request groups. That points to something route-specific (e.g. two
  components on the home screen independently calling the same endpoint with query keys that don't
  match well enough for TanStack Query's cache to dedupe them), which is the more useful lead for
  whoever picks up H2.4 on this route.
- **SQL call counts include background noise.** `pg-boss` (analytics nightly recompute, notification
  digests) polls Postgres continuously regardless of page activity — measured independently:

  ```bash
  docker exec devon-postgres psql -U postgres -d devon -t -A -c "SELECT pg_stat_statements_reset();"
  sleep 2
  docker exec devon-postgres psql -U postgres -d devon -t -A -c \
    "SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%';"
  # => 52 calls in 2s of total idle (≈26 calls/s) from pg-boss job polling alone
  ```

  Each route's ~1.5-1.8 s wall duration therefore carries an estimated **~40-47 background calls** on
  top of the route's own queries. Route-attributable SQL activity is roughly: `/` ≈ 110, `/work` ≈ 180,
  `/work/table` ≈ 200, `/events` ≈ 62, `/inbox` ≈ 60, `/analytics` ≈ 190. `/work/table` and `/analytics`
  stand out as the heaviest — `pg_stat_statements`'s own `rows` column (737 and 543 respectively) is
  the more useful of the two for spotting N+1 shapes; the top-10-by-calls dump in each route's JSON is
  where to look first for H3.1 (no query in a loop).
- The RSVP/card-move/analytics-summary top SQL statements are dominated by `begin`/`commit`/
  `set_config(...)` (RLS `department_id` context set per transaction) rather than business queries at
  this traffic level — expected, not a finding by itself.

---

## 3. Core Web Vitals (Lighthouse CI, simulated 4G)

Scripts: `tools/perf/lighthouse/run-lhci.mjs` (drives `npx @lhci/cli@0.15.1 collect` against
Playwright's own downloaded Chromium via `--chromePath`), `tools/perf/lighthouse/auth.cjs` (a
`--puppeteerScript` that signs in as `demo.boshliq` before each Lighthouse pass, idempotently),
`tools/perf/lighthouse/prod-server.mjs` (see below).

```bash
# dev-mode pass (against the running `pnpm start --demo` Vite dev server):
node tools/perf/lighthouse/run-lhci.mjs --base-url http://127.0.0.1:5173 --out-tag dev

# production-build pass (see caveat below for why this second pass exists):
pnpm --filter @devon/web build
node tools/perf/lighthouse/prod-server.mjs &          # serves apps/web/dist + proxies /api,/healthz,/readyz -> :3000
node tools/perf/lighthouse/run-lhci.mjs --base-url http://127.0.0.1:4174 --out-tag prod
```

Both runs use Lighthouse's default mobile config's simulated-4G-equivalent throttling made explicit
(`rttMs: 150`, `throughputKbps: 1638.4`, `cpuSlowdownMultiplier: 4` — Lighthouse's own "Slow 4G" mobile
default), `formFactor: mobile`, `throttlingMethod: simulate`. Report JSON paths:
`tools/perf/lighthouse/out/<dev|prod>/<route-slug>/.lighthouseci/lhr-*.json` (listed in each tag's
`report-paths.json`).

**Why two passes exist:** `apps/web/src/vite.config.ts`'s `preview` block has no `/api` proxy (only
`server` does, for dev), so Lighthouse against a plain `vite preview` of the production build would
404 every API call and never reach a signed-in state. `infra/Caddyfile`'s `caddy` Compose profile is
the intended fix but expects `api`/`web` **container** service names that do not exist yet (no
Dockerfiles/Compose services for `apps/api`/`apps/web` in this repo — a later epic's job per that
file's own header comment). Rather than edit product code (`vite.config.ts`) or wait for that epic,
`tools/perf/lighthouse/prod-server.mjs` is a small (~90-line), dependency-free Node static file server
+ reverse proxy that stands in for Caddy's job for measurement purposes only: serves the real minified
`apps/web/dist` bundle and forwards `/api/*`, `/healthz`, `/readyz` to the already-running API on
`:3000`, same-origin from the browser's point of view (matches the app's own "browser only calls
relative `/api/...`" architecture — no CORS needed).

### Dev-mode (Vite dev server on :5173) — NOT representative of production, see caveat

| route | LCP | FCP | CLS | TBT | Perf score | A11y | Best Practices | SEO |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 139.7 s | 56.7 s | 0.007 | 1.41 s | 0.30 | 0.96 | 1.00 | 0.82 |
| `/work` | 116.1 s | 56.9 s | 0.038 | 0.89 s | 0.35 | 1.00 | 1.00 | 0.82 |
| `/work/table` | 114.5 s | 57.2 s | 0.007 | 2.88 s | 0.26 | 0.85 | 1.00 | 0.82 |
| `/events` | 114.0 s | 56.6 s | 0.007 | 0.41 s | 0.45 | 0.96 | 1.00 | 0.82 |
| `/inbox` | 111.3 s | 56.6 s | 0.007 | 0.38 s | 0.46 | 0.96 | 1.00 | 0.82 |
| `/analytics` | 142.8 s | 56.7 s | 0.091 | 4.16 s | 0.23 | 0.94 | 1.00 | 0.82 |

**These numbers are almost meaningless in isolation** — Vite dev mode serves 200+ unbundled ES module
files per route (§2), and under simulated-4G's 150 ms RTT that is 200+ round trips compounding into
100+ second LCP/FCP. They are included only because they are what `pnpm start --demo` (as the task
specified) actually serves; do not use them as the H24.1 "before" number.

### Production build (via `prod-server.mjs`, real minified `apps/web/dist`) — the real H24.1 baseline

| route | LCP | FCP | CLS | TBT | TTI | Perf score | A11y | Best Practices | SEO |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 5.76 s | 4.43 s | 0.007 | 1.07 s | 7.01 s | 0.45 | 0.96 | 1.00 | 0.82 |
| `/work` | 4.95 s | 4.20 s | 0.038 | 1.38 s | 6.21 s | 0.46 | 1.00 | 1.00 | 0.82 |
| `/work/table` | 4.92 s | 4.11 s | 0.007 | 4.41 s | 9.04 s | 0.41 | 0.85 | 1.00 | 0.82 |
| `/events` | 5.05 s | 4.18 s | 0.007 | 0.42 s | 5.05 s | 0.61 | 0.96 | 1.00 | 0.82 |
| `/inbox` | 4.60 s | 4.03 s | 0.007 | 0.47 s | 4.87 s | 0.62 | 0.96 | 1.00 | 0.82 |
| `/analytics` | 7.94 s | 4.51 s | 0.091 | 3.73 s | 9.16 s | 0.33 | 0.94 | 1.00 | 0.82 |

**Against H24.1 (LCP < 2.5 s, INP < 200 ms, CLS < 0.1) and TECH-SPEC §12 (Lighthouse ≥ 90 on these six
routes):**
- **LCP fails on all six routes** (4.6-7.9 s vs. 2.5 s budget) even against the production bundle.
  `/analytics` (7.94 s) and `/work/table` (4.92 s, but 4.41 s of Total Blocking Time) are worst.
- **CLS passes on all six** (max 0.091 on `/analytics`, budget < 0.1 — closest to the edge).
- **INP is not measurable in a single-navigation lab run** (it is a field metric requiring real user
  interactions over a session); Lighthouse's lab proxy, **Total Blocking Time**, is reported instead —
  `/work/table` (4.41 s) and `/analytics` (3.73 s) stand out as the routes most likely to have real
  input-delay problems once measured in the field.
- **Performance category score is far below the ≥ 90 target** (23-62 out of 100) on every route.
- A11y dips to **0.85 on `/work/table`** — the one route below the others; worth an axe pass
  specifically there before EPIC-014's dedicated a11y gate run.
- Best Practices is 1.00 and SEO is a flat 0.82 on every route (same underlying page shell), so neither
  varies route-to-route and both are minor relative to the LCP/TBT problem.

---

## 4. API latency (k6) — board load, card move, RSVP, analytics summary at 1/10/100 VUs

Scripts: `tools/perf/k6/{lib.js,board-load.js,card-move.js,rsvp.js,analytics-summary.js,run-all.mjs}`.
Each scenario logs in once in `setup()` as `demo.boshliq` and reuses that session's cookies
(`devon_sid` + `devon_csrf`, sent as a manual `Cookie` + `x-csrf-token` header — k6 VUs don't share a
live cookie jar with `setup()`) for every VU; `card-move` round-robins over every real card on the
demo board so 100 VUs don't all fight over one row's lock, while `rsvp` deliberately targets the same
`(event, user)` row on purpose (see note below).

```bash
docker pull grafana/k6:2.2.0   # first time only
cd tools/perf/k6
node run-all.mjs --vus 1,10,100 --duration 30s
```

`--network host` does **not** reach the Windows host from Docker Desktop's Linux VM on this machine
(verified: `127.0.0.1:3000` inside the container is the container's own loopback, connection refused) —
`run-all.mjs` targets `http://host.docker.internal:3000`, the documented Windows fallback, instead.

| scenario | VUs | reqs | fail rate | p50 | p90 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| board load (`GET /api/v1/board`) | 1 | 131 | 0% | 30.9 ms | 34.6 ms | 35.4 ms | 39.9 ms | 49.1 ms |
| | 10 | 1 278 | 0% | 33.9 ms | 39.1 ms | 41.8 ms | 51.9 ms | 134.8 ms |
| | 100 | 2 803 | 0% | **885.8 ms** | 1 041.3 ms | **1 096.1 ms** | 1 168.7 ms | 1 238.4 ms |
| card move (`PATCH /api/v1/cards/:id`) | 1 | 130 | 0% | 35.8 ms | 39.1 ms | 40.6 ms | 46.2 ms | 52.0 ms |
| | 10 | 1 286 | 0% | 32.6 ms | 37.0 ms | 38.9 ms | 48.7 ms | 101.1 ms |
| | 100 | 3 194 | 0% | 740.6 ms | 867.9 ms | **902.2 ms** | 957.0 ms | 979.5 ms |
| RSVP (`POST /api/v1/events/:id/rsvp`) | 1 | 132 | 0% | 30.5 ms | 34.6 ms | 35.4 ms | 39.3 ms | 43.4 ms |
| | 10 | 1 302 | 0% | 29.5 ms | 34.4 ms | 36.7 ms | 46.7 ms | 157.4 ms |
| | 100 | 2 449 | 0% | 1 031.5 ms | 1 255.8 ms | **1 337.1 ms** | 1 524.9 ms | 1 999.9 ms |
| analytics summary (`GET /api/v1/analytics/summary`) | 1 | 128 | 0% | 34.9 ms | 38.2 ms | 39.6 ms | 46.2 ms | 49.4 ms |
| | 10 | 1 264 | 0% | 36.8 ms | 40.7 ms | 42.7 ms | 50.5 ms | 80.3 ms |
| | 100 | 4 392 | 0% | 485.6 ms | 564.9 ms | **613.0 ms** | 684.9 ms | 730.4 ms |

Raw per-run k6 `--summary-export` JSON: `tools/perf/k6/out/<scenario>-<vus>vu.json`; aggregated table:
`tools/perf/k6/out/results.json`.

**Against TECH-SPEC §12's perf gate ("k6 (200 VUs, p95 < 150 ms API)"):** at 100 VUs — half the gate's
target concurrency — **every one of the four endpoints already exceeds 150 ms p95 by 4-9×**
(613 ms-1 337 ms). Latency is flat and well under budget at 1 and 10 VUs, then jumps sharply between
10 and 100 VUs on all four endpoints — the shape of a resource that is fine until it saturates, not a
gradual slope. **Root cause found while writing the k6 scripts (not fixed — H3.3 "pool sizing per
process" is currently unmet):** `packages/db/src/context.ts`'s `getPool()` calls `new Pool({
connectionString })` with no `max` set, so `node-postgres` defaults to **10 connections** for the
entire API process. All four endpoints touch Postgres per request, so above ~10 concurrent in-flight
requests, additional requests queue for a pool slot rather than executing — exactly the cliff seen at
100 VUs. This is the first bottleneck H26.1 asks the load test to find; fixing it (an explicit, sized
pool per TECH-SPEC §6/H3.3, plus re-measuring) is an EPIC-014 `perf` work item, not this measurement
task.

RSVP at 100 VUs has the worst p95/p99 (1 337 ms / 1 525 ms) and the widest spread (max 2.0 s) of the
four — consistent with it being the one scenario that targets a single `(event_id, user_id)` row by
design (every VU shares the one `demo.boshliq` session; see the comment in `rsvp.js`): on top of the
shared connection-pool queueing, RSVP also serializes on that row's lock. This is a deliberately
worst-cased number, not a claim that real RSVP traffic (many distinct users, many distinct rows) would
look the same — but it is exactly the H10.1 "RSVP/seat/poll races tested with parallel requests" shape.

### 1000 VUs feasibility (board load only, 60 s)

```bash
docker run --rm --network host \
  -v "<repo>/tools/perf/k6:/scripts" -v "<repo>/tools/perf/k6/out:/out" grafana/k6:2.2.0 \
  run --vus=1000 --duration=60s -e TARGET=http://host.docker.internal:3000 \
  --summary-export=/out/board-load-1000vu.json /scripts/board-load.js
```

**Technically feasible — the process did not crash, and `/healthz` returned 200 immediately
afterward — but the API is fully saturated, not merely slow:**

| metric | value |
|---|---:|
| requests completed | 5 797 |
| throughput | 82.0 req/s (vs. ~26-44 req/s/VU-equivalent at 10 VUs, i.e. barely more total throughput than 10 VUs produced, spread across 100× more concurrency) |
| failed | 2.60% (151 requests — mix of connection resets / request timeouts under the queue) |
| p50 | 12.43 s |
| p95 | 12.80 s |
| p99 | 12.91 s |
| max VUs actually concurrent | ramped to 1000, but active VU count visibly *fell* over the run (down to 96 by the end) as k6 gave up waiting on some iterations |

**Conclusion: 1000 VUs runs, but is not a meaningful capacity point for this stack as configured** — it
is 100× past the connection-pool ceiling found above, so the number mainly demonstrates that ceiling,
not the API's real throughput. A capacity-planning load test should not be attempted again at this
concurrency until H3.3 (pool sizing) is addressed; the 200-VU target in TECH-SPEC §12 is the more
useful next data point once that fix lands.

---

## 5. Memory soak — 10 minutes at 10 VUs

Scripts: `tools/perf/k6/soak.js` (round-robins board load / card move / RSVP / analytics summary, one
request per VU per second) + `tools/perf/memory/sample-rss.mjs` (samples the API process's Windows
`WorkingSet64` every 30 s via PowerShell; falls back to `ps -o rss=` on Unix).

```bash
# terminal 1 — find the API's PID (the tsx watch child listening on :3000):
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess"

# terminal 2 — start sampling for the same duration as the soak:
node tools/perf/memory/sample-rss.mjs --pid <PID> --interval 30 --duration 600 --out ./out/rss-soak.csv

# terminal 3 — the soak itself:
docker run --rm --network host \
  -v "<repo>/tools/perf/k6:/scripts" -v "<repo>/tools/perf/k6/out:/out" grafana/k6:2.2.0 \
  run --vus=10 --duration=10m -e TARGET=http://host.docker.internal:3000 \
  --summary-export=/out/soak-10vu-10m.json /scripts/soak.js
```

**Result (10 minutes, 10 VUs, mixed board/card-move/RSVP/analytics traffic):**

- k6: 5 781 requests, **0.00% failed**, `http_req_duration` p50 34.8 ms / p90 41.7 ms / p95 44.7 ms /
  max 1.15 s (one outlier; everything else tight around the median — no gradual slowdown over the 10
  minutes). Full summary: `tools/perf/k6/out/soak-10vu-10m.json`.
- RSS (API process, PID sampled at the time = 34684), 21 samples over 601 s:
  `tools/perf/memory/out/rss-soak.csv`.

  | | value |
  |---|---:|
  | t=0 (cold, right after a fresh restart) | 560.1 MB |
  | t=600 (end) | 538.3 MB |
  | steady-state (t≥31s) min / avg / max | 530.2 / 534.5 / 540.9 MB |
  | steady-state range | 10.7 MB |

  **Memory is flat — no leak visible in this 10-minute window.** RSS oscillates within an ~11 MB band
  around 534 MB with no upward trend; the highest reading is the very first (cold-start) sample, and
  the process is at its *lowest* recorded RSS at t=511s, over 8 minutes in. `/healthz` returned 200
  immediately after the soak ended.

Note: HARDENING.md H11.1 specifies a **30-minute** soak; this baseline ran the 10-minute window the
task asked for. The AFTER pass (or EPIC-014's dedicated hardening run) should extend to the full 30
minutes — a slow leak that takes 15+ minutes to become visible in a 10-connection-pool, single-process
dev server would not necessarily show up in 10.

---

## 6. Gate status

```bash
node agentic/scripts/gate.mjs --profile release --json
```

**Result: `ok: false`. 3 gates FAILED (`migrate`, `e2e`, `a11y`), 2 gates SKIPPED-and-not-tolerated
(`security`, `perf`) — release profile tolerates neither. Full JSON: `gate-release-output.log` in this
directory (raw stdout, includes the JSON gate.mjs prints).**

| gate | status | time | why |
|---|---|---:|---|
| typecheck | pass | 13.4s | |
| lint | pass | 29.7s | |
| unit | pass | 100.5s | 226 tests / 28 files |
| i18n | pass | 1.2s | 1845 keys, 4 locales, 0 errors |
| secrets | pass | 1.4s | 0 hits |
| build | pass | 20.9s | |
| **migrate** | **FAIL** | 17.8s | see below |
| **e2e** | **FAIL** | 3.2s (as run through `gate.mjs`) | environmental — see below |
| **a11y** | **FAIL** | 3.3s (as run through `gate.mjs`) | environmental *and* a structural gap — see below |
| bundle | pass | 1.2s | 295.6 kB gz largest chunk (budget 350) |
| **security** | **SKIPPED** | — | `trivy` not on PATH (`requires_cmd`); not tolerated on `release` |
| **perf** | **SKIPPED** | — | `lhci`, `k6` not on PATH (`requires_cmd`); not tolerated on `release` — note this repo's own task instructions run both via `npx @lhci/cli@<version>` and `docker run grafana/k6`, neither of which `gate.mjs`'s `hasCmd()` (a literal `where <bin>` PATH check) can see; §3/§4 above show both tools work fine when invoked that way |
| deps | pass | 2.4s | `pnpm audit --audit-level=high`: 1 moderate vulnerability (below the `--audit-level=high` threshold, so the gate still passes) |

**`migrate` — real failure, not a product-code bug in the migrations themselves.**
`packages/db/test/migrate-verify.ts` gets through steps 1-5 clean (lint migration files; apply to a
fresh Testcontainers Postgres 17+pgvector; re-apply idempotently; tenancy registry; RLS
cross-department isolation) and crashes on **step 6/7, "RLS isolation under 20 concurrent transactions
through PgBouncer"**: `packages/db/test/harness.ts`'s `startPgBouncer()` spins up its own Testcontainers
`edoburu/pgbouncer:v1.25.2-p0`, waits for a `process up` log line (which it got — `.start()` did not
itself time out), then immediately gets `ECONNREFUSED` on **both** `::1` and `127.0.0.1` for the
container's mapped port. This is a container-readiness race (the log line firing before the mapped
port is actually accepting TCP connections), most plausibly Docker-Desktop-on-Windows-specific —
`scripts/start.mjs` already documents unrelated but similar Windows Docker networking timing/binding
quirks it had to work around while proving `pnpm start` boots. Re-running just this step in isolation
(or adding a short retry/backoff after the wait strategy resolves) would confirm; not attempted here
per this task's "measure, don't fix" scope.

**`e2e` / `a11y` — FAIL through `gate.mjs`, for an environmental reason unrelated to product code, but
digging into it surfaced two real, durable findings:**

`agentic/scripts/gate.mjs` deliberately sets `CI: '1'` on every gate subprocess's environment (line 34).
`apps/web/test/e2e/playwright.config.ts`'s `webServer.reuseExistingServer: !process.env['CI']` therefore
always resolves to `false` when run through the gate — so Playwright always tries to start its own
`pnpm --filter @devon/web dev` on port 5173, and refuses outright when that port is already occupied by
something it didn't start itself (exactly `pnpm start --demo`, which this whole baseline runs against).
That is what both failures actually say (`Error: http://127.0.0.1:5173 is already used ... or set
reuseExistingServer:true`) — **not a test failure**, a collision between "keep the demo app running to
measure it" (this task) and "the e2e gate always wants a clean port" (`gate.mjs`'s CI flag). Freeing
the port and re-running each command directly (still with `CI=1`, matching the gate's own semantics)
surfaced the real state underneath:

- **`pnpm --filter @devon/web test:e2e` (freed port): 1 passed, 1 failed — a real, reproducible bug**
  in `apps/web/test/e2e/shell.smoke.spec.ts`'s Russian-locale smoke test: `page.getByText('Пароль')`
  resolves to **two** elements — the password field's label (`Пароль`) and the "forgot password?"
  button (`Забыли пароль?`), because Playwright's `getByText` substring-matches case-insensitively and
  `Забыли пароль?` contains `пароль`. Strict-mode violation, test fails on both the initial run and its
  one CI retry. This is a test-code fragility, not a product bug (the two pieces of Russian copy are
  both correct) — the fix is a more specific locator (e.g. `getByLabel` for the field), left as a
  finding rather than fixed here (test files are out of this task's "measure, don't change product
  code" scope, and are separately in `agentic/gates.json`'s `fixer_forbidden_globs` in spirit even
  though `*.spec.ts` isn't literally matched by that glob).
- **`pnpm --filter @devon/web test:a11y` (freed port): `Error: No tests found`.** This is not
  environmental — `apps/web/test/e2e/playwright.config.ts`'s own header comment already names the gap:
  the real `@a11y`-tagged axe suite lives in the separate `e2e/**` directory (EPIC-000.9's TOUCHES), and
  wiring it into `apps/web/package.json`'s `test:a11y` script was explicitly deferred ("flagged in this
  item's NOTES for wp-lead rather than worked around here"). **The `a11y` gate as wired in
  `agentic/gates.json` is currently vacuous — it will fail with "No tests found" on every machine,
  every time, until `apps/web/package.json`'s `test:a11y` script is pointed at (or additionally runs)
  `e2e/**`'s suite.** This is the most actionable single finding in this whole gate run.

**Net effect:** on a clean CI checkout (nothing pre-bound on 5173/3000), `e2e` would very likely run to
the same one real locale-locator failure found above, and `a11y` would still hit "No tests found"
regardless of environment. `migrate` would still hit the PgBouncer race regardless of what else is
running, since it uses its own fully isolated Testcontainers. `security`/`perf` would still skip on any
machine without `trivy`/`lhci`/`k6` literally on `PATH` (this one **is** environment-dependent, and this
task's own instructions run those tools via `docker run`/`npx` specifically because they are not
expected to be pre-installed — `gate.mjs`'s tolerance model doesn't currently have a way to say "but I
ran it manually, see §3/§4 of the baseline" for that case).

Last recorded `fast`-profile run before this baseline (`agentic/ledger/last-gate.json`,
2026-09-08T01:17-01:19Z) was all-green (`typecheck`/`lint`/`unit`/`i18n`/`secrets`) — consistent with
this run's fast-equivalent gates.

Last recorded run before this baseline (`agentic/ledger/last-gate.json`, `fast` profile,
2026-09-08T01:17-01:19Z): **all 5 gates green** (`typecheck`, `lint`, `unit` — 226 tests across 28
files, `i18n` — 1845 keys/4 locales/0 errors, `secrets` — 0 hits). The `fast` profile does not run
`build`, `migrate`, `e2e`, `a11y`, `bundle`, `security`, `perf`, or `deps` — see the `release` run above
for those.

---

## Reproducing this whole baseline end to end

```bash
# 0. one-time infra change (see §0) + boot
docker compose -f infra/docker-compose.yml up -d --force-recreate postgres
docker exec devon-postgres psql -U postgres -d devon -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
pnpm start --demo   # wait for "Server listening at http://127.0.0.1:3000" and Vite's "ready in"

# 1. bundle
pnpm --filter @devon/web build
node agentic/scripts/check-bundle.mjs
node tools/perf/bundle/report.mjs

# 2. per-route requests/bytes/API/duplicates/SQL
cd tools/perf/playwright && npm install && node measure-routes.mjs && cd ../../..

# 3. Core Web Vitals (dev + prod-build)
node tools/perf/lighthouse/run-lhci.mjs --base-url http://127.0.0.1:5173 --out-tag dev
node tools/perf/lighthouse/prod-server.mjs &   # background; kill afterward
node tools/perf/lighthouse/run-lhci.mjs --base-url http://127.0.0.1:4174 --out-tag prod

# 4. k6 latency matrix + 1000 VU probe
cd tools/perf/k6
node run-all.mjs --vus 1,10,100 --duration 30s
docker run --rm --network host -v "$PWD:/scripts" -v "$PWD/out:/out" grafana/k6:2.2.0 \
  run --vus=1000 --duration=60s -e TARGET=http://host.docker.internal:3000 \
  --summary-export=/out/board-load-1000vu.json /scripts/board-load.js
cd ../../..

# 5. 10-minute soak + RSS sampling (run together)
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess"
node tools/perf/memory/sample-rss.mjs --pid <PID> --interval 30 --duration 600 --out tools/perf/memory/out/rss-soak.csv &
docker run --rm --network host -v "$PWD/tools/perf/k6:/scripts" -v "$PWD/tools/perf/k6/out:/out" grafana/k6:2.2.0 \
  run --vus=10 --duration=10m -e TARGET=http://host.docker.internal:3000 \
  --summary-export=/out/soak-10vu-10m.json /scripts/soak.js

# 6. gates
node agentic/scripts/gate.mjs --profile release --json
# NOTE: gate.mjs forces CI=1 on every gate subprocess, which makes apps/web/test/e2e/playwright.config
# .ts always try to start its own dev server on :5173 (reuseExistingServer resolves false) -- if steps
# 1-5 above left that port occupied, e2e/a11y fail on a port collision before running a single test.
# Free it first (stop just the Vite process, leave the API up) for a clean read:
#   powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5173 -State Listen).OwningProcess"
#   taskkill /F /PID <that pid>
```
