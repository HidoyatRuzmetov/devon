#!/usr/bin/env bash
# scripts/update.sh -- upgrade a running Devon (WorkPortal) deployment, in the only order that is
# safe: BACKUP -> fetch the release -> build/pull -> MIGRATE -> roll out -> health gate.
#
# Yangilash skripti (uz-Latn): avval zaxira nusxa olinadi, keyin yangi versiya yuklanadi,
# migratsiyalar ILOVADAN OLDIN qo'llanadi, so'ng konteynerlar yangilanadi va /readyz tekshiriladi.
# Biror bosqich muvaffaqiyatsiz bo'lsa, skript to'xtaydi va orqaga qaytarish buyrug'ini chop etadi.
#
# Why this order, and why the script refuses to reorder it (docs/ops/UPDATE.md has the long form):
#
#   * The backup comes FIRST because it is the only thing that makes the update reversible. A
#     backup taken after a bad migration is a backup of the bad state.
#   * Migrations run BEFORE the new containers start, never inside them (H18.1). Every migration in
#     this project is expand-then-contract (I-15), so the OLD code keeps working against the NEW
#     schema for the length of the rollout -- that is exactly what makes "migrate, then roll" safe
#     without downtime, and it is why there is no down-migration to run here.
#   * The rollout is gated on health, not on "the command exited 0": `docker compose up -d` returns
#     as soon as the containers are created, long before the API can answer. This script waits for
#     GET /readyz (database reachable AND every migration applied), not GET /healthz (process
#     alive, which a broken release also satisfies).
#
# Usage:
#   sudo -u devon bash scripts/update.sh --to v1.2.0
#   sudo -u devon bash scripts/update.sh --to v1.2.0 --target k3s
#   sudo -u devon bash scripts/update.sh --to v1.2.0 --dry-run
#   sudo -u devon bash scripts/update.sh --rollback            # print the rollback procedure and exit
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

TARGET_REF=""
DEPLOY_TARGET="compose"
COMPOSE_FILE="infra/docker-compose.prod.yml"
PROFILES=(--profile minio --profile clamav --profile centrifugo)
HEALTH_URL=""
DRY_RUN=0
SKIP_BACKUP=0
SHOW_ROLLBACK=0
TIMEOUT_S=600

while [ $# -gt 0 ]; do
  case "$1" in
    --to) TARGET_REF="$2"; shift 2 ;;
    --target) DEPLOY_TARGET="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --timeout) TIMEOUT_S="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --rollback) SHOW_ROLLBACK=1; shift ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[update] unknown argument: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '[update] %s\n' "$*"; }
warn() { printf '[update] WARNING: %s\n' "$*" >&2; }
step() { printf '\n[update] ===== %s =====\n' "$*"; }
do_it() {
  if [ "$DRY_RUN" = "1" ]; then printf '[update] (dry-run) %s\n' "$*"; return 0; fi
  "$@"
}

CURRENT_REF="$(git describe --tags --always 2>/dev/null || echo 'unknown')"

print_rollback() {
  cat <<ROLLBACK

[update] ROLLBACK -- from $CURRENT_REF. There is no automatic rollback here: this is a single-host
[update] deployment, not an orchestrator with a deployment history. Roll the CODE back; never the
[update] schema (there are no down-migrations and there never will be).

  1. git -C $ROOT checkout $CURRENT_REF
  2. $( [ "$DEPLOY_TARGET" = "k3s" ] \
        && echo "kubectl -n devon rollout undo deploy/devon-api deploy/devon-worker deploy/devon-web" \
        || echo "docker compose -f $COMPOSE_FILE build && docker compose -f $COMPOSE_FILE up -d" )
  3. Confirm GET /readyz is 200.

  The previous code runs unchanged against the already-migrated schema -- that is the whole point
  of expand/contract (I-15). The ONE case where this is not enough is a release that shipped a
  genuinely backward-incompatible migration: then the path is a restore from the backup this script
  takes in step 1, NOT a hand-written schema rollback. docs/ops/RUNBOOK.md -> "Restore".

ROLLBACK
}

if [ "$SHOW_ROLLBACK" = "1" ]; then
  print_rollback
  exit 0
fi

[ -n "$TARGET_REF" ] || { echo "[update] --to <git tag or ref> is required (or --rollback)" >&2; exit 1; }

