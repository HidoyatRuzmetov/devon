#!/usr/bin/env bash
# infra/backup/restore.sh <backup-file> [<target-db>] [--force-production]
#
# Restores a pg_dump custom-format backup (as produced by backup.sh) into TARGET_DB. Refuses to
# target the live POSTGRES_DB unless --force-production is given AND the operator types the target
# database name back -- restoring is destructive to whatever the target already holds, and this
# project treats operations that are irreversible in practice as "type to confirm", not undo
# (I-11 exempts operations irreversible by policy/consequence; design.md §5.2).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "usage: $(basename "$0") <backup-file> [<target-db>] [--force-production]" >&2
  exit 1
fi
shift || true

TARGET_DB=""
FORCE_PRODUCTION=false
for a in "$@"; do
  if [ "$a" = "--force-production" ]; then FORCE_PRODUCTION=true; else TARGET_DB="$a"; fi
done

# shellcheck disable=SC1091
source "$HERE/lib.sh"
# Fixed before reading .env -- see backup.sh's comment: the right hostname here is the Compose
# service name on the `devon` network, not .env's host-process-perspective POSTGRES_HOST.
: "${POSTGRES_HOST:=postgres}"
load_env_defaults "$ROOT/.env"
POSTGRES_DB="${POSTGRES_DB:-devon}"
POSTGRES_SUPERUSER_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-devon_local_dev_root}"

if [ -z "$TARGET_DB" ]; then
  TARGET_DB="${POSTGRES_DB}_restore_$(date -u +%Y%m%dT%H%M%SZ)"
fi

if [ "$TARGET_DB" = "$POSTGRES_DB" ] && [ "$FORCE_PRODUCTION" != true ]; then
  echo "[restore] refusing to restore over the live database '$POSTGRES_DB' without --force-production." >&2
  echo "[restore] restore into a throwaway database and check it first (infra/backup/verify.sh does this weekly)." >&2
  exit 1
fi

if [ "$FORCE_PRODUCTION" = true ]; then
  echo "This will REPLACE every object in '$TARGET_DB' on ${POSTGRES_HOST}. There is no undo (design.md §5.2)."
  read -r -p "Type the target database name to confirm ('$TARGET_DB'): " CONFIRM
  if [ "$CONFIRM" != "$TARGET_DB" ]; then
    echo "[restore] confirmation did not match; aborting. Nothing was touched." >&2
    exit 1
  fi
fi

POSTGRES_IMAGE="$(postgres_image "$COMPOSE_FILE")"
run_pg() { docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" "$@"; }

# Encrypted backups (backup.sh's BACKUP_ENCRYPTION_PASSPHRASE path, H19.1) decrypt to a throwaway
# plaintext file for the duration of this restore only.
DECRYPTED=""
cleanup() {
  local code=$?
  trap - EXIT
  if [ -n "$DECRYPTED" ]; then
    shred -u "$DECRYPTED" 2>/dev/null || rm -f "$DECRYPTED" || true
  fi
  exit "$code"
}
trap cleanup EXIT
RESTORE_SOURCE="$BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.gpg ]]; then
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo "[restore] FAIL: $BACKUP_FILE is encrypted but BACKUP_ENCRYPTION_PASSPHRASE is not set." >&2
    exit 1
  fi
  DECRYPTED="$(mktemp "${TMPDIR:-/tmp}/devon-restore-XXXXXX.dump")"
  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$DECRYPTED" "$BACKUP_FILE"
  RESTORE_SOURCE="$DECRYPTED"
fi

EXISTS="$(run_pg psql -h "$POSTGRES_HOST" -U postgres -tA -c "select 1 from pg_database where datname='$TARGET_DB'")"
if [ "$EXISTS" != "1" ]; then
  echo "[restore] creating database '$TARGET_DB' on ${POSTGRES_HOST}"
  run_pg createdb -h "$POSTGRES_HOST" -U postgres "$TARGET_DB"
fi

echo "[restore] restoring $BACKUP_FILE into $TARGET_DB ..."
docker run --rm -i --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" \
  pg_restore -h "$POSTGRES_HOST" -U postgres -d "$TARGET_DB" --clean --if-exists --no-owner < "$RESTORE_SOURCE"

echo "[restore] done. Target database: $TARGET_DB"
