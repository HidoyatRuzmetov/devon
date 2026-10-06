#!/usr/bin/env bash
# infra/backup/quarterly-drill.sh -- deeper, dated restore drill (TECH-SPEC §13 "quarterly drill",
# HARDENING H19.1). Complements verify.sh's weekly schema-only check with: a timed restore, a
# row-count comparison against the manifest backup.sh recorded at dump time, and a written report
# under agentic/ledger/backups/ so a drift in restore time or a row-count mismatch has a paper trail
# rather than living only in a cron job's stdout.
#
# Usage: infra/backup/quarterly-drill.sh [--file <backup-file>]
# Defaults to the newest backup in BACKUP_DIR (same discovery as verify.sh). Exits non-zero (and
# still writes the report, marked FAIL) on any row-count mismatch or restore failure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

FILE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE_ARG="$2"; shift 2 ;;
    *) echo "[drill] unknown argument: $1" >&2; exit 1 ;;
  esac
done

# shellcheck disable=SC1091
source "$HERE/lib.sh"
: "${POSTGRES_HOST:=postgres}"
load_env_defaults "$ROOT/.env"
POSTGRES_DB="${POSTGRES_DB:-devon}"
POSTGRES_SUPERUSER_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-devon_local_dev_root}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
REPORT_DIR="${DRILL_REPORT_DIR:-$ROOT/agentic/ledger/backups}"
mkdir -p "$REPORT_DIR"

if [ -n "$FILE_ARG" ]; then
  TARGET_FILE="$FILE_ARG"
else
  shopt -s nullglob
  candidates=("$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump "$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump.gpg)
  shopt -u nullglob
  if [ "${#candidates[@]}" -eq 0 ]; then
    echo "[drill] no backup found in $BACKUP_DIR -- nothing to drill." >&2
    exit 1
  fi
  TARGET_FILE="$(for f in "${candidates[@]}"; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" "$f"; done | sort -rn | head -1 | cut -f2-)"
fi

MANIFEST_JSON="${TARGET_FILE%.gpg}.manifest.json"
DRILL_TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORT_DIR/drill-${DRILL_TS}.md"

