# H18.1 graceful shutdown — follow-up to the ops-tooling package's flagged gap

Cycle `2026-09-08T06-45-00-05-00` · branch `claude/dazzling-wu-97fed9` · scope: `apps/api` only
(`src/bootstrap/graceful-shutdown.ts` new, `src/server.ts` wired, `test/unit/graceful-shutdown.test.ts` new).
Origin: `apps/api/Dockerfile` (hd/ops-tooling, c4abd19) CMD comment — "`docker stop` … exit code 143 …
`server.ts` registers no `process.on('SIGTERM')` handler … out of this package's edit scope".

| Item | Status | Evidence | Commit |
| --- | --- | --- | --- |
| H18.1 graceful shutdown | done | §2 unit tests, §3 before/after `docker stop` of the production image | this change (`git log -1 -- apps/api/src/bootstrap/graceful-shutdown.ts`) |
| H13.1 safe restart (drain on SIGTERM) | done | §3: in-flight `onClose` hooks run, exit 0 | same |
| H18.1 jobs preserved | already-met, now reachable | the `onClose` hooks that stop the outbox / reminder / upload-sweep timers and `boss.stop({ graceful: true })` the pg-boss runners existed; they simply never ran on SIGTERM before | same |

## 1. What changed

- `registerGracefulShutdown({ close, log, proc?, timeoutMs?, signals? })` listens for `SIGTERM` and
  `SIGINT` on `proc` (defaults to `process`; tests pass an EventEmitter with a recording `exit`).
- First signal: `log.info(... 'shutdown: signal received, closing')`, start an **unref'd 25 s force-exit
  timer**, `await close()`, then `log.info('shutdown: closed cleanly')` + `exit(0)`. `close()` rejecting →
  `log.error('shutdown: close failed')` + `exit(1)`. Timer firing first → `log.error('shutdown: close did
  not finish in time, forcing exit')` + `exit(1)`; a late `close()` can no longer exit again (`exitOnce`).
- **Repeated signal** while closing: `log.warn('shutdown: already in progress, ignoring repeated
  signal')` — `close()` is never re-entered, the timer is never restarted, exit happens once.
- `server.ts` wires it right after the worker-stopping `onClose` hook and before `listen()`, with
  `close: async () => { await app.close(); await closePool() }` — Fastify stops accepting, in-flight
  requests finish, every `onClose` hook runs (server.ts timers, notifications/analytics pg-boss graceful
  stop, storage `store.close()`), then the pg pool is ended (server.ts is the one file that owns it).
- 25 s vs `stop_grace_period: 30s` (`infra/docker-compose.prod.yml`, hd/ops-tooling): a stuck hook is
  force-exited with a logged reason before Docker's SIGKILL (137) would erase it. pg-boss's own
  `stop({ graceful: true })` default timeout is 30 s, so the force-exit is the binding bound.

## 2. Unit tests (`apps/api/test/unit/graceful-shutdown.test.ts`, part of the `unit` gate)

```
 ✓ test/unit/graceful-shutdown.test.ts (7 tests)
   ✓ listens for SIGTERM and SIGINT on the given process
   ✓ on SIGTERM closes once, logs start and end, and exits 0
   ✓ a repeated signal while closing is logged and ignored: close() once, exit once
   ✓ force-exits 1 when close() outlives the timeout; a late close() cannot exit again   (fake timers, 24 999 ms → nothing, +1 ms → exit 1)
   ✓ exits 1 and logs the error when close() rejects
   ✓ clears the force-exit timer after a clean close, so nothing fires later               (vi.getTimerCount() === 0)
   ✓ a signal reaches a real Fastify app: its onClose hooks run, then the process exits 0  (real buildApp(), fake process)
 Test Files  1 passed (1)   Tests  7 passed (7)
```

## 3. Before / after: `docker stop` on the production image (the ledger's original repro)

Setup, so no developer credentials are involved (the local `devon-postgres` uses a real `.env` password):

```bash
# throwaway pgvector on a spare port, compose superuser default, then the repo's own migrations
docker run -d --name devon-pg-h18 -p 15999:5432 -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=devon_local_dev_root -e POSTGRES_DB=devon \
  pgvector/pgvector:0.8.6-pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f
MIGRATION_DATABASE_URL=postgres://postgres:devon_local_dev_root@127.0.0.1:15999/devon \
  POSTGRES_MIGRATOR_PASSWORD=devon_local_dev_migrator POSTGRES_APP_PASSWORD=devon_local_dev_app \
  pnpm --filter @devon/db migrate:apply        # applied 25 migration(s)
# image from THIS branch, built with hd/ops-tooling's Dockerfile (git show hd/ops-tooling:apps/api/Dockerfile)
docker build -f <that Dockerfile> -t devon-api:h18-verify .
docker run -d --name devon-api-h18-verify -p 13000:3000 -e NODE_ENV=development -e LOG_LEVEL=info \
  -e DATABASE_URL=postgres://devon_app:devon_local_dev_app@host.docker.internal:15999/devon \
  -e CSRF_SECRET=<any> -e STORAGE_DRIVER=local -e CLAMAV_MODE=off <image>
# wait for "Server listening", curl /healthz → 200, then:
docker stop -t 30 devon-api-h18-verify; docker inspect -f '{{.State.ExitCode}}' devon-api-h18-verify; docker logs devon-api-h18-verify | tail -3
```

**BEFORE** — `devon-api:test` (master code, the image the ops-tooling package built):

```
--- GET /healthz from host: 200
--- docker stop took 2107 ms
--- container exit code: 143
--- log after stop (last lines): … "msg":"request completed"      ← nothing after the last request
```

**AFTER** — `devon-api:h18-verify` (this branch, same Dockerfile, same `node_modules/.bin/tsx src/server.ts` CMD):

```
--- GET /healthz from host: 200
--- docker stop took 1932 ms
--- container exit code: 0
{"level":30,"time":1788844545294,"pid":23,"signal":"SIGTERM","timeoutMs":25000,"msg":"shutdown: signal received, closing"}
{"level":30,"time":1788844545321,"pid":23,"signal":"SIGTERM","msg":"shutdown: closed cleanly"}   ← 27 ms later
```

This also proves `tsx` (the image's CMD) relays SIGTERM to the Node child and waits for it.
Throwaway container and image removed afterwards (`docker rm -f -v devon-pg-h18`, `docker rmi devon-api:h18-verify`).

## 4. Gates (`node agentic/scripts/gate.mjs --profile fast`, this worktree, after the change)

```
[gate] typecheck … PASS (38.5s)
[gate] lint … PASS (37.8s)
[gate] unit … PASS (118.3s)
[gate] i18n … PASS (1.2s)
[gate] secrets … PASS (1.9s)
[gate] profile=fast ok=true failed=[] skipped=[]
```

## 5. Notes for the merge agent

- `apps/api/Dockerfile` and `infra/docker-compose.prod.yml` (hd/ops-tooling) need no change; the
  Dockerfile's "KNOWN GAP" CMD comment can be shortened to a pointer at this file once both land.
- Force-exit code is 1 (distinct from a clean 0 and from SIGKILL's 137) so a dashboard can tell the
  three apart. Exit on `close()` rejection is also 1.
- Not done, out of this item's scope, worth a `proposed` backlog entry: `/readyz` does not flip to 503
  during the drain window. Today Fastify stops accepting at `close()` start, so during a rolling restart
  behind Caddy new connections are refused rather than routed away first; a pre-stop readiness flip
  (plus a short delay before `close()`) would make zero-downtime rollouts cleaner (TECH-SPEC §13).
