# infra/

Everything needed to run Devon (WorkPortal) on a single ministry box: Postgres + Valkey by default,
a reverse proxy, object storage, realtime fan-out, malware scanning, error tracking and backups behind
Compose profiles, plus the host-level sentinel that a later epic wires up to pause/wipe the deployment.
Read `docs/03-plan/TECH-SPEC.md` §13 and `agentic/ledger/cycles/EPIC-000/design.md` (ADR-002, ADR-011)
for the decisions behind what is here; this file is the operator's how-to.

## What `pnpm setup` / `pnpm start` actually boot

`scripts/start.mjs` runs exactly:

```bash
docker compose -f infra/docker-compose.yml up -d postgres valkey
```

Those are the only two services in `infra/docker-compose.yml` **without** a `profiles:` entry, so
they are the only two Compose ever starts by default (I-18: nothing else is needed for a fresh clone).
Every other service below is declared, pinned, and unused until its owning epic wires it up.

## Compose profiles

```bash
docker compose -f infra/docker-compose.yml config --services              # postgres valkey (default)
docker compose -f infra/docker-compose.yml --profile caddy up -d          # + reverse proxy
docker compose -f infra/docker-compose.yml --profile minio up -d          # + object storage
docker compose -f infra/docker-compose.yml --profile centrifugo up -d     # + realtime fan-out
docker compose -f infra/docker-compose.yml --profile clamav up -d         # + malware scanning
docker compose -f infra/docker-compose.yml --profile glitchtip up -d      # + error tracking
```

