#!/usr/bin/env bash
# infra/backup/backup.sh -- full pg_dump backup with retention (TECH-SPEC.md §13).
#
# The working backup path for this item: a plain `pg_dump` (custom format, self-compressing), run
# inside a throwaway container using the *exact* image pinned in infra/docker-compose.yml -- no
# client tools to install or patch on the host, and no risk of a locally-installed pg_dump silently
# drifting from the server's major version. WAL-level PITR via pgBackRest is the documented follow-up
# (see infra/README.md#backups); it needs archive_mode/archive_command changes to Postgres's own
# config, which is a packages/db concern outside this item's scope.
#
# Usage: infra/backup/backup.sh [--dir DIR] [--keep-days N] [--min-keep N]
# Reads POSTGRES_* from the repo's .env if present; every value has a local-dev-safe default.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.yml"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_MIN_KEEP="${BACKUP_MIN_KEEP:-3}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep-days) BACKUP_KEEP_DAYS="$2"; shift 2 ;;
    --min-keep) BACKUP_MIN_KEEP="$2"; shift 2 ;;
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
OUT="$BACKUP_DIR/devon-${POSTGRES_DB}-${TS}.dump"

# A failed pg_dump under `set -e` exits immediately, but the `>` redirection has already created an
# empty $OUT by then -- an empty file left on disk would later look like a real (if empty) backup to
# verify.sh's "most recent file" logic. The trap removes it on any non-zero exit from this point on.
trap 'rm -f "$OUT"' ERR

echo "[backup] dumping '${POSTGRES_DB}' from ${POSTGRES_HOST} -> $OUT"
docker run --rm --network devon \
  -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" \
  "$POSTGRES_IMAGE" \
  pg_dump -h "$POSTGRES_HOST" -U postgres --format=custom "$POSTGRES_DB" > "$OUT"

trap - ERR
SIZE="$(wc -c < "$OUT" | tr -d ' ')"
if [ "$SIZE" -eq 0 ]; then
  echo "[backup] FAIL: $OUT is empty -- deleting it and exiting non-zero." >&2
  rm -f "$OUT"
  exit 1
fi
SHA="$(sha256sum "$OUT" | awk '{print $1}')"
printf '%s %s %s %s\n' "$TS" "$(basename "$OUT")" "$SIZE" "$SHA" >> "$BACKUP_DIR/manifest.log"
echo "[backup] wrote $OUT (${SIZE} bytes, sha256 ${SHA})"

# --- retention: prune anything older than BACKUP_KEEP_DAYS, always keeping the BACKUP_MIN_KEEP most
#     recent regardless of age (design.md §5: a rollback path must never depend on a backup that a
#     retention job just deleted). ------------------------------------------------------------------
shopt -s nullglob
files=("$BACKUP_DIR"/devon-"${POSTGRES_DB}"-*.dump)
shopt -u nullglob
# Sort newest-first without relying on `ls -t` (locale/format differences across hosts).
IFS=$'\n' sorted=($(for f in "${files[@]}"; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" "$f"; done | sort -rn | cut -f2-))
unset IFS

kept=0
pruned=0
for f in "${sorted[@]}"; do
  kept=$((kept + 1))
  if [ "$kept" -le "$BACKUP_MIN_KEEP" ]; then continue; fi
  if find "$f" -mtime +"$BACKUP_KEEP_DAYS" -print -quit 2>/dev/null | grep -q .; then
    echo "[backup] pruning $f (older than ${BACKUP_KEEP_DAYS}d, beyond the ${BACKUP_MIN_KEEP} most recent)"
    rm -f "$f"
    pruned=$((pruned + 1))
  fi
done

echo "[backup] done. ${#sorted[@]} backup(s) present before pruning, ${pruned} pruned."
