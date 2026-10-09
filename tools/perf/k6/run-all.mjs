#!/usr/bin/env node
// Orchestrates the k6 baseline (H26.1/H12.1): board load / card move / RSVP / analytics summary at
// 1, 10, 100 VUs (and, if requested, a 1000-VU probe), writing one --summary-export JSON per
// (scenario, VU count) run to tools/perf/k6/out/. Each run shells out to:
//   docker run --rm --network host -v <k6 dir>:/scripts -v <out dir>:/out grafana/k6:<pinned> run \
//     --vus <n> --duration <t> -e TARGET=http://host.docker.internal:<API_PORT> \
//     --summary-export=/out/<scenario>-<n>vu.json /scripts/<scenario>.js
// Native k6 and Linux host networking use loopback; Docker Desktop on Windows uses its
// host.docker.internal gateway. Release orchestration uses the verified native executable.
//
// Usage: node run-all.mjs [--vus 1,10,100] [--duration 30s] [--api-port 3000]
//   [--k6-image grafana/k6:2.2.0] [--k6-binary /path/to/k6]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { k6Target, summarizeK6Receipt } from './receipts.mjs'

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
const K6_BINARY = flag('k6-binary', '')
const TARGET = k6Target(process.platform, API_PORT, Boolean(K6_BINARY))
const RUN_DIR = mkdtempSync(join(OUT_DIR, 'run-'))

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
    `${RUN_DIR}:/out`,
    K6_IMAGE,
    'run',
    `--vus=${vus}`,
    `--duration=${duration}`,
    '-e',
    `TARGET=${TARGET}`,
    '-e',
    `DEVON_PERF_LOCAL_FIXTURES=${process.env.DEVON_PERF_LOCAL_FIXTURES ?? ''}`,
    '-e',
    `DEVON_PERF_DB_NAME=${process.env.DEVON_PERF_DB_NAME ?? ''}`,
    '-e',
    'K6_NO_USAGE_REPORT=true',
    `--summary-export=/out/${summaryName}.json`,
    `/scripts/${scriptFile}`,
  ]
  const nativeArgs = [
    'run',
    `--vus=${vus}`,
    `--duration=${duration}`,
    '-e',
    `TARGET=${TARGET}`,
    `--summary-export=${join(RUN_DIR, `${summaryName}.json`)}`,
    join(here, scriptFile),
  ]
  console.log(`[k6] ${K6_BINARY ? 'native' : 'docker'} ${scriptFile}: ${vus} VU(s), ${duration}`)
  try {
    execFileSync(K6_BINARY || 'docker', K6_BINARY ? nativeArgs : dockerArgs, {
      stdio: 'inherit',
      env: { ...process.env, K6_NO_USAGE_REPORT: 'true', MSYS_NO_PATHCONV: '1' },
    })
    return true
  } catch (e) {
    console.error(`[k6] run failed for ${summaryName}: ${e.message}`)
    return false
  }
}

function readSummary(name) {
  const p = join(RUN_DIR, `${name}.json`)
  if (!existsSync(p)) return null
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return {
    ...summarizeK6Receipt(j),
    report: p,
  }
}

const results = {}
let allExecuted = true
for (const scenario of SCENARIOS) {
  results[scenario] = {}
  for (const vus of VU_LEVELS) {
    const summaryName = `${scenario}-${vus}vu`
    console.log(`\n[k6] === ${scenario} @ ${vus} VU(s) for ${DURATION} ===`)
    const executed = runK6(`${scenario}.js`, vus, DURATION, summaryName)
    try {
      results[scenario][vus] = executed ? readSummary(summaryName) : null
    } catch (error) {
      console.error(`[k6] invalid current receipt for ${summaryName}: ${error.message}`)
      results[scenario][vus] = null
    }
    if (!executed || results[scenario][vus] === null) allExecuted = false
  }
}

writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
console.log('\n[k6] done. Aggregated results written to out/results.json')
console.log(JSON.stringify(results, null, 2))
process.exitCode = allExecuted ? 0 : 1
