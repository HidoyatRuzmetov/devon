#!/usr/bin/env bash
# Deploy one immutable production release on an already-prepared Devon host.
# The application .env is deliberately neither read from Git nor replaced by this script.
set -Eeuo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <api-image> <web-image> <40-char-commit-sha>" >&2
  exit 64
fi


API_IMAGE="$1"
WEB_IMAGE="$2"
RELEASE_SHA="$3"
ROOT=/opt/devon
STATE_FILE="$ROOT/.deployed-images.env"
# /var/lock is root-owned on Ubuntu. The deployment account owns /opt/devon, so keeping the lock
# beside the release state makes concurrent-deploy protection work without broad sudo privileges.
LOCK_FILE="$ROOT/.deploy.lock"

case "$RELEASE_SHA" in
  *[!0-9a-f]*|'') echo "invalid release SHA" >&2; exit 64 ;;
esac
[ "${#RELEASE_SHA}" -eq 40 ] || { echo "release SHA must contain 40 characters" >&2; exit 64; }
[ -f "$ROOT/.env" ] || { echo "$ROOT/.env is missing; refusing to deploy" >&2; exit 78; }

cd "$ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another production deployment is already running" >&2; exit 75; }

# The workflow installs the candidate manifest before this script runs. Every failed deployment
# must restore the previous file as well as any running images, otherwise the next workflow saves
# the failed candidate as its rollback manifest. Arm this only after acquiring the deployment lock.
restore_manifest_on_failure() {
  local code=$?
  local manifest="$ROOT/infra/docker-compose.prod.yml"
  local previous="$ROOT/infra/.previous-docker-compose.prod.yml"
  local tmp="${manifest}.restore.$$"
  trap - EXIT
  if [ "$code" -ne 0 ] && [ -f "$previous" ]; then
    if cp -- "$previous" "$tmp" && mv -f -- "$tmp" "$manifest"; then
      echo "[deploy] restored previous Compose manifest after deployment failure" >&2
    else
      rm -f -- "$tmp" || true
      echo "[deploy] ERROR: could not restore previous Compose manifest; operator repair required" >&2
    fi
  fi
  if [ "$code" -ne 0 ] && [ -f "$ROOT/infra/.previous-Caddyfile" ]; then
    if ! cp -- "$ROOT/infra/.previous-Caddyfile" "$ROOT/infra/Caddyfile"; then
      echo "[deploy] ERROR: could not restore previous proxy configuration" >&2
    fi
  fi
  exit "$code"
}
trap restore_manifest_on_failure EXIT

# Dotenv is configuration data, not shell code: unquoted spaces, `$()`, backticks and quoted
# multiline values must never execute here. Compose reads the full file itself below; the shell
# needs only these two values. Node 22 is installed by scripts/install-node-runtime.sh.
read_dotenv_value() {
  node -e '
    try {
      const { parseEnv } = require("node:util");
      const { readFileSync } = require("node:fs");
      const value = parseEnv(readFileSync(process.argv[1], "utf8"))[process.argv[2]];
      if (typeof value !== "string" || !value.trim() || value.includes("\0")) process.exit(78);
      process.stdout.write(value);
    } catch {
      // Never expose parser errors, file contents or credentials in deployment logs.
      process.exit(78);
    }
  ' "$ROOT/.env" "$1"
}
command -v node >/dev/null || { echo "[deploy] Node 22 runtime missing; refusing to deploy" >&2; exit 78; }
MIGRATION_DATABASE_URL="$(read_dotenv_value MIGRATION_DATABASE_URL)" || {
  echo "[deploy] cannot read required MIGRATION_DATABASE_URL from dotenv" >&2; exit 78;
}
DEVON_PUBLIC_URL="$(read_dotenv_value DEVON_PUBLIC_URL)" || {
  echo "[deploy] cannot read required DEVON_PUBLIC_URL from dotenv" >&2; exit 78;
}
export MIGRATION_DATABASE_URL DEVON_PUBLIC_URL

COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker-compose.prod.yml" \
  --profile clamav --profile centrifugo)

PREVIOUS_API_IMAGE=""
PREVIOUS_WEB_IMAGE=""
PREVIOUS_RELEASE_SHA=""
if [ -f "$STATE_FILE" ]; then
  # This file contains image references only, never credentials.
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  PREVIOUS_API_IMAGE="${DEVON_API_IMAGE:-}"
  PREVIOUS_WEB_IMAGE="${DEVON_WEB_IMAGE:-}"
  PREVIOUS_RELEASE_SHA="${DEVON_RELEASE_SHA:-}"
fi

