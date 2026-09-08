#!/usr/bin/env bash
# infra/backup/backup.sh -- full pg_dump backup with retention, encryption and an off-host mirror
# (TECH-SPEC.md §13, HARDENING H19.1).
#
# The working backup path for this item: a plain `pg_dump` (custom format, self-compressing), run
# inside a throwaway container using the *exact* image pinned in infra/docker-compose.yml -- no
# client tools to install or patch on the host, and no risk of a locally-installed pg_dump silently
# drifting from the server's major version. WAL-level PITR via pgBackRest is the documented follow-up
# (see infra/README.md#backups); it needs archive_mode/archive_command changes to Postgres's own
# config, which is a packages/db concern outside this item's scope.
#
# Usage: infra/backup/backup.sh [--dir DIR] [--keep-days N] [--min-keep N] [--keep-months N]
# Reads POSTGRES_*/BACKUP_*/MINIO_*/STORAGE_S3_* from the repo's .env if present; every value has a
# local-dev-safe default except encryption and the MinIO mirror, which are opt-in (see below) --
# .env itself is never read into the backup output (secrets excluded, H19.1's own requirement).
#
# Encryption (H19.1 "backups encrypted"): set BACKUP_ENCRYPTION_PASSPHRASE to a real secret (never
# committed, never the same as any application secret) to have this script GPG-encrypt the dump
# (AES256, symmetric) before it touches disk in its final form; the plaintext dump is never left
# behind. Unset -> the script logs a loud warning and writes the plaintext dump, which is still the
# correct choice for a local dev/staging rehearsal but never for a real ministry deployment.
#
# Off-host mirror (H19.1 "MinIO mirror"): set BACKUP_MIRROR_TO_MINIO=1 with STORAGE_S3_ENDPOINT /
# STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY (the same MinIO the app's `s3` storage driver uses,
# or a dedicated backup bucket/endpoint via BACKUP_MINIO_* overrides) to copy the finished backup
# (encrypted, if encryption is on) into a bucket outside this host's own disk -- a wipe or a disk
# failure on the app host does not also delete every off-host copy this way. This mirror is on the
# same network as this script's other `docker run` calls (the `devon` Compose network) by default;
# for a truly separate host, point BACKUP_MINIO_ENDPOINT at that host's reachable address instead.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_MIN_KEEP="${BACKUP_MIN_KEEP:-3}"
BACKUP_KEEP_MONTHS="${BACKUP_KEEP_MONTHS:-12}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep-days) BACKUP_KEEP_DAYS="$2"; shift 2 ;;
    --min-keep) BACKUP_MIN_KEEP="$2"; shift 2 ;;
    --keep-months) BACKUP_KEEP_MONTHS="$2"; shift 2 ;;
    *) echo "[backup] unknown argument: $1" >&2; exit 1 ;;
  esac
done

# shellcheck disable=SC1091
source "$HERE/lib.sh"
# Fixed BEFORE reading .env: this script always talks to Postgres from a throwaway container on the
# `devon` network, where the right hostname is the Compose service name -- NOT .env's POSTGRES_HOST
# (127.0.0.1), which is written from the *host process*'s point of view (apps/api running locally).
# load_env_defaults only fills variables that are still unset, so this default wins over .env's.
: "${POSTGRES_HOST:=postgres}"
load_env_defaults "$ROOT/.env"
POSTGRES_DB="${POSTGRES_DB:-devon}"
POSTGRES_SUPERUSER_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-devon_local_dev_root}"

POSTGRES_IMAGE="$(postgres_image "$COMPOSE_FILE")"
if [ -z "$POSTGRES_IMAGE" ]; then
  echo "[backup] could not read the postgres image reference from $COMPOSE_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/devon-${POSTGRES_DB}-${TS}.dump"
OUT="$DUMP"

# A failed pg_dump under `set -e` exits immediately, but the `>` redirection has already created an
# empty $DUMP by then -- an empty file left on disk would later look like a real (if empty) backup to
# verify.sh's "most recent file" logic. The trap removes it (and anything derived from it) on any
# non-zero exit from this point on.
trap 'rm -f "$DUMP" "$DUMP.gpg" "$DUMP.manifest.json"' ERR

