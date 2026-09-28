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

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

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

take_backup() {
  if "${COMPOSE[@]}" ps --status running postgres | grep -q postgres; then
    echo "[deploy] taking the required pre-deployment backup"
    sudo -n systemctl start devon-backup.service
    while systemctl is-active --quiet devon-backup.service; do sleep 2; done
    systemctl is-failed --quiet devon-backup.service && {
      echo "[deploy] backup service failed; deployment refused" >&2
      return 1
    }
  else
    echo "[deploy] initial deployment: no running database exists to back up"
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
  "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 600 api web caddy
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
