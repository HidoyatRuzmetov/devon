# Deploying Devon (WorkPortal)

**Qisqacha (uz-Latn).** Bu sahifa — ishlab chiqarish muhitida qurish va chiqarish (build/release)
bosqichlari: `infra/docker-compose.prod.yml` bilan dev muhitidan farqlar, tasvirlarni qurish,
migratsiyalarni ilovadan **oldin** qo'llash, sog'liqqa bog'langan chiqarish va orqaga qaytarish.
Noldan o'rnatish uchun `docs/ops/INSTALL.md`, yangilash uchun `docs/ops/UPDATE.md`, kundalik
amallar uchun `docs/ops/RUNBOOK.md` ni o'qing.

Ops-tooling package (`agentic/ledger/hardening/2026-09-08T06-45-00-05-00/ops-tooling.md`), H17/H18.
This is the production path -- for the local developer inner loop, use `pnpm setup && pnpm start`
(`infra/README.md`), not anything on this page.

**Newer, more complete pages supersede parts of this one**, which predates them:
`docs/ops/INSTALL.md` (zero-to-running on a fresh ministry host, with every environment variable
explained and the `/setup` ceremony), `docs/ops/UPDATE.md` + `scripts/update.sh` (the release
channel), `docs/ops/RUNBOOK.md` (every operational procedure). This page remains the reference for
what production differs from dev in, and for the build step itself.

## 0. What's different from dev

| | Dev (`infra/docker-compose.yml`) | Production (`infra/docker-compose.prod.yml`) |
|---|---|---|
| `api`/`web`/`worker` | Not containerised -- local processes via `pnpm start` | Built from `apps/api/Dockerfile`, `apps/api/Dockerfile.worker`, `apps/web/Dockerfile` |
| `postgres`/`valkey` ports | Published on the host (`55432`/`56379`) for local tools | **Not published** -- reachable only on the `devon` network |
| `caddy`, other add-ons | Behind `profiles:`, opt-in | `caddy` always on; `minio`/`clamav`/`centrifugo` still opt-in behind the same profile names |
| Resource limits / restart / logging | postgres/valkey/caddy/minio/clamav only | Every service |
| Secrets | `.env` defaults are usable placeholders | Every secret is `${VAR:?required}` -- Compose refuses to start without a real value, and `apps/api`'s own config guard (`apps/api/src/config.ts`) separately refuses to boot with a placeholder |

## 1. Prerequisites

- A Linux host (or Windows + Docker Desktop for a staging rehearsal) with Docker Engine + the Compose
  plugin. Ministry box target: single server, no orchestrator (TECH-SPEC §13, decision 2).
- A real hostname reachable by the department (or an internal DNS entry) for `DEVON_PUBLIC_URL`.
- Either a ministry-issued TLS certificate (`DEVON_TLS_CERT_FILE`/`DEVON_TLS_KEY_FILE`) or acceptance
  of Caddy's own offline-friendly internal CA (`CADDY_TLS_MODE=internal`, the air-gap-safe default --
  browsers will warn on first visit until that CA is trusted, same as any self-signed setup).
- `git clone` of this repository onto the host, e.g. under `/opt/devon`.

## 2. Configure `.env`

Copy `.env.example` to `.env` at the repo root and fill in every value the example marks as a
placeholder (`apps/api/src/config.ts`'s `LOCAL_DEV_DEFAULTS` refuses three of them outright at boot:
`CSRF_SECRET`, `DATABASE_URL`, `STORAGE_S3_SECRET_KEY` -- generate real random values, e.g.
`openssl rand -hex 32`). At minimum for the core stack:

```
POSTGRES_DB=devon
POSTGRES_SUPERUSER_PASSWORD=<random>
POSTGRES_APP_PASSWORD=<random>          # devon_app role password -- also embedded in DATABASE_URL below
POSTGRES_MIGRATOR_PASSWORD=<random>     # devon_migrator role password, used only by the migrate step
CSRF_SECRET=<random, not the .env.example value>
DEVON_PUBLIC_URL=https://work.<your-ministry-domain>
CADDY_TLS_MODE=internal                 # or omit + set DEVON_TLS_CERT_FILE/DEVON_TLS_KEY_FILE
NODE_ENV=production
CLAMAV_MODE=clamd                       # apps/api refuses NODE_ENV=production with CLAMAV_MODE=off
```

Add `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` + `STORAGE_*` if using the `minio` profile, and
`CENTRIFUGO_TOKEN_HMAC_SECRET_KEY`/`CENTRIFUGO_API_KEY` if using the `centrifugo` profile. `.env` is
never committed (H1.1) -- `infra/docker-compose.prod.yml`'s `api`/`worker` services load it via
`env_file`.

For backups (`infra/backup/backup.sh`, H19.1 -- read separately by the backup cron/systemd unit, not
by any `docker compose` service, so this is env for the HOST running the backup, not `.env` in the
compose sense): `BACKUP_ENCRYPTION_PASSPHRASE` (a real random secret -- backups are written
UNENCRYPTED with a loud warning if this is unset, never acceptable for a real deployment) and, if
mirroring to MinIO off-host (recommended), `BACKUP_MIRROR_TO_MINIO=1` with
`BACKUP_MINIO_ENDPOINT`/`BACKUP_MINIO_ACCESS_KEY`/`BACKUP_MINIO_SECRET_KEY` (falls back to the app's
own `STORAGE_S3_*` values if unset, but a dedicated backup-only credential is preferred so a
compromised app credential cannot also delete backups). Rotation for
`BACKUP_ENCRYPTION_PASSPHRASE` is documented in `docs/ops/RUNBOOK.md`'s "Rotate secrets" table --
read it before rotating; it is not a drop-in replacement like the others.

## 3. Build the images (reproducible builds, H18.1)