# --- row-count manifest (the quarterly drill's "did everything actually come back" check, H19.1) ----
# Taken BEFORE pg_dump, and as ONE atomic multi-table query (not N sequential per-table `docker run`s
# -- the original shape here), and for a real, concrete reason, not just tidiness: this database is
# live and under write traffic the whole time this script runs (outbox events, sessions, audit log --
# all append-only and growing every second in a real deployment, and even faster on the shared
# dev/test Postgres this was built and drilled against). N sequential `docker run`+`psql` round trips
# (one per table, ~60+ tables) took long enough in practice that later-alphabetised, high-churn tables
# (`sessions`, `audit.events`) had already gained several more rows by the time their count ran than
# `pg_dump` had captured moments earlier -- caught empirically running `infra/backup/quarterly-
# drill.sh` against this exact live database (a real drill report showed `app.sessions` and
# `audit.events` short by a handful of rows purely from that timing gap, not from any actual data
# loss). Building one `UNION ALL` query across every discovered table and sending it as a single
# `psql -c` fixes this two ways: it collapses dozens of round trips into one (the whole manifest
# reflects one instant, not a many-second window), and running it *before* `pg_dump` starts means any
# residual gap can only make the dump capture the same rows or a few *more* (pure inserts arrive
# between the manifest and the dump, never fewer) -- the direction a restore-drill comparison should
# tolerate, unlike the previous dump-then-count order, which could only make the dump look like it
# had *lost* rows that had simply not existed yet when the count ran.
COUNT_SQL="select table_schema, table_name from information_schema.tables where table_schema in ('app','audit') and table_type = 'BASE TABLE' order by 1, 2;"
TABLES="$(docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" \
  psql -h "$POSTGRES_HOST" -U postgres -d "$POSTGRES_DB" -tA -F'|' -c "$COUNT_SQL")"
UNION_SQL=""
while IFS='|' read -r schema table; do
  [ -z "$schema" ] && continue
  clause="select '${schema}.${table}' as tbl, count(*) as cnt from \"${schema}\".\"${table}\""
  if [ -z "$UNION_SQL" ]; then UNION_SQL="$clause"; else UNION_SQL="$UNION_SQL union all $clause"; fi
done <<< "$TABLES"
COUNTS="$(docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "$POSTGRES_IMAGE" \
  psql -h "$POSTGRES_HOST" -U postgres -d "$POSTGRES_DB" -tA -F'|' -c "$UNION_SQL")"
{
  echo '{'
  echo "  \"database\": \"${POSTGRES_DB}\","
  echo "  \"taken_at\": \"${TS}\","
  echo '  "table_counts": {'
  first=true
  while IFS='|' read -r tbl count; do
    [ -z "$tbl" ] && continue
    [ "$first" = true ] || echo ','
    first=false
    printf '    "%s": %s' "$tbl" "${count// /}"
  done <<< "$COUNTS"
  echo
  echo '  }'
  echo '}'
} > "$DUMP.manifest.json"
echo "[backup] wrote row-count manifest -> $DUMP.manifest.json"

echo "[backup] dumping '${POSTGRES_DB}' from ${POSTGRES_HOST} -> $DUMP"
docker run --rm --network devon \
  -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" \
  "$POSTGRES_IMAGE" \
  pg_dump -h "$POSTGRES_HOST" -U postgres --format=custom "$POSTGRES_DB" > "$DUMP"

SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
if [ "$SIZE" -eq 0 ]; then
  echo "[backup] FAIL: $DUMP is empty -- deleting it and exiting non-zero." >&2
  rm -f "$DUMP"
  exit 1
fi

# --- encryption (H19.1 "backups encrypted") ----------------------------------------------------------
if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "[backup] FAIL: BACKUP_ENCRYPTION_PASSPHRASE is set but gpg is not installed on this host." >&2
    exit 1
  fi
  echo "[backup] encrypting $DUMP (AES256, symmetric) -> $DUMP.gpg"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --symmetric --cipher-algo AES256 --output "$DUMP.gpg" "$DUMP"
  shred -u "$DUMP" 2>/dev/null || rm -f "$DUMP"
  OUT="$DUMP.gpg"
else
  echo "[backup] WARNING: BACKUP_ENCRYPTION_PASSPHRASE is not set -- writing an UNENCRYPTED dump." >&2
  echo "[backup] set BACKUP_ENCRYPTION_PASSPHRASE (a real secret, never in the repo) before relying on this in production (H19.1)." >&2
fi

SHA="$(sha256sum "$OUT" | awk '{print $1}')"
FINAL_SIZE="$(wc -c < "$OUT" | tr -d ' ')"
printf '%s %s %s %s\n' "$TS" "$(basename "$OUT")" "$FINAL_SIZE" "$SHA" >> "$BACKUP_DIR/manifest.log"
echo "[backup] wrote $OUT (${FINAL_SIZE} bytes, sha256 ${SHA})"

trap - ERR

