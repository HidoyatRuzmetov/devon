# Updating a running Devon (WorkPortal) deployment

**Qisqacha (uz-Latn).** Yangilanish tartibi qat'iy va o'zgartirilmaydi: **avval zaxira nusxa** (va u
haqiqatan tiklanishini tekshirish), keyin yangi versiyani olish, so'ng **migratsiyalarni ilovadan
oldin** qo'llash, keyin konteynerlarni yangilash va `/readyz` javobini kutish. Migratsiyalar har doim
qo'shimcha (expand → migrate → contract), shuning uchun eski kod yangi sxemada ham to'g'ri ishlaydi —
aynan shu narsa yangilanishni uzilishsiz qiladi. Orqaga qaytarish faqat **kodni** qaytaradi, sxemani
emas. Hammasini `sudo -u devon bash scripts/update.sh --to v1.2.0` bajaradi.

---

```bash
cd /opt/devon
sudo -u devon bash scripts/update.sh --to v1.2.0
```

That single command is this whole page, in the right order, with a health gate and a printed rollback
procedure if anything fails. Read the rest to know what it is doing and when to deviate.

## The update channel

| | |
|---|---|
| **What you upgrade to** | A **git tag** (`v1.2.0`), never a branch. A branch moves; a tag is a specific tested tree, and it is what `agentic/scripts/gate.mjs --profile release` ran against |
| **How the code arrives** | `git fetch --tags && git checkout --detach <tag>` on the host, then either a local `docker compose build` or a `pull` of pre-built images when `DEVON_API_IMAGE`/`DEVON_WEB_IMAGE`/`DEVON_WORKER_IMAGE` are set in `.env` |
| **How often** | Whenever a release is cut. There is no auto-update and there will not be one: an unattended upgrade of a system that holds a department's whole week is a worse failure mode than being a version behind |
| **Who** | The `devon` service account, from the host. Never from CI directly into production |
| **Downtime** | None for a normal release. Caddy keeps serving; only `api`, `worker` and `web` are recreated |

To see what is between your version and the next one — and specifically whether it carries
migrations or changed ops procedures:

```bash
git fetch --tags
git log --oneline "$(git describe --tags --abbrev=0)..v1.2.0" -- packages/db/migrations docs/ops
```

## The order, and why it cannot change

### 1. Backup first — and verify it

```bash
sudo -u devon bash infra/backup/backup.sh
sudo -u devon bash infra/backup/verify.sh
```

The backup is the only thing that makes the update reversible. A backup taken *after* a bad migration
is a backup of the bad state, which is why it comes first and why `scripts/update.sh` refuses to
reorder it. `verify.sh` then restores that backup into a throwaway database — an unverified backup is
a hope, not a rollback plan.

### 2. Fetch the release

```bash
git fetch --tags --prune
git checkout --detach v1.2.0
```

`scripts/update.sh` refuses to proceed with a dirty working tree. An update that silently carries
someone's hand-edit forward is not reproducible, and the hand-edit is exactly the thing that will be
lost or blamed later.

### 3. Build or pull

```bash
docker compose -f infra/docker-compose.prod.yml build         # or: ... pull
```

Every build runs `pnpm install --frozen-lockfile`: it fails rather than silently resolving a
dependency tree different from the one the release gate tested. Base images are pinned by digest —
a tag can be repointed by the registry, a digest cannot (H18.1).

### 4. Migrate — before the new code runs

```bash
docker compose -f infra/docker-compose.prod.yml up -d --wait postgres valkey
docker compose -f infra/docker-compose.prod.yml run --rm --no-deps \
  -e MIGRATION_DATABASE_URL \
  api pnpm --filter @devon/db migrate:apply
```

Migrations never run inside the application containers (H18.1). They run once, as the Postgres
superuser, against a database whose old application version is still happily serving traffic.

**This is only safe because every migration in this project is expand-then-contract (I-15).** A new
column arrives nullable or defaulted *before* any code reads it; a column is dropped only in a later
release, once nothing reads it any more. So during the rollout window the old code and the new code
are both correct against the same schema. That discipline is the entire reason "migrate, then roll"
works without downtime — and it is why there is no down-migration to run here, and never will be.

`migrate:apply` is idempotent: it applies only what `app._migrations` does not already list. Running
it twice does nothing the second time.

### 5. Roll out