case "$DEPLOY_TARGET" in
  compose|k3s) : ;;
  *) echo "[update] --target must be 'compose' or 'k3s'" >&2; exit 1 ;;
esac

# ------------------------------------------------------------------------------------------------
step "0. preflight"
# ------------------------------------------------------------------------------------------------
say "repository: $ROOT"
say "current:    $CURRENT_REF"
say "target:     $TARGET_REF"
say "deploy to:  $DEPLOY_TARGET"

if [ -n "$(git status --porcelain)" ]; then
  git status --short
  echo "[update] REFUSING: the working tree has local changes. Commit, stash or revert them first --" >&2
  echo "[update] an update that silently carries someone's hand-edit forward is not reproducible." >&2
  exit 1
fi

# A dry run rehearses the procedure; it must therefore be runnable somewhere that is NOT the
# production host -- a staging box, a laptop, a review of the release plan. So the environment
# preconditions are hard failures for a real run and warnings for a dry run.
require() {
  if [ "$DRY_RUN" = "1" ]; then warn "$1 (dry run: continuing)"; else echo "[update] $1" >&2; exit 1; fi
}
if [ "$DEPLOY_TARGET" = "compose" ]; then
  [ -f "$COMPOSE_FILE" ] || require "$COMPOSE_FILE not found"
  [ -f .env ] || require ".env not found -- this host has never been installed (docs/ops/INSTALL.md)"
  docker compose version >/dev/null 2>&1 || require "docker compose is not available"
else
  command -v kubectl >/dev/null 2>&1 || require "kubectl is not available"
  kubectl cluster-info >/dev/null 2>&1 || require "no reachable cluster in the current kubeconfig"
fi

if [ -z "$HEALTH_URL" ]; then
  # DEVON_PUBLIC_URL is what the outside world reaches, and going through Caddy/Traefik is the
  # point: it proves the proxy, the certificate and the app all agree, not just the app.
  PUBLIC_URL="$(grep -E '^DEVON_PUBLIC_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
  HEALTH_URL="${PUBLIC_URL:-http://127.0.0.1:3000}/readyz"
fi
say "health gate: $HEALTH_URL"

# ------------------------------------------------------------------------------------------------
step "1. backup FIRST"
# ------------------------------------------------------------------------------------------------
if [ "$SKIP_BACKUP" = "1" ]; then
  warn "--skip-backup: this update is NOT reversible by restore. Only ever correct when you have"
  warn "just taken a backup by hand and verified it."
else
  do_it bash infra/backup/backup.sh
  say "verifying that backup actually restores before going any further ..."
  do_it bash infra/backup/verify.sh
fi

# ------------------------------------------------------------------------------------------------
step "2. fetch the release"
# ------------------------------------------------------------------------------------------------
do_it git fetch --tags --prune
if [ "$DRY_RUN" = "0" ]; then
  git rev-parse --verify "${TARGET_REF}^{commit}" >/dev/null 2>&1 \
    || { echo "[update] $TARGET_REF does not exist after fetch" >&2; exit 1; }
fi
do_it git checkout --detach "$TARGET_REF"
say "now at: $(git describe --tags --always 2>/dev/null || echo "$TARGET_REF")"

say "release notes / manual steps to read before continuing:"
do_it git log --oneline "${CURRENT_REF}..${TARGET_REF}" -- packages/db/migrations docs/ops || true

# ------------------------------------------------------------------------------------------------
step "3. build or pull the images"
# ------------------------------------------------------------------------------------------------
if [ "$DEPLOY_TARGET" = "compose" ]; then
  if grep -qE '^DEVON_API_IMAGE=' .env 2>/dev/null; then
    say "DEVON_API_IMAGE is set -- pulling from the registry instead of building"
    do_it docker compose -f "$COMPOSE_FILE" "${PROFILES[@]}" pull
  else
    # --frozen-lockfile inside every Dockerfile: the build fails rather than silently resolving a
    # dependency tree different from the one the release gate tested.
    do_it docker compose -f "$COMPOSE_FILE" build
  fi
else
  say "k3s: set the image references before applying, e.g."
  say "  (cd infra/k3s && kustomize edit set image devon-api=registry.example.uz/devon/api@sha256:...)"
  do_it kubectl kustomize infra/k3s >/dev/null
