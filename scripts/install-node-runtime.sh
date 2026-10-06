#!/usr/bin/env bash
# A checksummed official runtime for host restore tooling. Run as root once.
set -euo pipefail
VERSION=22.23.3
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) exit 64 ;; esac
NAME="node-v${VERSION}-linux-${ARCH}"
DEST="/opt/${NAME}"
if [ ! -x "$DEST/bin/node" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${VERSION}/${NAME}.tar.xz" -o "$TMP/${NAME}.tar.xz"
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${VERSION}/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  (cd "$TMP"; grep " ${NAME}.tar.xz$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$TMP/${NAME}.tar.xz" -C /opt
fi
ln -sfn "$DEST/bin/node" /usr/local/bin/node
/usr/local/bin/node --version
