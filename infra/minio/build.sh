#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker build --target server -t devon-minio:d0cada583fce "$HERE"
docker build --target client -t devon-mc:e929f89ceeed "$HERE"