# --- off-host mirror (H19.1 "MinIO mirror") -----------------------------------------------------------
if [ "${BACKUP_MIRROR_TO_MINIO:-0}" = "1" ]; then
  MC_ENDPOINT="${BACKUP_MINIO_ENDPOINT:-${STORAGE_S3_ENDPOINT:-http://minio:9000}}"
  MC_ACCESS_KEY="${BACKUP_MINIO_ACCESS_KEY:-${STORAGE_S3_ACCESS_KEY:-}}"
  MC_SECRET_KEY="${BACKUP_MINIO_SECRET_KEY:-${STORAGE_S3_SECRET_KEY:-}}"
  MC_BUCKET="${BACKUP_MINIO_BUCKET:-devon-backups}"
  if [ -z "$MC_ACCESS_KEY" ] || [ -z "$MC_SECRET_KEY" ]; then
    echo "[backup] BACKUP_MIRROR_TO_MINIO=1 but no access key/secret resolved (BACKUP_MINIO_* or STORAGE_S3_*) -- skipping mirror." >&2
  else
    echo "[backup] mirroring $(basename "$OUT") (+ manifest) to MinIO ${MC_ENDPOINT}/${MC_BUCKET}"
    docker run --rm --network devon --entrypoint sh \
      -e MC_HOST_backup="http://${MC_ACCESS_KEY}:${MC_SECRET_KEY}@${MC_ENDPOINT#http://}" \
      -v "$BACKUP_DIR:/backups:ro" \
      minio/mc:RELEASE.2025-04-08T15-39-49Z@sha256:7e3efb09c22c0882fbf341b9d99f61f94ae6c4c20a06f2f1a2b20ea8993d8952 \
      -c "mc mb --ignore-existing backup/${MC_BUCKET} && mc cp /backups/$(basename "$OUT") backup/${MC_BUCKET}/ && mc cp /backups/$(basename "$DUMP.manifest.json") backup/${MC_BUCKET}/" \
      || echo "[backup] WARNING: MinIO mirror failed -- the local backup is still valid; investigate before the next verify.sh run." >&2
  fi
fi

# --- retention: two independent policies, both additive (never delete something the other still wants
#     kept) -- H19.1 "retention 30 days + monthly for a year". -----------------------------------------
#   1. Daily window: keep at least BACKUP_MIN_KEEP most recent regardless of age, then delete anything
#      older than BACKUP_KEEP_DAYS beyond that floor (design.md §5: a rollback path must never depend
#      on a backup a retention job just deleted).
#   2. Monthly window: additionally keep the OLDEST backup taken in each of the last BACKUP_KEEP_MONTHS
#      calendar months (a monthly archive point), independent of whether the daily window would have
#      pruned it -- this is what makes month-13-ago recoverable at all under a 30-day daily window.
shopt -s nullglob
all_files=("$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump "$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump.gpg)
shopt -u nullglob
# Sort newest-first without relying on `ls -t` (locale/format differences across hosts).
IFS=$'\n' sorted=($(for f in "${all_files[@]}"; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" "$f"; done | sort -rn | cut -f2-))
unset IFS

# One monthly keeper = the OLDEST file within each YYYY-MM found in the last BACKUP_KEEP_MONTHS months
# (oldest-in-month reads as "closest to that month's start", a stable, deterministic archive point).
declare -A monthly_keeper=()
cutoff_month_epoch=$(( $(date -u +%s) - BACKUP_KEEP_MONTHS * 31 * 86400 ))
for f in "${sorted[@]}"; do
  mtime="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")"
  [ "$mtime" -lt "$cutoff_month_epoch" ] && continue
  ym="$(date -u -d "@$mtime" +%Y-%m 2>/dev/null || date -u -r "$mtime" +%Y-%m)"
  monthly_keeper["$ym"]="$f" # last write wins per key -> oldest, since $sorted is newest-first and we overwrite
done

kept=0
pruned=0
for f in "${sorted[@]}"; do
  kept=$((kept + 1))
  if [ "$kept" -le "$BACKUP_MIN_KEEP" ]; then continue; fi
  is_monthly_keeper=false
  for keeper in "${monthly_keeper[@]:-}"; do
    [ "$keeper" = "$f" ] && is_monthly_keeper=true && break
  done
  if [ "$is_monthly_keeper" = true ]; then continue; fi
  if find "$f" -mtime +"$BACKUP_KEEP_DAYS" -print -quit 2>/dev/null | grep -q .; then
    echo "[backup] pruning $f (older than ${BACKUP_KEEP_DAYS}d, beyond the ${BACKUP_MIN_KEEP} most recent, not a monthly keeper)"
    rm -f "$f" "$f.manifest.json"
    pruned=$((pruned + 1))
  fi
done

echo "[backup] done. ${#sorted[@]} backup(s) present before pruning, ${pruned} pruned, ${#monthly_keeper[@]} monthly keeper(s) protected."