```bash
docker compose -f infra/docker-compose.prod.yml \
  --profile minio --profile clamav --profile centrifugo up -d --no-deps api worker web
```

`--no-deps` recreates only the application tier. Postgres, Valkey and Caddy are untouched, so the
database is never restarted for a code release and the maintenance page stays reachable throughout.

`apps/api` handles `SIGTERM`: it stops accepting new connections, lets in-flight requests finish, and
then closes its pools, within the `stop_grace_period: 30s` the compose file allows. In-flight
requests are not cut off.

Queued work survives: pg-boss jobs and the app-level job tables (`app.event_reminder_jobs`, the
outbox) live in Postgres, not in process memory. A job claimed by a container that is stopped
mid-processing becomes visible again when its lease expires.

### 6. Health gate — `/readyz`, not `/healthz`

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://work.ministry.uz/readyz    # must be 200
```

`docker compose up -d` returns as soon as the containers are *created*, long before the API can
answer anything. And `/healthz` only proves the process is alive — a release that cannot reach the
database satisfies it. `/readyz` is `200` only when the database is reachable **and** every migration
is applied. `scripts/update.sh` polls it and fails the update if it never turns green.

Then, by hand, before you call the release done:

- open the super admin console's health page (queues, DB, storage, Telegram, AI latency, backups);
- sign in as a real member and move one card — prove the write path, not just the read path;
- watch the logs for five minutes: `docker compose -f infra/docker-compose.prod.yml logs -f api worker`.

## Rollback

```bash
sudo -u devon bash scripts/update.sh --rollback   # prints the exact commands for this host
```

There is no automatic rollback: this is a single-host Compose deployment, not an orchestrator with a
deployment history.

1. `git checkout <previous tag>`
2. Rebuild (or re-tag the previous image) and `docker compose ... up -d`.
3. Confirm `/readyz` is `200`.

**You roll the code back. You never roll the schema back.** The previous code runs unchanged against
the already-migrated, superset schema — that is what expand/contract buys. The one case where this is
not enough is a release that shipped a genuinely backward-incompatible migration, which should not
happen and is a defect if it does: then the path is a restore from the backup taken in step 1
(`RUNBOOK.md` → "Restore"), not a hand-written reverse migration.

Roll back immediately rather than troubleshooting forward against production traffic. The
investigation is cheaper on a healthy system.

## On k3s

```bash
sudo -u devon bash scripts/update.sh --to v1.2.0 --target k3s
```

Same order, different verbs: the migration step becomes a Job (deleted then applied — a Job's pod
template is immutable, so the same name cannot be re-applied), and the rollout becomes
`kubectl apply -k infra/k3s` gated on `kubectl rollout status`. Rollback is
`kubectl -n devon rollout undo deploy/devon-api` (plus `worker` and `web`). Set the image references
first:

```bash
cd infra/k3s && kustomize edit set image devon-api=registry.example.uz/devon/api@sha256:... && cd -
```

Details: `infra/k3s/README.md`.

## When an update needs a maintenance window

Most do not. These do:

| Situation | Why | What to do |
|---|---|---|
| The release notes name a **contract** migration (a column or table being dropped) | Old code may still read it during the rollout | Pause first (`RUNBOOK.md` → "Pause"), migrate, roll out, resume |
| `CSRF_SECRET` is being rotated in the same window | Every open session's CSRF token becomes invalid mid-flight | Pause, rotate, roll out, resume |
| Postgres itself is being upgraded across a major version | `pg_upgrade` / dump-and-restore is not a rolling operation | Full window: pause, backup, upgrade, restore, verify, resume |
| The database is being restored from backup | Nothing may write to it during a restore | Pause, stop `api`/`worker`, restore, start, verify `/readyz`, resume |

Pausing is a super admin toggle in the console (`PUT /api/v1/admin/maintenance`) with a four-locale
message — no host access needed for the common case.

## After the update

- `systemctl list-timers 'devon-*'` — the backup, verify and restore-drill timers survive a
  `git checkout` because `scripts/install.sh` installs the units and keeps local settings in a
  systemd drop-in. Re-run `sudo bash scripts/install.sh` after an update that changed the unit files;
  it is idempotent and will not touch `.env`.
- Read `agentic/ledger/backups/` after the next Sunday: the weekly restore drill is what proves the
  new schema still round-trips through a backup.
- If the release added or renamed an environment variable, the API refuses to boot rather than
  starting with a wrong default (H7.3). The error names the variable.
