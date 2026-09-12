# Devon (WorkPortal) operations runbook

Ops-tooling package (`agentic/ledger/hardening/2026-09-08T06-45-00-05-00/ops-tooling.md`). Pairs with
`docs/ops/DEPLOY.md` (build/release) and `infra/README.md` (environment reference). All commands
assume the repo at `/opt/devon` on the production host and `infra/docker-compose.prod.yml`; substitute
your actual path.

## Restart

**One service** (does not touch its data/volumes):
```bash
docker compose -f infra/docker-compose.prod.yml restart api
```

**Whole stack** (Postgres/Valkey data survives -- named volumes, not container filesystems):
```bash
docker compose -f infra/docker-compose.prod.yml down
docker compose -f infra/docker-compose.prod.yml up -d
```

**After a host reboot**: every service has `restart: unless-stopped`, so Docker's own daemon restart
policy brings the stack back automatically once Docker starts -- nothing to do by hand unless a
service was manually `stop`ped before the reboot (its `unless-stopped` state is remembered).

## Rotate secrets

Devon has no live secret-rotation endpoint -- rotating any of these means updating `.env` and
restarting the services that read it. None of this is exercised automatically; do a maintenance-mode
pause (below) for anything that would otherwise 500 mid-rotation (a session secret change, for one).

