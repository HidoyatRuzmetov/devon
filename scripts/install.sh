#!/usr/bin/env bash
# scripts/install.sh -- the reproducible half of docs/ops/INSTALL.md, done idempotently.
#
# O'rnatish skripti (uz-Latn): Ubuntu 24.04 serverida Docker, tizim foydalanuvchisi, kataloglar,
# `.env` (tasodifiy parollar bilan), zaxira jadvallari va sentinel xizmatini o'rnatadi. Skriptni
# qayta ishga tushirish xavfsiz: mavjud `.env` hech qachon qayta yozilmaydi.
#
# WHAT IT DOES (every step is safe to run again -- re-running changes nothing that is already right):
#   1. checks the host: Ubuntu 24.04 / x86_64, root, disk space, free ports
#   2. installs Docker Engine + the Compose plugin from Docker's own apt repository
#   3. creates the `devon` system user and group and puts it in the `docker` group
#   4. creates /opt/devon, the backup directory and /etc/devon
#   5. generates a production .env with real random secrets -- ONLY if .env does not exist yet
#   6. installs and enables the backup, verify and restore-drill systemd timers
#   7. installs the host sentinel (pause/wipe executor) if a public key is configured
#   8. prints exactly what a human still has to do
#
# WHAT IT DELIBERATELY DOES NOT DO -- each of these is a decision, not a step:
#   * it never starts the application stack (that is `docker compose ... up -d`, after you have read
#     the .env it generated and set DEVON_PUBLIC_URL, AI_API_KEY and the Telegram values);
#   * it never runs migrations (they belong to the release procedure, docs/ops/UPDATE.md);
#   * it never overwrites an existing .env, and never rotates a secret -- rotation has a blast
#     radius per secret and lives in docs/ops/RUNBOOK.md;
#   * it never opens a firewall port it was not asked to (--firewall opts in).
#
# Usage:
#   sudo bash scripts/install.sh                    # full install
#   sudo bash scripts/install.sh --dry-run          # print what it WOULD do, change nothing
#   sudo bash scripts/install.sh --domain work.ministry.uz --email devops@ministry.uz
#   sudo bash scripts/install.sh --backup-dir /srv/backups/devon --firewall
#   sudo bash scripts/install.sh --skip-docker      # Docker already managed by the ministry's own image
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

DOMAIN=""
ADMIN_EMAIL=""
BACKUP_DIR="/var/backups/devon"
DEVON_USER="devon"
INSTALL_DIR="$ROOT"
DRY_RUN=0
SKIP_DOCKER=0
WITH_FIREWALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) ADMIN_EMAIL="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --user) DEVON_USER="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    --firewall) WITH_FIREWALL=1; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[install] unknown argument: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '[install] %s\n' "$*"; }
warn() { printf '[install] WARNING: %s\n' "$*" >&2; }
die()  { printf '[install] FAILED: %s\n' "$*" >&2; exit 1; }
do_it() {
  if [ "$DRY_RUN" = "1" ]; then printf '[install] (dry-run) %s\n' "$*"; return 0; fi
  "$@"
}

# ------------------------------------------------------------------------------------------------
# 1. host checks -- fail here rather than halfway through
# ------------------------------------------------------------------------------------------------
say "checking the host ..."

# A dry run changes nothing, so it does not need root -- and being able to rehearse the installer
# from an unprivileged shell (or a throwaway ubuntu:24.04 container) is how you find out what it
# will do to a ministry host before it does it.
if [ "$(id -u)" != "0" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    warn "not running as root; --dry-run changes nothing, so continuing. A real run needs sudo."
  else
    die "run this with sudo: sudo bash scripts/install.sh"
  fi
fi

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  say "os: ${PRETTY_NAME:-unknown}"
  case "${VERSION_ID:-}" in
    24.04) : ;;
    *) warn "this installer targets Ubuntu 24.04 LTS; ${ID:-?} ${VERSION_ID:-?} may work but is untested." ;;
  esac
else
  warn "/etc/os-release is missing -- cannot identify this distribution."
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) say "arch: $ARCH" ;;
  *) die "unsupported architecture: $ARCH (the pinned images are amd64/arm64 only)" ;;
esac

# 20 GiB is the floor for Postgres + MinIO + images + one week of backups on a department-sized
# instance. Below it the first thing that fails is a backup, silently, at 02:15.
AVAIL_KB="$(df -Pk "$(dirname "$INSTALL_DIR")" | awk 'NR==2{print $4}')"
AVAIL_GB=$(( AVAIL_KB / 1024 / 1024 ))
say "free space on $(dirname "$INSTALL_DIR"): ${AVAIL_GB} GiB"
[ "$AVAIL_GB" -ge 20 ] || warn "less than 20 GiB free -- Postgres, MinIO, images and a week of backups will not fit."

