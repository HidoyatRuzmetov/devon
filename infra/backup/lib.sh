#!/usr/bin/env bash
# Shared by backup.sh / restore.sh / verify.sh. Not a standalone script -- sourced only.
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