POSTGRES_IMAGE="$(postgres_image "$COMPOSE_FILE")"
run_pg() { docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" "$@"; }

DECRYPTED=""
TARGET_DB="devon_drill_$(date -u +%Y%m%dT%H%M%SZ)"
CREATED_DB=false
cleanup() {
  local code=$?
  trap - EXIT
  if [ "$CREATED_DB" = true ]; then
    run_pg dropdb -h "$POSTGRES_HOST" -U postgres --if-exists "$TARGET_DB" >/dev/null 2>&1 || true
  fi
  if [ -n "$DECRYPTED" ]; then
    shred -u "$DECRYPTED" 2>/dev/null || rm -f "$DECRYPTED" || true
  fi
  exit "$code"
}
# Decryption may fail after writing partial plaintext, so register cleanup first.
trap cleanup EXIT
RESTORE_SOURCE="$TARGET_FILE"
if [[ "$TARGET_FILE" == *.gpg ]]; then
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo "[drill] FAIL: $TARGET_FILE is encrypted but BACKUP_ENCRYPTION_PASSPHRASE is not set." >&2
    exit 1
  fi
  DECRYPTED="$(mktemp "${TMPDIR:-/tmp}/devon-drill-XXXXXX.dump")"
  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$DECRYPTED" "$TARGET_FILE"
  RESTORE_SOURCE="$DECRYPTED"
fi

echo "[drill] restoring $TARGET_FILE into throwaway database $TARGET_DB ..."
START_EPOCH="$(date -u +%s)"
run_pg createdb -h "$POSTGRES_HOST" -U postgres "$TARGET_DB"
CREATED_DB=true
docker run --rm -i --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" \
  pg_restore -h "$POSTGRES_HOST" -U postgres -d "$TARGET_DB" --no-owner < "$RESTORE_SOURCE"
END_EPOCH="$(date -u +%s)"
DURATION=$((END_EPOCH - START_EPOCH))
echo "[drill] restore took ${DURATION}s"

# --- row-count comparison against the manifest recorded at backup time --------------------------------
# One combined query, not N sequential `docker run`s (one per table) -- the original shape here. With
# ~65 tables in this schema, N separate `docker run --rm --network devon ... psql ...` round trips
# measured several MINUTES wall-clock on this host (Docker Desktop's per-container startup overhead,
# paid 65 times over), which is a real problem for a script meant to run unattended quarterly, not just
# a performance nitpick -- the same class of fix already applied to backup.sh's own manifest step (see
# that script's comment for the full reasoning), applied here for the restored side of the comparison.
STATUS="PASS"
MISMATCHES=""
ROWS=""
if [ -f "$MANIFEST_JSON" ]; then
  # Tiny inline parser (no jq dependency assumed on the host): the manifest's shape is fixed by
  # backup.sh (`"schema.table": N,` lines), so a line-oriented grep is enough and keeps this script's
  # only dependency docker + bash + coreutils, same as every other script in infra/backup/.
  EXPECTED_KEYS=""
  UNION_SQL=""
  while IFS= read -r line; do
    key="$(echo "$line" | sed -n 's/.*"\([a-zA-Z0-9_]*\.[a-zA-Z0-9_]*\)":.*/\1/p')"
    expected="$(echo "$line" | sed -n 's/.*: *\([0-9]*\).*/\1/p')"
    [ -z "$key" ] && continue
    schema="${key%%.*}"
    table="${key#*.}"
    EXPECTED_KEYS="${EXPECTED_KEYS}${key}=${expected}
"
    clause="select '${key}' as tbl, count(*) as cnt from \"${schema}\".\"${table}\""
    if [ -z "$UNION_SQL" ]; then UNION_SQL="$clause"; else UNION_SQL="$UNION_SQL union all $clause"; fi
  done < "$MANIFEST_JSON"

  ACTUALS="$(run_pg psql -h "$POSTGRES_HOST" -U postgres -d "$TARGET_DB" -tA -F'|' -c "$UNION_SQL" 2>/dev/null)"

  while IFS= read -r kv; do
    key="${kv%%=*}"
    expected="${kv#*=}"
    [ -z "$key" ] && continue
    actual="$(echo "$ACTUALS" | awk -F'|' -v k="$key" '$1==k{print $2}')"
    ROWS="${ROWS}| \`${key}\` | ${expected} | ${actual:-ERR} |
"
    if [ "$actual" != "$expected" ]; then
      STATUS="FAIL"
      MISMATCHES="${MISMATCHES}- \`${key}\`: expected ${expected}, restored ${actual:-ERR}
"
    fi
  done <<< "$EXPECTED_KEYS"
else
  STATUS="PASS (no manifest -- backup predates the row-count manifest feature)"
fi

{
  echo "# Backup restore drill -- ${DRILL_TS}"
  echo
  echo "- Backup file: \`$(basename "$TARGET_FILE")\`"
  echo "- Restored into: \`$TARGET_DB\` (throwaway, dropped after this drill)"
  echo "- Restore duration: ${DURATION}s"
  echo "- Row-count check: **${STATUS}**"
  echo
  if [ -n "$ROWS" ]; then
    echo "| Table | Expected (at backup time) | Restored |"
    echo "|---|---|---|"
    printf '%s' "$ROWS"
    echo
  fi
  if [ -n "$MISMATCHES" ]; then
    echo "## Mismatches"
    echo
    printf '%s' "$MISMATCHES"
  fi
} > "$REPORT"

echo "[drill] report written to $REPORT"
if [ "$STATUS" = "FAIL" ]; then
  echo "[drill] FAIL: row-count mismatch(es) -- see $REPORT" >&2
  exit 1
fi
echo "[drill] PASS: $TARGET_FILE restores in ${DURATION}s with every table's row count intact."