fi

# ------------------------------------------------------------------------------------------------
step "4. migrate -- BEFORE the new code runs"
# ------------------------------------------------------------------------------------------------
if [ "$DEPLOY_TARGET" = "compose" ]; then
  do_it docker compose -f "$COMPOSE_FILE" up -d --wait postgres valkey
  # The migrator connects as the Postgres superuser: 0001_roles.sql CREATEs devon_migrator and
  # devon_app, so the connection applying it cannot authenticate as a role that may not exist yet.
  do_it docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
    -e MIGRATION_DATABASE_URL \
    api pnpm --filter @devon/db migrate:apply
else
  # A Job's pod template is immutable, so the old Job has to go before the new one can be applied.
  do_it kubectl -n devon delete job devon-migrate --ignore-not-found
  do_it kubectl -n devon apply -f infra/k3s/migrate-job.yaml
  do_it kubectl -n devon wait --for=condition=complete job/devon-migrate --timeout="${TIMEOUT_S}s"
fi
say "migrations applied. The OLD code is still serving, correctly, against the NEW schema (I-15)."

# ------------------------------------------------------------------------------------------------
step "5. roll out"
# ------------------------------------------------------------------------------------------------
if [ "$DEPLOY_TARGET" = "compose" ]; then
  # --no-deps: recreate only the app tier. Postgres, Valkey and Caddy keep running, so the
  # maintenance page stays reachable throughout and the database is never restarted for a code
  # release.
  do_it docker compose -f "$COMPOSE_FILE" "${PROFILES[@]}" up -d --no-deps api worker web
  do_it docker compose -f "$COMPOSE_FILE" "${PROFILES[@]}" up -d
else
  do_it kubectl apply -k infra/k3s
  do_it kubectl -n devon rollout status deploy/devon-api --timeout="${TIMEOUT_S}s"
  do_it kubectl -n devon rollout status deploy/devon-worker --timeout="${TIMEOUT_S}s"
  do_it kubectl -n devon rollout status deploy/devon-web --timeout="${TIMEOUT_S}s"
fi

# ------------------------------------------------------------------------------------------------
step "6. health gate"
# ------------------------------------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  say "(dry-run) would poll $HEALTH_URL until 200, for up to ${TIMEOUT_S}s"
else
  say "waiting for 200 from $HEALTH_URL (up to ${TIMEOUT_S}s) ..."
  deadline=$(( $(date +%s) + TIMEOUT_S ))
  ok=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # -k: a ministry box on Caddy's internal CA presents a certificate this host does not trust;
    # the health gate is about the application, and the certificate is checked separately in
    # docs/ops/CHECKLIST-GO-LIVE.md.
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || echo 000)"
    if [ "$code" = "200" ]; then ok=1; break; fi
    printf '[update]   %s -> %s, retrying\n' "$HEALTH_URL" "$code"
    sleep 5
  done
  if [ "$ok" != "1" ]; then
    echo "[update] FAILED: $HEALTH_URL never returned 200 within ${TIMEOUT_S}s." >&2
    if [ "$DEPLOY_TARGET" = "compose" ]; then
      docker compose -f "$COMPOSE_FILE" logs --tail=80 api worker || true
    else
      kubectl -n devon logs --tail=80 deploy/devon-api || true
    fi
    print_rollback
    exit 1
  fi
  say "healthy."
fi

# ------------------------------------------------------------------------------------------------
step "done"
# ------------------------------------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  cat <<DRYDONE
[update] DRY RUN ONLY -- nothing above was executed and $CURRENT_REF is still what is running.
[update] Re-run without --dry-run to perform the update.
DRYDONE
  exit 0
fi
cat <<DONE
[update] $CURRENT_REF -> $TARGET_REF is live and answering on /readyz.

Still worth doing, by hand, now:
  * open the super admin console's health page (queues, DB, storage, Telegram, AI latency, backups);
  * sign in as a real member and move one card, to prove the write path end to end;
  * watch the logs for five minutes: docker compose -f $COMPOSE_FILE logs -f api worker
  * if anything is wrong, roll back immediately rather than troubleshooting forward against
    production traffic: bash scripts/update.sh --rollback
DONE