# The first automated deploy may follow a manually built release with no state file yet.
if [ -z "$PREVIOUS_API_IMAGE" ]; then
  PREVIOUS_API_IMAGE="$(docker inspect --format '{{.Image}}' devon-api 2>/dev/null || true)"
  PREVIOUS_WEB_IMAGE="$(docker inspect --format '{{.Image}}' devon-web 2>/dev/null || true)"
fi

take_backup() {
  if "${COMPOSE[@]}" ps --status running postgres | grep -q postgres; then
    echo "[deploy] taking the required pre-deployment backup"
    sudo -n systemctl start devon-backup.service
    if [ "$(systemctl show devon-backup.service --property=Result --value)" != success ]; then
      echo "[deploy] backup service failed; deployment refused" >&2
      return 1
    fi
    return 0
  else
    # A stopped database (or a surviving data volume after container removal) is not a fresh
    # installation. Starting it and migrating without a backup would put existing data at risk.
    if docker inspect devon-postgres >/dev/null 2>&1 || \
       docker volume inspect devon_postgres_data >/dev/null 2>&1; then
      echo "[deploy] existing database is not running; restore database health and take a backup before deployment" >&2
      return 1
    fi
    echo "[deploy] initial deployment: no database container or data volume exists to back up"
  fi
}

wait_ready() {
  local _attempt
  for _attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --insecure --max-time 10 \
      "${DEVON_PUBLIC_URL%/}/readyz" >/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rollback_images() {
  if [ -z "$PREVIOUS_API_IMAGE" ] || [ -z "$PREVIOUS_WEB_IMAGE" ]; then
    echo "[deploy] no previous image release exists for automatic rollback" >&2
    return 1
  fi
  echo "[deploy] rolling back images to ${PREVIOUS_RELEASE_SHA:-previous release}" >&2
  export DEVON_API_IMAGE="$PREVIOUS_API_IMAGE"
  export DEVON_WEB_IMAGE="$PREVIOUS_WEB_IMAGE"
  if [ -f "$ROOT/infra/.previous-Caddyfile" ]; then
    cp -- "$ROOT/infra/.previous-Caddyfile" "$ROOT/infra/Caddyfile"
  fi
  if [ -f "$ROOT/infra/.previous-docker-compose.prod.yml" ]; then
    COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/.previous-docker-compose.prod.yml" --profile clamav --profile centrifugo)
  fi
  "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 600 api web caddy
  # A file bind mount can retain an old inode after extraction/replacement. Recreate only the
  # proxy so it certainly loads the restored file, preserving its certificate volumes.
  "${COMPOSE[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 600 caddy
  wait_ready
}

take_backup

export DEVON_API_IMAGE="$API_IMAGE"
export DEVON_WEB_IMAGE="$WEB_IMAGE"

echo "[deploy] pulling immutable images for $RELEASE_SHA"
docker pull "$DEVON_API_IMAGE"
docker pull "$DEVON_WEB_IMAGE"

echo "[deploy] ensuring the data and optional service tier is healthy"
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 600 \
  postgres valkey clamav centrifugo

echo "[deploy] applying expand/contract migrations before application rollout"
"${COMPOSE[@]}" run --rm --no-deps -e MIGRATION_DATABASE_URL api \
  /repo/apps/api/node_modules/.bin/tsx /repo/packages/db/src/cli-migrate.ts

echo "[deploy] rolling out API, web, and reverse proxy"
# The API process already runs the durable background workers. The separate worker service is not
# started on this 8 GB single-server deployment, avoiding a duplicate HTTP process and worker loops.
if ! "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 600 api web caddy; then
  rollback_images || true
  exit 1
fi

# Compose does not restart a service when only a bind-mounted configuration file changes.
# Without this, a successful release could keep the old /realtime route indefinitely.
if ! "${COMPOSE[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 600 caddy; then
  echo "[deploy] reverse proxy configuration rollout failed" >&2
  rollback_images || true
  exit 1
fi

if ! wait_ready; then
  echo "[deploy] readiness gate failed" >&2
  rollback_images || true
  exit 1
fi

tmp_state="${STATE_FILE}.tmp"
umask 027
{
  printf 'DEVON_API_IMAGE=%q\n' "$DEVON_API_IMAGE"
  printf 'DEVON_WEB_IMAGE=%q\n' "$DEVON_WEB_IMAGE"
  printf 'DEVON_RELEASE_SHA=%q\n' "$RELEASE_SHA"
} > "$tmp_state"
mv -f "$tmp_state" "$STATE_FILE"

echo "[deploy] release $RELEASE_SHA is ready at ${DEVON_PUBLIC_URL}"
