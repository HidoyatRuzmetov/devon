# Real local service QA — October 2026

This is a scoped service/transport evidence ledger, not a claim of full-platform coverage. All
application data is synthetic and held in `devon_flow_e2e_realtime`. No production mutation,
production migration, Telegram call or application AI call is part of these tests.

## Implemented harness

- `FLOW_REALTIME=1` creates digest-pinned Centrifugo v6 and Valkey 8 containers on a separate,
  per-run Docker bridge. Valkey has no published port; the broker publishes only
  `127.0.0.1:48943`. API and web ports are 48941/48942.
- The namespace, random run id and immutable container/network id must all match before cleanup
  or deliberate stop/start faults. Shared `devon-*` services are never stopped or reconfigured.
- Signing/API keys are generated for the run and remain in memory and container environment.
  The ignored ownership JSON contains ids, names and port only. Keys are never sent to browsers.
- Docker context/`DOCKER_HOST` must be a local pipe or Unix socket. Remote TCP/SSH endpoints,
  remote Windows named pipes and ambiguous Unix endpoints are rejected before mutation.
- Storage must be `apps/web/test/e2e/.tmp/<validated test namespace>/storage`; existing and dangling
  symlinks/junctions are rejected. Database names and literal loopback hosts are validated before
  reset. Each namespace has separate database roles.
- Both the real test API and demo seed force `DB_POOL_MAX=6` / `DB_POOL_MIN=1`, overriding inherited
  production sizing. Concurrent QA namespaces previously exhausted shared local PostgreSQL (53300);
  its server configuration is unchanged, and real background workers remain enabled.
- Test API children inherit no AI, Telegram, SMTP, mail, S3, Centrifugo, VAPID, sentinel or
  `NODE_OPTIONS` configuration. Necessary owned broker values are injected explicitly afterward.
  Telegram polling stays false and its token/username are absent; the AI key is empty.
- The API-only Node preload refuses TCP outside the exact owned DB/broker loopback ports. It also
  refuses explicit foreign DNS lookup/resolver calls (link previews resolve before HTTP), so stored
  push endpoints, URL previews, and the default localhost sentinel cannot contact unrelated services.
  These attempts fail; no internal successful response is mocked.
- `API_HOST` retains the production/container default `0.0.0.0`; the test harness explicitly uses
  literal `127.0.0.1`. Failed startup console diagnostics redact setup and DB credentials.

Docker Desktop suppresses published ports entirely on an `--internal` bridge: the first real startup
observed empty runtime ports and failed `/health`. That attempt cleaned up its owned resources. The
working harness uses a separate ordinary bridge and has no external broker/Valkey endpoint configured;
it does not claim the Docker network itself prevents all egress. The API transport boundary and browser
host denial are separate controls.

## Verified so far

| Item | Observation | Status |
| --- | --- | --- |
| Safety regressions | 35 tests: DB/storage scope, existing/dangling junctions, local Docker endpoint, immutable ownership, CLI-like ID rejection, real allowed HTTP, six rejected TCP/HTTP transports, five rejected DNS APIs, empty allow-list refusal, diagnostics redaction | Passed |
| API bind config | 12 config tests; existing container default, explicit IPv4/IPv6 loopback, foreign/disguised hostname rejection | Passed |
| TypeScript | API and web typechecks after adding required typed API_HOST fixture | Passed |
| Production web build | Actual Vite production build and sourcemap relocation | Passed; full bundle/security gates are separate |
| Development Chromium/Firefox | Real authenticated two-browser updates, broker stop/start, fallback poll, offline missed write, reconnect and another live update; independent persisted API reads | Passed before reconnect repair |
| Development WebKit before repair | Both sockets reconnected, but the observer remained on version 3 while version 4 was committed; UI still said Live | Failed and reproduced |
| Development WebKit after repair | Same meaningful journey without reload/forced clicks/mock success, real API loopback boot | Passed (16.7 s) |
| Production assets preview | Same journey, real Valkey presence, hashed `/assets/` scripts and no dev entry | Passed: Chromium 15.3 s, Firefox 18.3 s, WebKit 15.9 s |
| Publisher-only failure before repair | Owned broker HTTP key differs from application's key (real HTTP 401), signed sockets reconnect, version 2 commits, connected observer stays on version 1 for 35 s | Failed and reproduced in Chromium |
| Both journeys after reconciliation repair, production assets | Two meaningful browser tests in each engine; publisher-only case still requires the same 35 s bound, zero publications and authenticated socket | Passed: 6 expected, 0 skipped, 0 unexpected, 0 flaky |