for port in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN; then
    warn "port $port is already in use -- Caddy will fail to bind. Stop whatever holds it (often nginx or apache2)."
  fi
done

if [ -z "$DOMAIN" ]; then
  warn "no --domain given; DEVON_PUBLIC_URL will be left as a placeholder you must edit before first boot."
fi

# ------------------------------------------------------------------------------------------------
# 2. Docker Engine + Compose plugin
# ------------------------------------------------------------------------------------------------
if [ "$SKIP_DOCKER" = "1" ]; then
  say "skipping Docker installation (--skip-docker)"
elif docker compose version >/dev/null 2>&1; then
  say "docker: $(docker --version), compose plugin present -- nothing to do"
else
  say "installing Docker Engine + Compose plugin from Docker's apt repository ..."
  # Docker's repository, not Ubuntu's `docker.io` package: the Compose *plugin* (`docker compose`,
  # not the retired `docker-compose` script) only ships there, and every compose file in this repo
  # uses Compose v2 syntax.
  do_it install -m 0755 -d /etc/apt/keyrings
  if [ ! -s /etc/apt/keyrings/docker.asc ]; then
    do_it curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    do_it chmod a+r /etc/apt/keyrings/docker.asc
  fi
  CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  DOCKER_LIST="deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable"
  if [ "$DRY_RUN" = "1" ]; then
    say "(dry-run) would write /etc/apt/sources.list.d/docker.list: ${DOCKER_LIST}"
  else
    printf '%s\n' "$DOCKER_LIST" > /etc/apt/sources.list.d/docker.list
  fi
  do_it apt-get update -qq
  do_it apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  do_it systemctl enable --now docker
fi

# gpg is needed to encrypt backups (H19.1); node runs the restore drill; curl/ca-certificates are
# needed by everything above.
say "installing host tools (ca-certificates, curl, gnupg, git) ..."
do_it apt-get install -y -qq ca-certificates curl gnupg git

if ! command -v node >/dev/null 2>&1; then
  warn "node is not installed. tools/backup/restore-drill.mjs (the weekly drill) needs Node >= 22."
  warn "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
fi

# ------------------------------------------------------------------------------------------------
# 3. the service account
# ------------------------------------------------------------------------------------------------
if id -u "$DEVON_USER" >/dev/null 2>&1; then
  say "user '$DEVON_USER' already exists"
else
  say "creating system user '$DEVON_USER' ..."
  do_it useradd --system --create-home --home-dir "/home/$DEVON_USER" --shell /usr/sbin/nologin "$DEVON_USER"
fi
# Membership in `docker` is effectively root on this host. That is intentional and unavoidable for
# an account that must run `docker compose`, and it is why this account has no login shell.
if getent group docker >/dev/null 2>&1; then
  do_it usermod -aG docker "$DEVON_USER"
  say "'$DEVON_USER' is in the docker group"
fi

# ------------------------------------------------------------------------------------------------
# 4. directories
# ------------------------------------------------------------------------------------------------
say "creating directories ..."
do_it mkdir -p "$BACKUP_DIR" /etc/devon
do_it chown -R "$DEVON_USER:$DEVON_USER" "$BACKUP_DIR"
# 0700: a backup is a complete copy of every person's data in the department. Anything wider makes
# every local account on this host a reader of it.
do_it chmod 0700 "$BACKUP_DIR"
do_it chown -R "$DEVON_USER:$DEVON_USER" "$INSTALL_DIR"