Profiles can be combined (`--profile caddy --profile minio ...`). None of them are started by
`pnpm setup`/`pnpm start` (AC-1's disproof: any extra manual step or unexpected service fails it).

**Status of each profiled service in this epic** (EPIC-000 ships the skeleton; wiring lands with the
epic that needs the service — design.md §0's "simplicity budget"):

| Service | Image | Wired by this epic? |
|---|---|---|
| `caddy` | `caddy:2-alpine` | Config validated (`caddy validate`), written against `api`/`web`/`centrifugo` service names that do not exist yet -- no rework needed when they land (TECH-SPEC §13's deployment-image epic). |
| `minio` | `minio/minio` | Declared only. Wired with the file-upload epic, which also adds `MINIO_*` to `.env.example`. |
| `centrifugo` | `centrifugo/centrifugo:v6` | Declared only (config via env vars, no mounted file needed). Wired with the realtime epic. |
| `clamav` | `clamav/clamav:1.4` | Declared only. Air-gapped boxes must mirror the ClamAV virus-definition feed themselves (`freshclam` needs internet by default) -- wired with the upload-scanning epic. |
| `pgbackrest` | `woblerr/pgbackrest` | Declared only, deliberately inert (see `infra/docker-compose.yml`'s comment on that service) -- **the working backup path today is `infra/backup/*.sh`, below.** WAL-level PITR is TECH-SPEC §13's "drilled in EPIC-014" follow-up. |
| `glitchtip` | `glitchtip/glitchtip` | Declared only. Needs a `glitchtip` database created manually on `postgres` before it will boot (`docker compose exec postgres createdb -U postgres glitchtip`) until the observability epic adds a proper init step. |

### Re-pinning an image digest

Every image is pinned by its content digest (H18.1), not just a tag -- a tag can be repointed at a
different image by the registry; a digest cannot. To move to a newer version deliberately:

```bash
docker buildx imagetools inspect <image>:<new-tag> | grep '^Digest:'
```

Paste the resulting `sha256:...` into `infra/docker-compose.yml` alongside the tag (the tag is there
for a human reading the file; Compose always resolves the digest).

## TLS (`caddy` profile)

`infra/Caddyfile` defaults to Caddy's own internal CA (`tls internal`), which works fully offline --
correct for a ministry box with no internet access and no public DNS name. To use a ministry-issued
certificate instead, replace the `tls internal` line with:

```
tls {$DEVON_TLS_CERT_FILE} {$DEVON_TLS_KEY_FILE}
```

and mount the two PEM files into the `caddy` container. Only switch to Caddy's public ACME path (by
removing the `tls` line entirely) if the box has real internet access and a public DNS record --
which by definition an air-gapped ministry network does not.

## The sentinel (`infra/sentinel/`)

A tiny, **dependency-free** Node service (ADR-011) that runs on the host via systemd, never inside a
container, and listens on `127.0.0.1:8787` only. In this epic it accepts exactly one command --
`noop` -- and executes nothing destructive; the pause and wipe switches (decision 16, TECH-SPEC §11)
arrive in EPIC-013 as a new allow-list entry, a new executor and a new ADR, reusing the transport,
signature verification and replay protection built here unchanged.

**Why it is not a pnpm workspace package.** `pnpm-workspace.yaml` (root file, owned by EPIC-000's W1
work item) globs `apps/*` and `packages/*` only. Adding `infra/sentinel` to that glob is one line but
is out of this item's `TOUCHES`; it is flagged here as the declared follow-up so `pnpm --filter
@devon/sentinel prove` (design.md §9's evidence command) starts working verbatim once it lands.
Nothing about `infra/sentinel` needs the workspace in the meantime: it has zero dependencies, so
there is nothing to `pnpm install`, and every script below runs with a plain `node` invocation from
this directory.

### Set up a keypair (once, per environment)

```bash
node infra/sentinel/scripts/keygen.mjs
```

Prints a `public_key=...` line (paste it into `/etc/devon/sentinel.conf`, see
`infra/sentinel/sentinel.conf.example`) and a `private_key=...` line. **The private key is never
written to this repository, an `.env` file, or the application image** (ADR-011) -- copy it somewhere
under the operator's own control (a password manager, an HSM, or, from EPIC-013, the super admin
console) and discard the terminal's scrollback.

```bash
sudo install -o root -g root -m 0600 infra/sentinel/sentinel.conf.example /etc/devon/sentinel.conf
sudo "$EDITOR" /etc/devon/sentinel.conf   # paste the public_key line from keygen.mjs
```

### Install and run it

```bash
sudo mkdir -p /opt/devon /var/lib/devon-sentinel
sudo touch /var/log/devon-sentinel.log
sudo cp -r infra/sentinel /opt/devon/infra/sentinel
sudo cp infra/sentinel/systemd/devon-sentinel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now devon-sentinel
```

It runs as root (the unit file explains why in a comment: `/etc/devon/sentinel.conf` is 0600
root-owned by design, and this same process is where EPIC-013's wipe executor will live) but with
every Linux capability stripped (`CapabilityBoundingSet=`) and heavy `systemd` sandboxing --
appropriate today, since the only command that exists is `noop`.

Stopping it removes capability, not state: `systemctl stop devon-sentinel` (design.md §5.4). It holds
no data of its own beyond the nonce-replay log (`/var/lib/devon-sentinel/nonces.log`), which is safe
to delete (it only ever causes an already-old nonce to be treated as fresh again, and freshness
checking still applies).

### Prove it (AC-15 evidence)

```bash
node infra/sentinel/scripts/prove.mjs   # starts a temporary instance; nothing is installed system-wide
node --test infra/sentinel/test/        # 37 assertions: every branch of the verification order below
```

`prove.mjs` runs the four break attempts named in the work item and exits non-zero if any of them is
accepted:

1. **Non-loopback caller.** `isLoopbackAddress()` is asserted against a set of samples including a
   container-bridge-style address (`172.17.0.2`, the exact example in AC-15's disproof); separately,
   `createSentinel()` refuses to even construct with any `host` other than `127.0.0.1`, and a real
   TCP connection attempt from this machine's LAN address to the sentinel's port fails with
   `ECONNREFUSED` at the operating system level, before the sentinel's own code runs at all (the bind
   itself is the first line of defence; the peer-address check in `src/server.mjs` is the second).
2. **Unsigned.** A structurally valid request with the `sig` field omitted is rejected `400
   malformed`.
3. **Wrong key.** A request signed with a different ed25519 keypair is rejected `401 bad_signature`.
4. **Replay.** The exact same accepted, signed request sent a second time is rejected `401 replay`.

It also prints the loopback-only bind evidence (`ss -ltnp` on Linux, `netstat -ano` filtered to the
sentinel's port as a fallback where `ss` is unavailable) and re-runs the no-destructive-path grep
(`test/lib/grep-source.mjs`) that scans `infra/sentinel/src/` for `rm`, `unlink`, the container
runtime's name, and "volume" -- "no destructive path exists in this epic's sentinel code" is a test
result, not a comment.

### Verification order (fixed, `src/server.mjs`)

```
peer address -> size (<= 4 KiB) -> parse -> signature -> freshness (<= 60s) -> nonce unseen (300s) -> command allow-list
```

The allow-list (`noop` only) is fixed in code (`src/config.mjs`, `src/server.mjs`), never read from
`/etc/devon/sentinel.conf` -- widening what the sentinel will execute always requires a code change
and a new ADR, never a config edit alone.

## Backups (`infra/backup/`)

The backup path that works **today**: a plain `pg_dump` (custom format, self-compressing) taken by a
throwaway container running the exact Postgres image pinned in `infra/docker-compose.yml`, so there
is no separate client-tool version to install, patch, or let drift from the server. This satisfies
the devops role's "pgBackRest or pg_dump + retention" bar without inventing an untested pgBackRest
stanza in this item; WAL-level PITR (RPO measured in minutes rather than "since last dump") is the
documented follow-up (TECH-SPEC §13: "drilled in EPIC-014").

```bash
infra/backup/backup.sh                       # dumps $POSTGRES_DB, prunes by retention, updates manifest.log
infra/backup/backup.sh --dir /opt/devon/backups --keep-days 30 --min-keep 3
infra/backup/verify.sh                       # restores the newest backup into a throwaway DB, checks it, drops it
infra/backup/restore.sh <file> [<target-db>] [--force-production]
```

- **`backup.sh`**: writes `devon-<db>-<UTC timestamp>.dump` plus a `manifest.log` line
  (`timestamp filename bytes sha256`). Retention keeps at least `--min-keep` (default 3) backups
  regardless of age, then deletes anything older than `--keep-days` (default 30) beyond that floor --
  a rollback path must never depend on a backup a retention job just deleted (design.md §5).
- **`verify.sh`**: the automated half of TECH-SPEC §13's "weekly automated restore verification" --
  restores the newest backup into a throwaway `devon_verify_<timestamp>` database, checks that the
  `app`/`audit` schemas and their tables came back, then drops the throwaway database unconditionally
  (a `trap` runs the drop even if the check fails). Wire `infra/backup/systemd/devon-backup-verify.timer`
  (or the `crontab.example` line) to a schedule and alert on non-zero exit.
- **`restore.sh`**: refuses to target the live `$POSTGRES_DB` unless `--force-production` is given
  **and** the operator re-types the target database name at a prompt -- restoring is destructive to
  whatever the target already holds, and this project treats operations that are irreversible in
  practice as "type to confirm", not undo (I-11 exempts operations irreversible by policy or
  consequence). Without a target name, it restores into a fresh
  `<db>_restore_<UTC timestamp>` database, which is the right default for the quarterly drill
  TECH-SPEC §13 asks for: restore, inspect, then decide whether to actually cut over.
- All three read `POSTGRES_DB` / `POSTGRES_SUPERUSER_PASSWORD` from the repository's `.env` if
  present (falling back to the same local-dev defaults as `docker-compose.yml`); `POSTGRES_HOST` is
  fixed to the Compose service name (`postgres`), independent of `.env`'s `POSTGRES_HOST`, because
  these scripts always run `pg_dump`/`pg_restore` from a container on the `devon` network, not from
  the host process's point of view that `.env`'s value describes.

Scheduling: `infra/backup/systemd/devon-backup.timer` (daily, 02:15) and
`devon-backup-verify.timer` (weekly, Sunday 03:30) for a systemd host, or
`infra/backup/crontab.example` where systemd user timers are not set up.

Demo audit rows are never removed by any of this -- `audit.events` has no delete path at all (I-3 /
I-5a), by design; a restore rolls the row count backward only if the backup itself predates them.

## Rollback

```bash
git checkout <previous-tag> -- infra/docker-compose.yml
docker compose -f infra/docker-compose.yml up -d --wait
```

Loss-free because every migration in this project is expand-only (I-15): the previous application
version runs unchanged against a newer schema. Database rollback is never a down-migration (there
isn't one and never will be) -- it is (1) roll the app back, (2) a new forward migration that
neutralises the problem, or (3) a PITR/backup restore, in that order (design.md §5.2).
