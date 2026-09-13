#!/usr/bin/env bash
# Shared by backup.sh / restore.sh / verify.sh / quarterly-drill.sh. Not a standalone script --
# sourced only.
#
# Git Bash / MSYS2 (the "Windows + Docker Desktop staging rehearsal" host docs/ops/DEPLOY.md §1
# names) rewrites any argument that *looks* like a POSIX path into a Windows path before the child
# process sees it -- so `docker run -v "$DIR:/backups:ro"` arrives as `-v C:\...:C:/Program
# Files/Git/backups:ro` and the container mounts nothing at /backups. Caught empirically: the MinIO
# mirror step of backup.sh failed with "Unable to guess the type of copy operation" on Windows while
# working on Linux. These two variables disable that rewriting for this script and its children; on
# Linux and macOS they are simply unset variables nothing reads, so the export is a no-op there.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'
#
# load_env_defaults(): reads simple KEY=VALUE lines from a .env-style file and exports each one only
# if that variable is not already set in the environment. Shell env (including flags a caller passes
# on the command line before invoking the script) always wins over the file -- the same precedence
# scripts/start.mjs documents ("shell env wins, .env fills gaps"), reimplemented here in bash so
# these scripts have no Node dependency of their own.
load_env_defaults() {
  local file="$1"
  [ -f "$file" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    key="$(printf '%s' "$key" | sed 's/[[:space:]]*$//')"
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    if [ -z "${!key+x}" ]; then
      export "${key}=${val}"
    fi
  done < "$file"
}

# postgres_image(): reads the exact digest-pinned postgres image out of infra/docker-compose.yml, so
# every script here uses the one image that is actually deployed rather than a second, independently
# maintained pin that could drift from it.
postgres_image() {
  local compose_file="$1"
  awk '/^  postgres:/{f=1} f && /image:/{print $2; exit}' "$compose_file"
}
