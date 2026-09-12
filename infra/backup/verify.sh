#!/usr/bin/env bash
# infra/backup/verify.sh -- weekly automated restore verification (TECH-SPEC.md §13).
#
# Restores the most recent backup into a throwaway database, checks that the app/audit schemas and
# their tables came back, then drops the throwaway database. Exits non-zero on any failure -- wire
# this into infra/backup/systemd/devon-backup-verify.timer (or the crontab.example entry) and alert
# on a non-zero exit. This is the automated half of TECH-SPEC §13's "weekly automated restore
# verification, quarterly drill" -- the quarterly drill is a human running restore.sh against a
# non-throwaway target on a schedule, documented in infra/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

# shellcheck disable=SC1091
source "$HERE/lib.sh"
# Fixed before reading .env -- see backup.sh's comment: the right hostname here is the Compose
# service name on the `devon` network, not .env's host-process-perspective POSTGRES_HOST.
: "${POSTGRES_HOST:=postgres}"
load_env_defaults "$ROOT/.env"
POSTGRES_DB="${POSTGRES_DB:-devon}"
POSTGRES_SUPERUSER_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-devon_local_dev_root}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

shopt -s nullglob
candidates=("$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump "$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump.gpg)
shopt -u nullglob
if [ "${#candidates[@]}" -eq 0 ]; then
  echo "[verify] no backup found in $BACKUP_DIR -- nothing to verify." >&2
  exit 1
fi
LATEST="$(for f in "${candidates[@]}"; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" "$f"; done | sort -rn | head -1 | cut -f2-)"

POSTGRES_IMAGE="$(postgres_image "$COMPOSE_FILE")"
run_pg() { docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" "$@"; }

# Encrypted backups (backup.sh's BACKUP_ENCRYPTION_PASSPHRASE path, H19.1) decrypt to a throwaway
# plaintext file for the duration of this restore only -- never left on disk after (trap below), and
# never uploaded/mirrored anywhere from here.
DECRYPTED=""
RESTORE_SOURCE="$LATEST"
if [[ "$LATEST" == *.gpg ]]; then
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo "[verify] FAIL: $LATEST is encrypted but BACKUP_ENCRYPTION_PASSPHRASE is not set." >&2
    exit 1
  fi
  DECRYPTED="$(mktemp "${TMPDIR:-/tmp}/devon-verify-XXXXXX.dump")"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --decrypt --output "$DECRYPTED" "$LATEST"
  RESTORE_SOURCE="$DECRYPTED"
fi

TARGET_DB="devon_verify_$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() {
  run_pg dropdb -h "$POSTGRES_HOST" -U postgres --if-exists "$TARGET_DB" >/dev/null 2>&1 || true
  [ -n "$DECRYPTED" ] && { shred -u "$DECRYPTED" 2>/dev/null || rm -f "$DECRYPTED"; }
}
trap cleanup EXIT

echo "[verify] restoring $LATEST into throwaway database $TARGET_DB ..."
run_pg createdb -h "$POSTGRES_HOST" -U postgres "$TARGET_DB"
docker run --rm -i --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" \
  pg_restore -h "$POSTGRES_HOST" -U postgres -d "$TARGET_DB" --no-owner < "$RESTORE_SOURCE"

echo "[verify] checking restored schemas and table counts ..."
CHECK_SQL="select
  (select count(*) from information_schema.schemata where schema_name='app') as app_schema,
  (select count(*) from information_schema.schemata where schema_name='audit') as audit_schema,
  (select count(*) from information_schema.tables where table_schema='app') as app_tables,
  (select count(*) from information_schema.tables where table_schema='audit') as audit_tables;"
RESULT="$(run_pg psql -h "$POSTGRES_HOST" -U postgres -d "$TARGET_DB" -tA -F'|' -c "$CHECK_SQL")"
echo "[verify] app_schema|audit_schema|app_tables|audit_tables = $RESULT"

IFS='|' read -r APP_SCHEMA AUDIT_SCHEMA APP_TABLES AUDIT_TABLES <<< "$RESULT"
if [ "$APP_SCHEMA" != "1" ] || [ "$AUDIT_SCHEMA" != "1" ] || [ "${APP_TABLES:-0}" -eq 0 ] || [ "${AUDIT_TABLES:-0}" -eq 0 ]; then
  echo "[verify] FAIL: expected the app and audit schemas to exist with at least one table each after restore." >&2
  exit 1
fi

echo "[verify] PASS: $LATEST restores cleanly; app and audit schemas present with tables intact."