| Secret | Rotate by | Blast radius |
|---|---|---|
| `CSRF_SECRET` | Generate a new random value, update `.env`, `docker compose ... up -d --no-deps api worker`. | Every open session's CSRF token becomes invalid -- users see a CSRF failure on their next unsafe request and must reload. Low-traffic-window rotation recommended. |
| `POSTGRES_APP_PASSWORD` | `ALTER ROLE devon_app WITH PASSWORD '<new>'` as the Postgres superuser (or re-run `packages/db/migrations/0001_roles.sql`'s logic, which the migrator does idempotently with a new `POSTGRES_APP_PASSWORD` env value), update `.env`'s `DATABASE_URL`, restart `api`/`worker`. | Every `api`/`worker` container fails to connect until restarted with the new value -- rotate `api`/`worker` immediately after the ALTER, not on a delay. |
| `MINIO_ROOT_USER`/`_PASSWORD` | Rotate via MinIO's own admin (`mc admin user ...`) if using scoped credentials (recommended over rotating root); if rotating root itself, update `.env`'s `STORAGE_S3_ACCESS_KEY`/`_SECRET_KEY` and restart `api`/`worker`/`minio`. | Presigned URLs issued before rotation with the old key keep working until they expire (they carry their own signature); new presigns need the new key already live in `api`. |
| `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` / `CENTRIFUGO_API_KEY` | Update `.env`, restart `centrifugo` and `api`. | Every connected realtime client is disconnected and must reconnect with a freshly issued token; no data loss (Centrifugo holds no durable state here -- design.md §0). |
| Sentinel keypair (`infra/sentinel/scripts/keygen.mjs`) | Generate a new keypair, update the sentinel's config (`sentinel.conf`, never in this repo) and whatever holds the matching private key for the super admin console/CLI, restart `devon-sentinel`. | The wipe/pause-signalling channel is unusable between key rotation on one side and the other -- rotate both ends in the same maintenance window. |
| TLS certificate (ministry-issued) | Replace the files at `DEVON_TLS_CERT_FILE`/`DEVON_TLS_KEY_FILE`, `docker compose ... restart caddy` (Caddy reloads certs without dropping connections on a plain restart is not guaranteed by this runbook -- expect a brief blip). | Browsers see the new cert on next handshake; no user data affected. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Generate a new random value; **decrypt every existing `.dump.gpg` under `BACKUP_DIR` with the OLD passphrase and re-encrypt with the new one first** (`gpg --decrypt` / `infra/backup/backup.sh`'s own encryption block, done by hand), then update wherever this env var is set for the backup cron/systemd unit (`infra/backup/crontab.example`, `infra/backup/systemd/*.service`). | Any backup still encrypted under the old passphrase becomes unrestorable the moment the old value is discarded -- never rotate this one without the re-encryption step done first, and keep the old passphrase until every existing backup has been migrated or has aged out under retention. |
| `RENOVATE_TOKEN` (GitHub PAT/App token, `.github/workflows/renovate.yml`) | Generate a new fine-grained token with the same repo-scoped Contents/Pull requests/Workflows permissions (`renovate.yml`'s own header comment), update the `RENOVATE_TOKEN` repo secret under Settings -> Secrets and variables -> Actions, revoke the old token at its issuer. | The next scheduled Renovate run fails closed (bad credentials) until rotated -- no application impact, since Renovate only opens PRs, it is never in the runtime request path. |

## Restore (from backup)

See `infra/README.md`'s "Backups" section for the full script reference. Quick path:

```bash
# 1. Inspect what's available
ls -la "${BACKUP_DIR:-/opt/devon/backups}"/devon-*.dump

# 2. Restore into a THROWAWAY database first, always -- inspect before cutting over
infra/backup/restore.sh /opt/devon/backups/devon-devon-<timestamp>.dump

# 3. Once satisfied, restore over the live database (destructive, requires typed confirmation)
infra/backup/restore.sh /opt/devon/backups/devon-devon-<timestamp>.dump devon --force-production
```

Before step 3, put the app in maintenance mode (below) and stop `api`/`worker` (`docker compose
-f infra/docker-compose.prod.yml stop api worker`) so nothing writes to the database mid-restore.
After step 3, restart them and confirm `GET /readyz` is `200` before lifting maintenance mode.

**Weekly automated verification** (`infra/backup/verify.sh`, wired to `devon-backup-verify.timer` /
`crontab.example`) already restores the newest backup into a throwaway database and checks the `app`/
`audit` schemas came back with tables intact -- a non-zero exit from that job means the most recent
backup is bad and should alert immediately, before it is ever needed for a real restore.

**Quarterly drill** (H19.1): `infra/backup/quarterly-drill.sh` (this package) runs a deeper check than
the weekly job -- restores the newest backup, spot-checks row counts across every `app`/`audit` table
against the manifest recorded at backup time, times the whole restore, and writes a dated report under
`agentic/ledger/backups/`. Run it by hand once a quarter (or from a systemd/cron entry on the same
schedule as the weekly job, quarterly instead) and read the report; a growing restore time is an early
warning that `pg_dump`/`pg_restore` alone will eventually miss an RPO/RTO target, at which point
implementing the pgBackRest WAL-PITR path already declared (inert) in `infra/docker-compose.yml`
becomes worth the effort.

## Pause (maintenance mode)

TECH-SPEC §11: a super admin toggles this from the admin console (`PUT /api/v1/admin/maintenance`) --
no host access needed for the common case. From the console: Admin -> System -> Maintenance mode ->
write the four-locale message -> confirm. Effects: every page renders the branded message (super admin
login and console stay reachable), every API call returns `503` with the message body, the Telegram
bot answers with the message, and `infra/Caddyfile`'s `handle_errors` block serves the same static
page if `api`/`web` are unreachable at the network level (not just paused at the app level) -- so a
maintenance message is visible even if the outage is total.

**Host-level equivalent** (API/console unreachable, or the super admin account itself is locked out):
put Caddy alone in front of the maintenance page by stopping `api`/`web`:
```bash
docker compose -f infra/docker-compose.prod.yml stop api web worker
```
`infra/Caddyfile`'s `handle_errors` block now serves `infra/maintenance/maintenance.html` for every
request (Caddy itself, and Postgres/Valkey, stay up). Reverse with `up -d api web worker`.

**Pausing a single department** (not the whole instance): `POST /api/v1/admin/departments/:id/pause`
from the console -- that department's board/board views render its own paused state; unrelated
departments are unaffected.

## Wipe (destructive, no undo -- decision 16)

Read `infra/README.md`'s sentinel section and `TECH-SPEC.md` §11 in full before ever running this on a
real host. Summary:

1. **Via the console** (normal path): super admin console -> System -> Wipe -> type the department-
   count phrase shown -> re-enter password -> confirm 2FA if enabled -> 60-second cancellable
   countdown. The console signs a `wipe` command and sends it to `infra/sentinel/` (a host-local
   service on `127.0.0.1` only -- unreachable from any container or the network).
2. **Via the host CLI** (for the CTO, no console access needed):
   ```bash
   node infra/sentinel/scripts/devon-wipe.mjs --confirm --key-file /path/to/sentinel-private-key
   ```
3. The sentinel stops and removes the project's containers, images and volumes, deletes the project
   directory, backups and logs under `/opt/devon`, and writes one line to `/var/log/devon-wipe.log`.
   **There is no recovery from this** unless a backup was independently copied off this host (this
   deletes `/opt/devon/backups` too) -- an off-host backup copy (rsync/S3/etc. of `infra/backup/`'s
   output, not documented further here since it is site-specific) is the only way a wipe is not also a
   permanent data loss event.

## Upgrade

1. Read the release's changelog / migration notes for any manual step (should be rare -- migrations
   are additive-first).
2. `git -C /opt/devon fetch && git -C /opt/devon checkout <tag>`.
3. Follow `docs/ops/DEPLOY.md` steps 3-5 (build, migrate, roll out) -- the same procedure as a first
   deploy, run again.
4. Confirm `GET /readyz` is `200` and spot-check the super admin console's health page.
5. If anything is wrong, follow `docs/ops/DEPLOY.md`'s rollback section immediately -- do not
   troubleshoot forward against production traffic.

## Health checks to know

| Endpoint | Meaning |
|---|---|
| `GET /healthz` | Process is up. No DB/Valkey check -- a `200` here does NOT mean the app can serve real traffic. |
| `GET /readyz` | `200` iff the database is reachable AND every migration is applied (Valkey reported `true` unconditionally today -- HARDENING follow-up, not this package's scope: see `apps/api/src/modules/health.ts`). Point load-balancer/monitoring health checks here, not at `/healthz`, for anything that gates traffic. |
| Super admin console health page (TECH-SPEC §10) | Queues, DB, storage, Telegram, AI endpoint latency, backups -- the human-facing view of the same signals. |