Before pixels for the WebKit stale defect are preserved in
`artifacts/qa/2026-10/realtime/before-stale-webkit/observer.png` and `editor.png`; both were visually
inspected. The ignored trace is preserved alongside them. The observer screenshot actually shows
“Realtime version 3 during outage” and “Live”, while the editor shows committed version 4.

The DNS guard exposed another startup error: the old server hardcoded an all-interface bind and
Node performed `dns.lookup('0.0.0.0')`. Rather than exempting that bind from isolation, the API_HOST
repair makes the real test process listen on loopback. Successful real boot is verified by the
subsequent WebKit journey, not only by a mocked config test.

The second stale-state defect was initially a source hypothesis and was then reproduced through a
real broker credential fault. `withOwnedPublisherFault` preserves the broker's signing key, rotates
only its HTTP API key, verifies the original publisher key receives HTTP 401, and restores the key
after the journey. A persisted member API read sees version 2, but the connected browser still shows
version 1 with “Live” after 35 seconds and receives no card publication. Pixels/trace/result evidence
are preserved under `artifacts/qa/2026-10/realtime/before-publisher-only/`; the observer image was
visually inspected. No positive response, publication, failed authentication or database state is
mocked. This demonstrates why transport reconnection alone is insufficient when publication itself
is best-effort. The root agent repaired a shared 30-second reconciliation policy while visible and
online, retaining protections for pending optimistic mutations and catching up on reconnect/online.
Both original meaningful journeys then passed in all three engines through freshly rebuilt assets:

| Engine | Broker/offline/reconnect journey | Publisher-only fault journey |
| --- | --- | --- |
| Chromium | 16.8 s | 42.6 s |
| Firefox | 19.7 s | 43.3 s |
| WebKit | 18.7 s | 44.6 s |

These are total journey durations including setup and real broker recreation; the committed-write
reconciliation assertion remains 35 seconds (30-second policy plus scheduling margin). There are
no blanket test retries. The final summary is
`artifacts/qa/2026-10/realtime-production-build-results.json`; recovered screenshots live under its
distinct `results/realtime-production-build` directory. Owned Docker container/network lists were
empty after teardown, and the nonsecret ownership file was removed. The synthetic local DB remains
available for diagnostics and is reset only by the next guarded run.

The initial three-engine production-assets proof is scoped to the realtime board/presence journey while
other source edits were still in progress. It is not the final release build of all repairs. Its
summary is preserved at `artifacts/qa/2026-10/realtime/production-board-presence-three-engines.json`.
The after-reconnect WebKit image was also inspected and preserved at
`artifacts/qa/2026-10/realtime/after-reconnect-webkit.png` (version 5, Live, other user's avatar).

## Repeat locally

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_realtime'
$env:FLOW_API_PORT='48941'
$env:FLOW_WEB_PORT='48942'
$env:FLOW_CENTRIFUGO_PORT='48943'
$env:FLOW_REALTIME='1'
pnpm --filter @devon/web exec playwright test --config test/e2e/realtime-qa.config.ts

pnpm --filter @devon/web build
$env:FLOW_PRODUCTION_BUILD='1'
pnpm --filter @devon/web exec playwright test --config test/e2e/realtime-qa.config.ts
```

Development and production-assets suites have distinct absolute output directories under
`artifacts/qa/2026-10/results/realtime*`; no other agent's evidence directory is cleaned.

## Limits and remaining verification

The local API currently runs development mode with its explicit scanner-off exception. This proves
real local API, DB, storage wiring, outbox delivery, broker and browser interactions; it does **not**
prove the production API runtime/ClamAV scanning path. Application AI and Telegram E2E remain excluded
in this local phase. Email has no SMTP delivery client in the inspected application; web-push and
external link-preview delivery are blocked here and are not counted as successful external tests.
No full-platform route/state/locale/accessibility coverage is implied by this slice. Independent
review, complete gates and eventual authorized deployment remain the root task's responsibility.
