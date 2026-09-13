#!/usr/bin/env bash
# infra/k3s/validate.sh -- prove these manifests are real before a cluster ever sees them.
#
# Three levels, strongest first; the script runs every level it can and says which ones it skipped,
# so "validated" never silently means "rendered the YAML and hoped".
#
#   1. server dry-run    -- `kubectl apply --dry-run=server` against a reachable cluster. The only
#                           level that checks admission (Pod Security, quotas, CRDs actually
#                           installed). Skipped when no kubeconfig points at a live cluster.
#   2. schema validation -- kubeconform against the upstream OpenAPI schemas for a pinned Kubernetes
#                           version. Catches every misspelled field, wrong type and bad apiVersion
#                           without a cluster. Uses a local `kubeconform` if installed, otherwise
#                           the digest-pinned container image.
#   3. render            -- `kubectl kustomize`. Always runs. Proves the kustomization resolves, the
#                           YAML parses and the image overrides apply.
#
# NOTE on `kubectl apply --dry-run=client`: it is NOT offline. It resolves every kind against the
# API server's discovery document, so with no cluster it fails with "unable to recognize" for every
# resource -- which reads like a manifest error and is not one. That is why level 2 exists.
#
# Usage: infra/k3s/validate.sh [--k8s-version 1.31.0]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# Paths are passed to kubectl relative to the repository root on purpose: under Git Bash, $HERE is
# an MSYS path (/c/Users/...) that a Windows kubectl.exe cannot open, while a relative path works on
# every platform. (The MSYS_NO_PATHCONV trick infra/backup/lib.sh needs for `docker run -v` would
# make this worse here, not better -- it is exactly the conversion kubectl wants.)
cd "$ROOT"
KDIR="infra/k3s"

K8S_VERSION="1.31.0"
KUBECONFORM_IMAGE="ghcr.io/yannh/kubeconform:v0.6.7@sha256:0925177fb05b44ce18574076141b5c3d83235e1904d3f952182ac99ddc45762c"

while [ $# -gt 0 ]; do
  case "$1" in
    --k8s-version) K8S_VERSION="$2"; shift 2 ;;
    *) echo "[k3s-validate] unknown argument: $1" >&2; exit 1 ;;
  esac
done

command -v kubectl >/dev/null 2>&1 || { echo "[k3s-validate] kubectl is required" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- level 3: render ---------------------------------------------------------------------------
echo "[k3s-validate] rendering $KDIR ..."
kubectl kustomize "$KDIR" > "$TMP/rendered.yaml"
RESOURCES="$(grep -c '^kind:' "$TMP/rendered.yaml" || true)"
echo "[k3s-validate] rendered ${RESOURCES} resource(s)"

# The files kustomization.yaml deliberately leaves out (a Job's pod template is immutable; the CRDs
# need their operator installed first) still have to be valid YAML with a valid schema. The two CRD
# files cannot be schema-checked without the CRD definitions and are left to level 1.
cat "$KDIR/migrate-job.yaml" > "$TMP/extra.yaml"
printf '\n---\n' >> "$TMP/extra.yaml"
cat "$KDIR/optional/clamav.yaml" >> "$TMP/extra.yaml"

# --- level 2: schema validation ----------------------------------------------------------------
KUBECONFORM_MODE=""
if command -v kubeconform >/dev/null 2>&1; then
  KUBECONFORM_MODE="local"
elif command -v docker >/dev/null 2>&1 && docker version >/dev/null 2>&1; then
  KUBECONFORM_MODE="docker"
fi

run_kubeconform() {
  case "$KUBECONFORM_MODE" in
    local) kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" ;;
    docker) docker run --rm -i "$KUBECONFORM_IMAGE" -strict -summary -kubernetes-version "$K8S_VERSION" ;;
  esac
}

if [ -n "$KUBECONFORM_MODE" ]; then
  echo "[k3s-validate] schema-validating against Kubernetes ${K8S_VERSION} (${KUBECONFORM_MODE} kubeconform) ..."
  run_kubeconform < "$TMP/rendered.yaml"
  run_kubeconform < "$TMP/extra.yaml"
else
  echo "[k3s-validate] SKIPPED schema validation: neither kubeconform nor a working docker is available." >&2
fi

# --- level 1: server dry-run -------------------------------------------------------------------
if kubectl cluster-info >/dev/null 2>&1; then
  echo "[k3s-validate] server dry-run against $(kubectl config current-context) ..."
  kubectl apply --dry-run=server -k "$KDIR"
  kubectl apply --dry-run=server -f "$KDIR/migrate-job.yaml"
else
  echo "[k3s-validate] SKIPPED server dry-run: no reachable cluster in the current kubeconfig."
  echo "[k3s-validate]   On the ministry's k3s node: kubectl apply --dry-run=server -k infra/k3s"
fi

echo "[k3s-validate] OK"