From the repo root, so the pnpm workspace's full lockfile and every package manifest are in the build
context (see each Dockerfile's own header comment for why):

```bash
docker compose -f infra/docker-compose.prod.yml build
```

Every build uses `--frozen-lockfile` -- it fails rather than silently resolving a dependency tree
different from the one `agentic/scripts/gate.mjs --profile release` already tested. Base images are
pinned by digest (`docker buildx imagetools inspect <image>:<tag> | grep '^Digest:'` to re-pin
deliberately). Tag and push to a registry once one exists, then set `DEVON_API_IMAGE`/
`DEVON_WEB_IMAGE`/`DEVON_WORKER_IMAGE` in `.env` so `docker compose ... up -d` pulls instead of
rebuilding on every host.

## 4. Migrations before rollout (expand/contract, H18.1)

Migrations run **before** the new `api`/`worker` containers start, never inside them (TECH-SPEC §16:
"migrations additive first"; `packages/db/migrations/*.sql` are already written expand-then-contract
-- a new column is nullable/defaulted before any code depends on it, a column is only dropped in a
later migration once nothing reads it). Postgres and Valkey must already be up:

```bash
docker compose -f infra/docker-compose.prod.yml up -d postgres valkey
docker compose -f infra/docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e POSTGRES_MIGRATOR_PASSWORD -e POSTGRES_APP_PASSWORD \
  api pnpm --filter @devon/db migrate:apply
```

Confirm before rollout: `pnpm --filter @devon/db migrate:verify` from a machine with `DATABASE_URL`
pointed at the same database (this is also `agentic/gates.json`'s `migrate` gate).

## 5. Roll out

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

**Readiness gating**: `api`/`web`/`worker` each carry a `HEALTHCHECK` (`/healthz` for api/worker,
`/` for web); `caddy` `depends_on: { api: { condition: service_healthy }, web: { condition:
service_healthy } }`, so Caddy does not start routing traffic until both are actually answering.
`GET /readyz` additionally confirms the database is reachable and every migration is applied --
point an external monitor at it, not just `/healthz` (which only proves the process is alive).

**Rolling restart** (no orchestrator here, so this is sequential, not blue/green): a plain
`docker compose -f infra/docker-compose.prod.yml up -d --no-deps api worker web` recreates only the
app-tier containers; Postgres/Valkey/Caddy are untouched. Because migrations already ran in step 4
against expand/contract-safe SQL, the old and new `api` code can both run against the same schema
during the brief window before the old container stops -- this is what makes "migrate, then roll"
safe without downtime.

**Horizontal scaling** (H12.1): `--scale worker=3` is safe today (see `apps/api/Dockerfile.worker`'s
own comment: the three background loops are written to tolerate more than one process running them
concurrently). `--scale api=N` is likewise safe (sessions live in Postgres/Valkey, not in-process --
ADR-003) but only useful once something load-balances across the replicas (Caddy's `reverse_proxy`
already round-robins/least-conns across multiple resolved addresses of a service name under Compose's
built-in DNS round robin -- verify this against your Compose version before relying on it for a real
multi-replica `api`).

## 6. Rollback (documented, H18.1)

There is no automatic rollback -- this is a single-server Compose deployment, not a orchestrator with
a deployment history. To roll back a release:

1. `docker compose -f infra/docker-compose.prod.yml stop api worker web`
2. Re-tag/rebuild the previous known-good commit's images (or `docker tag` a previously pushed image
   back onto `DEVON_API_IMAGE`/etc. if using a registry).
3. **If the failed release included a migration that is not backward-compatible with the previous
   code** (should not happen if migrations stayed expand/contract per step 4 -- this is the reason
   that discipline exists): restore from the most recent verified backup instead of rolling the schema
   back by hand (`docs/ops/RUNBOOK.md`'s restore procedure). Otherwise the previous code version can
   simply run against the already-migrated (superset) schema -- that is the entire point of
   expand/contract.
4. `docker compose -f infra/docker-compose.prod.yml up -d`

## 7. Graceful shutdown -- closed

**This section used to record a known gap. It is fixed and this text is the correction.**

`docker compose ... stop` sends SIGTERM, and `apps/api` now handles it (`apps/api/src/server.ts`'s
`registerGracefulShutdown`, `apps/api/src/bootstrap/graceful-shutdown.ts`, `apps/api/src/plugins/
shutdown.ts`): SIGTERM and SIGINT run `app.close()`, so in-flight requests finish, every `onClose`
hook runs (pg-boss graceful stop, storage close, Telegram long-poll stop, the outbox/reminder/upload
loops), the database pool is ended, and the process exits 0. A close still unfinished after 25 s is
force-exited, inside the 30 s `stop_grace_period` in `infra/docker-compose.prod.yml` -- which is why
that value was set generously in the first place.

The safety argument that made the gap tolerable still holds independently: every background loop is
written to tolerate being killed mid-cycle and resumed cold. In-flight HTTP requests are the part
that is no longer cut off.

## 8. Jobs are preserved across a deploy

pg-boss (notification digests) and the app-level job tables (`app.event_reminder_jobs`, the outbox)
live in Postgres, not in the `api`/`worker` process memory -- stopping and starting containers never
loses a queued job. A job already claimed by a container that is killed mid-processing becomes visible
again once its lock/lease expires (pg-boss's own retry semantics; the outbox/reminder tables' `for
update skip locked` / fired-guard patterns described in `apps/api/Dockerfile.worker`).

## 9. Observability during a deploy

`docker compose -f infra/docker-compose.prod.yml logs -f api worker web caddy` (JSON, rotated 10×10 MB
per service, `x-logging` in the compose file). `GET /readyz` and the super admin console's health page
(TECH-SPEC §10) are the two places to check after `up -d` before declaring a release done.

See also: `docs/ops/RUNBOOK.md` (restart, rotate secrets, restore, pause, wipe, upgrade),
`infra/README.md` (dev environment, Compose profile reference, TLS, sentinel, backups).
