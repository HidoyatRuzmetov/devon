#!/usr/bin/env bash
# CI tools only. Exact official archives are verified before installation/execution.
set -euo pipefail

task_root="${RUNNER_TEMP:-/tmp}"
task_dir="$(mktemp -d "$task_root/devon-perf-tools.XXXXXX")"
[[ "$task_dir" == "$task_root"/devon-perf-tools.* && -d "$task_dir" && ! -L "$task_dir" ]] || exit 1
trap 'if [[ "$task_dir" == "$task_root"/devon-perf-tools.* && -d "$task_dir" && ! -L "$task_dir" ]]; then rm -rf -- "$task_dir"; fi' EXIT

k6_version='2.2.0'
lhci_version='0.15.1'
k6_archive="k6-v${k6_version}-linux-amd64.tar.gz"
k6_checksums="k6-v${k6_version}-checksums.txt"
k6_url="https://github.com/grafana/k6/releases/download/v${k6_version}"
curl -fsSL "$k6_url/$k6_checksums" -o "$task_dir/$k6_checksums"
curl -fsSL "$k6_url/$k6_archive" -o "$task_dir/$k6_archive"
(cd "$task_dir" && sha256sum --ignore-missing -c "$k6_checksums")
tar -xzf "$task_dir/$k6_archive" -C "$task_dir"
sudo install -m 0755 "$task_dir/k6-v${k6_version}-linux-amd64/k6" /usr/local/bin/k6

npm view "@lhci/cli@$lhci_version" dist --json > "$task_dir/lhci-dist.json"
npm pack "@lhci/cli@$lhci_version" --ignore-scripts --pack-destination "$task_dir"
node --input-type=module - "$task_dir" "$lhci_version" <<'NODE'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const [directory, version] = process.argv.slice(2)
const metadata = JSON.parse(readFileSync(join(directory, 'lhci-dist.json'), 'utf8'))
const expectedUrl = `https://registry.npmjs.org/@lhci/cli/-/cli-${version}.tgz`
if (metadata.tarball !== expectedUrl || !/^sha512-/.test(metadata.integrity ?? '')) throw new Error('Unexpected pinned Lighthouse archive metadata')
const archive = readFileSync(join(directory, `lhci-cli-${version}.tgz`))
if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== metadata.integrity) throw new Error('Pinned Lighthouse checksum mismatch')
NODE
npm install --global --ignore-scripts "$task_dir/lhci-cli-$lhci_version.tgz"
k6 version | grep -F "v$k6_version "
[[ "$(lhci --version)" == "$lhci_version" ]]
