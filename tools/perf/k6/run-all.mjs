#!/usr/bin/env node
// Orchestrates the k6 baseline (H26.1/H12.1): board load / card move / RSVP / analytics summary at
// 1, 10, 100 VUs (and, if requested, a 1000-VU probe), writing one --summary-export JSON per
// (scenario, VU count) run to tools/perf/k6/out/. Each run shells out to:
//   docker run --rm --network host -v <k6 dir>:/scripts -v <out dir>:/out grafana/k6:<pinned> run \
//     --vus <n> --duration <t> -e TARGET=http://host.docker.internal:<API_PORT> \
//     --summary-export=/out/<scenario>-<n>vu.json /scripts/<scenario>.js
// `--network host` does not reach the Windows host from Docker Desktop's Linux VM (verified: the API
// bound on the Windows host is unreachable at 127.0.0.1 *inside* the container even with that flag),
// so the target is `host.docker.internal`, this repo's documented Windows fallback.
//
// Usage: node run-all.mjs [--vus 1,10,100] [--duration 30s] [--api-port 3000] [--k6-image grafana/k6:1.4.0]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, 'out')
mkdirSync(OUT_DIR, { recursive: true })

const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const VU_LEVELS = flag('vus', '1,10,100').split(',').map(Number)
const DURATION = flag('duration', '30s')
const API_PORT = flag('api-port', '3000')
const K6_IMAGE = flag('k6-image', 'grafana/k6:2.2.0') // pinned exact tag (TECH-SPEC §16)
const TARGET = `http://host.docker.internal:${API_PORT}`

const SCENARIOS = ['board-load', 'card-move', 'rsvp', 'analytics-summary']

function runK6(scriptFile, vus, duration, summaryName) {
  const dockerArgs = [
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    `${here}:/scripts`,
    '-v',
    `${OUT_DIR}:/out`,
    K6_IMAGE,
    'run',
    `--vus=${vus}`,
    `--duration=${duration}`,
    '-e',
    `TARGET=${TARGET}`,
    `--summary-export=/out/${summaryName}.json`,
    `/scripts/${scriptFile}`,
  ]
  console.log(`[k6] docker ${dockerArgs.join(' ')}`)
  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  } catch (e) {
    console.error(`[k6] run failed for ${summaryName}: ${e.message}`)
  }
}

function readSummary(name) {
  const p = join(OUT_DIR, `${name}.json`)
  if (!existsSync(p)) return null
  const j = JSON.parse(readFileSync(p, 'utf8'))
  const dur = j.metrics.http_req_duration || {}
  const failed = j.metrics.http_req_failed || {}
  return {
    reqs: j.metrics.http_reqs ? j.metrics.http_reqs.count : null,
    failedRate: failed.value ?? null,
    p50: dur['p(50)'] ?? dur.med ?? null,
    p90: dur['p(90)'] ?? null,
    p95: dur['p(95)'] ?? null,
    p99: dur['p(99)'] ?? null,
    avg: dur.avg ?? null,
    max: dur.max ?? null,
  }
}

const results = {}
for (const scenario of SCENARIOS) {
  results[scenario] = {}
  for (const vus of VU_LEVELS) {
    const summaryName = `${scenario}-${vus}vu`
    console.log(`\n[k6] === ${scenario} @ ${vus} VU(s) for ${DURATION} ===`)
    runK6(`${scenario}.js`, vus, DURATION, summaryName)
    results[scenario][vus] = readSummary(summaryName)
  }
}

writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
console.log('\n[k6] done. Aggregated results written to out/results.json')
console.log(JSON.stringify(results, null, 2))