case "$BACKUP_DIR" in
  "$INSTALL_DIR"/*)
    warn "BACKUP_DIR is inside the project directory. The sentinel's wipe switch deletes the project"
    warn "directory and everything under it -- a wipe would take the backups with it. Use a path"
    warn "outside $INSTALL_DIR (the default, /var/backups/devon, is)."
    ;;
esac

# ------------------------------------------------------------------------------------------------
# 5. .env -- generated once, never overwritten
# ------------------------------------------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  say "$ENV_FILE already exists -- leaving it exactly as it is (no secret is ever rotated here)."
else
  say "generating $ENV_FILE with fresh random secrets ..."
  PUBLIC_URL="https://${DOMAIN:-CHANGE-ME.example.uz}"
  if [ "$DRY_RUN" = "1" ]; then
    say "(dry-run) would write $ENV_FILE (DEVON_PUBLIC_URL=$PUBLIC_URL) with 8 generated secrets"
  else
    rand() { openssl rand -hex 32; }
    umask 077
    cat > "$ENV_FILE" <<ENVEOF
# Devon (WorkPortal) production environment -- generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Every value marked CHANGE-ME must be filled in before the first boot. Never commit this file.
# The full explanation of each variable is in docs/ops/INSTALL.md §4.

NODE_ENV=production
# The real hostname, with scheme, no trailing slash. It is the CORS origin, the cookie domain and
# the base of every link in a notification -- all three break together if it is wrong.
DEVON_PUBLIC_URL=${PUBLIC_URL}
API_PORT=3000
LOG_LEVEL=info

# --- Postgres (no host port is published in production; only the devon network reaches it) -------
POSTGRES_DB=devon
POSTGRES_SUPERUSER_PASSWORD=$(rand)
POSTGRES_MIGRATOR_USER=devon_migrator
POSTGRES_MIGRATOR_PASSWORD=$(rand)
POSTGRES_APP_USER=devon_app
POSTGRES_APP_PASSWORD=__PLACEHOLDER_APP_PASSWORD__
DATABASE_URL=postgres://devon_app:__PLACEHOLDER_APP_PASSWORD__@postgres:5432/devon
MIGRATION_DATABASE_URL=postgres://postgres:__PLACEHOLDER_SUPER_PASSWORD__@postgres:5432/devon

# --- Valkey ---------------------------------------------------------------------------------------
VALKEY_URL=redis://valkey:6379

# --- Sessions / CSRF --------------------------------------------------------------------------------
SESSION_COOKIE_NAME=devon_sid
SESSION_IDLE_MINUTES=720
SESSION_ABSOLUTE_DAYS=30
CSRF_SECRET=$(rand)

# --- TLS (Caddy) ------------------------------------------------------------------------------------
# 'internal' = Caddy's own CA: works with no internet and no public DNS, and every browser warns
# until that CA is trusted. For a real certificate, comment CADDY_TLS_MODE out and set the two file
# paths instead (docs/ops/INSTALL.md §6).
CADDY_TLS_MODE=internal
#DEVON_TLS_CERT_FILE=/etc/devon/tls/fullchain.pem
#DEVON_TLS_KEY_FILE=/etc/devon/tls/privkey.pem

# --- Object storage (MinIO) -------------------------------------------------------------------------
STORAGE_DRIVER=s3
MINIO_ROOT_USER=devon
MINIO_ROOT_PASSWORD=__PLACEHOLDER_MINIO_PASSWORD__
STORAGE_S3_ENDPOINT=http://minio:9000
# What the BROWSER reaches. A presigned URL's signature covers its host, so this must be the public
# name, not the compose service name.
STORAGE_S3_PUBLIC_ENDPOINT=${PUBLIC_URL}/objects
STORAGE_S3_ACCESS_KEY=devon
STORAGE_S3_SECRET_KEY=__PLACEHOLDER_MINIO_PASSWORD__
STORAGE_S3_BUCKET=devon
STORAGE_S3_REGION=us-east-1
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_MAX_UPLOAD_BYTES=5242880
STORAGE_TIMEOUT_MS=10000
# Caddy must be allowed to connect to this origin from the SPA (the browser PUTs bytes to it).
DEVON_CSP_CONNECT_EXTRA=${PUBLIC_URL}

# --- Malware scanning -- the API REFUSES to boot in production with CLAMAV_MODE=off ----------------
CLAMAV_MODE=clamd
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=20000

# --- Realtime (Centrifugo) --------------------------------------------------------------------------
CENTRIFUGO_WS_URL=${PUBLIC_URL/https:/wss:}/realtime/connection/websocket
CENTRIFUGO_API_URL=http://centrifugo:8000/api
CENTRIFUGO_API_KEY=$(rand)
CENTRIFUGO_TOKEN_HMAC_SECRET_KEY=$(rand)
CENTRIFUGO_TOKEN_TTL_SECONDS=600
CENTRIFUGO_TIMEOUT_MS=3000

# --- AI (GLM-5.2 on the government GPU cluster) -----------------------------------------------------
# Without AI_API_KEY the gateway falls back to a mock provider and every AI feature hides itself --
# a correct, fully usable deployment, just without the AI helpers.
AI_BASE_URL=https://api-llm.gpu.uz/v1
AI_MODEL=glm-5.2
AI_API_KEY=CHANGE-ME-or-delete-this-line
AI_REQUEST_TIMEOUT_MS=60000

# --- Telegram (all three, or none of them) -----------------------------------------------------------
# The API refuses to boot in production with a bot token and no webhook secret (H1.14).
#TELEGRAM_BOT_TOKEN=CHANGE-ME
#TELEGRAM_BOT_USERNAME=CHANGE-ME
#TELEGRAM_WEBHOOK_SECRET=CHANGE-ME

# --- Setup / demo flags ------------------------------------------------------------------------------
# 1 only while doing the /setup ceremony from somewhere other than the host's own loopback.
DEVON_SETUP_REMOTE=0
DEVON_DEMO=0
DEVON_E2E=0

# --- Host sentinel (pause/wipe). The PRIVATE key is never on this host. -------------------------------
SENTINEL_HOST=127.0.0.1
SENTINEL_PORT=8787
SENTINEL_PUBLIC_KEY=
ENVEOF
    # The same password has to appear in three places (the role, DATABASE_URL, and MinIO's two
    # keys); generating it once and substituting is what keeps them from drifting apart.
    APP_PASSWORD="$(rand)"
    MINIO_PASSWORD="$(rand)"
    SUPER_PASSWORD="$(grep '^POSTGRES_SUPERUSER_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
    sed -i "s|__PLACEHOLDER_APP_PASSWORD__|${APP_PASSWORD}|g; s|__PLACEHOLDER_MINIO_PASSWORD__|${MINIO_PASSWORD}|g; s|__PLACEHOLDER_SUPER_PASSWORD__|${SUPER_PASSWORD}|g" "$ENV_FILE"
    chown "$DEVON_USER:$DEVON_USER" "$ENV_FILE"
    chmod 0600 "$ENV_FILE"
    say "wrote $ENV_FILE (0600, owned by $DEVON_USER)"
  fi
fi

# The backup job's own environment. Separate from .env on purpose: it belongs to the HOST's cron /
# systemd units, not to any compose service, and the encryption passphrase must not be reachable
# from a container that a compromised app process could read.
BACKUP_ENV="/etc/devon/backup.env"
if [ -f "$BACKUP_ENV" ]; then
  say "$BACKUP_ENV already exists -- left untouched (rotating the passphrase needs the re-encryption step in docs/ops/RUNBOOK.md)"
elif [ "$DRY_RUN" = "1" ]; then
  say "(dry-run) would write $BACKUP_ENV with a generated BACKUP_ENCRYPTION_PASSPHRASE"
else
  umask 077
  {
    echo "# Devon backup job environment -- read by infra/backup/*.sh and tools/backup/restore-drill.mjs."
    echo "# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). 0600, root-owned."
    echo "#"
    echo "# KEEP A COPY OF THE PASSPHRASE SOMEWHERE OFF THIS HOST. Without it every encrypted backup"
    echo "# is unrecoverable -- including the backups you would reach for after losing this host."
    echo "BACKUP_DIR=${BACKUP_DIR}"
    echo "BACKUP_ENCRYPTION_PASSPHRASE=$(openssl rand -hex 32)"
    echo "BACKUP_KEEP_DAYS=30"
    echo "BACKUP_KEEP_MONTHS=12"
    echo "BACKUP_MIN_KEEP=3"
    echo "# Off-host mirror (H19.1). Point this at storage on a DIFFERENT machine, or a disk failure"
    echo "# here takes the backups with it. Falls back to the app's STORAGE_S3_* if unset."
    echo "BACKUP_MIRROR_TO_MINIO=0"
    echo "#BACKUP_MINIO_ENDPOINT=http://backup-host.ministry.uz:9000"
    echo "#BACKUP_MINIO_ACCESS_KEY=CHANGE-ME"
    echo "#BACKUP_MINIO_SECRET_KEY=CHANGE-ME"
    echo "#BACKUP_MINIO_BUCKET=devon-backups"
  } > "$BACKUP_ENV"
  chmod 0600 "$BACKUP_ENV"
  chown root:root "$BACKUP_ENV"
  say "wrote $BACKUP_ENV (0600, root-owned)"
fi

# ------------------------------------------------------------------------------------------------
# 6. backup / verify / restore-drill timers
# ------------------------------------------------------------------------------------------------
if command -v systemctl >/dev/null 2>&1; then
  say "installing backup, verify and restore-drill systemd units ..."
  for unit in devon-backup.service devon-backup.timer \
              devon-backup-verify.service devon-backup-verify.timer \
              devon-restore-drill.service devon-restore-drill.timer; do
    src="$INSTALL_DIR/infra/backup/systemd/$unit"
    [ -f "$src" ] || { warn "missing $src -- skipped"; continue; }
    do_it install -m 0644 -o root -g root "$src" "/etc/systemd/system/$unit"
  done

  # A drop-in, not an edit of the unit files: a `git pull` replaces the units, and a drop-in
  # survives that. This is what points every job at the real BACKUP_DIR and the passphrase.
  for unit in devon-backup devon-backup-verify devon-restore-drill; do
    dropin="/etc/systemd/system/${unit}.service.d"
    if [ "$DRY_RUN" = "1" ]; then
      say "(dry-run) would write ${dropin}/10-local.conf (WorkingDirectory, User, EnvironmentFile)"
      continue
    fi
    mkdir -p "$dropin"
    cat > "${dropin}/10-local.conf" <<DROPIN
[Service]
WorkingDirectory=${INSTALL_DIR}
User=${DEVON_USER}
Group=${DEVON_USER}
EnvironmentFile=${BACKUP_ENV}
DROPIN
  done

  do_it systemctl daemon-reload
  do_it systemctl enable --now devon-backup.timer devon-backup-verify.timer devon-restore-drill.timer
  say "timers: daily backup 02:15, weekly verify Sun 03:30, weekly restore drill Sun 04:30"
else
  warn "systemd is not available -- schedule the three jobs from infra/backup/crontab.example instead."
fi

# ------------------------------------------------------------------------------------------------
# 7. the host sentinel (pause/wipe executor)
# ------------------------------------------------------------------------------------------------
SENTINEL_CONF="/etc/devon/sentinel.conf"
if [ -f "$SENTINEL_CONF" ]; then
  say "$SENTINEL_CONF exists -- installing/refreshing the sentinel unit"
  do_it install -m 0644 -o root -g root "$INSTALL_DIR/infra/sentinel/systemd/devon-sentinel.service" /etc/systemd/system/devon-sentinel.service
  do_it systemctl daemon-reload
  do_it systemctl enable --now devon-sentinel
else
  say "sentinel NOT installed: $SENTINEL_CONF does not exist yet."
  say "  The private key must be generated somewhere you control and never stored on this host:"
  say "    node ${INSTALL_DIR}/infra/sentinel/scripts/keygen.mjs"
  say "  Put the public_key line in $SENTINEL_CONF (0600, root), then re-run this script."
fi

# ------------------------------------------------------------------------------------------------
# 8. firewall (opt-in)
# ------------------------------------------------------------------------------------------------
if [ "$WITH_FIREWALL" = "1" ]; then
  if command -v ufw >/dev/null 2>&1; then
    say "configuring ufw: allow 22, 80, 443; deny everything else inbound ..."
    do_it ufw allow 22/tcp
    do_it ufw allow 80/tcp
    do_it ufw allow 443/tcp
    do_it ufw default deny incoming
    do_it ufw --force enable
    warn "Docker publishes container ports by writing iptables rules that BYPASS ufw. Nothing in the"
    warn "production compose file publishes anything but 80/443, so this is safe today -- but never"
    warn "add a 'ports:' entry and assume ufw is protecting it."
  else
    warn "--firewall given but ufw is not installed; skipped."
  fi
fi

# ------------------------------------------------------------------------------------------------
# done
# ------------------------------------------------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  PUBLIC_URL_SUMMARY="is https://${DOMAIN} -- check it is exactly what DNS resolves to"
else
  PUBLIC_URL_SUMMARY="is still a placeholder; it must be the real hostname, with scheme, no trailing slash"
fi

cat <<NEXT

[install] Host is prepared. What is left is the part that needs a human:

  1. Read and finish ${ENV_FILE}
       - DEVON_PUBLIC_URL       ${PUBLIC_URL_SUMMARY}
       - AI_API_KEY             the GLM key, or delete the line to run without AI
       - TELEGRAM_*             all three, or none
       - CADDY_TLS_MODE         'internal' (offline CA) or the two DEVON_TLS_* file paths
  2. Build the images:      docker compose -f infra/docker-compose.prod.yml build
  3. Start the data tier:   docker compose -f infra/docker-compose.prod.yml up -d postgres valkey
  4. Migrate:               docs/ops/INSTALL.md §7  (migrations run BEFORE the app containers)
  5. Roll out:              docker compose -f infra/docker-compose.prod.yml --profile minio --profile clamav --profile centrifugo up -d
  6. Super admin ceremony:  docs/ops/INSTALL.md §8  (the one-time /setup URL is printed in the api log)
  7. Smoke checks:          docs/ops/INSTALL.md §9
  8. Go-live checklist:     docs/ops/CHECKLIST-GO-LIVE.md

[install] Copy ${BACKUP_ENV}'s BACKUP_ENCRYPTION_PASSPHRASE somewhere OFF this host today.
[install] Without it, every encrypted backup on this machine is unrecoverable.
NEXT
