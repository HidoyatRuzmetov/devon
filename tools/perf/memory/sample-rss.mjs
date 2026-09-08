#!/usr/bin/env node
// H11.1 baseline: samples the API process's RSS every N seconds for the duration of the k6 soak
// (tools/perf/k6/soak.js), writing a CSV so "flat memory" (or a leak) is visible without attaching a
// profiler. Cross-platform: PowerShell's Get-Process on Windows, `ps -o rss=` elsewhere.
//
// Usage: node sample-rss.mjs --pid 34684 --interval 30 --duration 600 --out ./out/rss-soak.csv
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const PID = Number(flag('pid'))
const INTERVAL_S = Number(flag('interval', 30))
const DURATION_S = Number(flag('duration', 600))
const OUT = flag('out', './out/rss-soak.csv')
if (!PID) {
  console.error('Usage: node sample-rss.mjs --pid <pid> [--interval 30] [--duration 600] [--out path.csv]')
  process.exit(1)
}
mkdirSync(dirname(OUT), { recursive: true })

function rssBytesWindows(pid) {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`],
    { encoding: 'utf8' },
  ).trim()
  return out ? Number(out) : null
}
function rssBytesUnix(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return out ? Number(out) * 1024 : null
  } catch {
    return null
  }
}
const rssBytes = process.platform === 'win32' ? rssBytesWindows : rssBytesUnix

const rows = [['elapsed_s', 'timestamp_iso', 'rss_bytes', 'rss_mb']]
const start = Date.now()
const samples = Math.floor(DURATION_S / INTERVAL_S) + 1

console.log(`[rss] sampling PID ${PID} every ${INTERVAL_S}s for ${DURATION_S}s (${samples} samples) -> ${OUT}`)

function sampleOnce(elapsedTarget) {
  const rss = rssBytes(PID)
  const row = [elapsedTarget, new Date().toISOString(), rss ?? '', rss != null ? (rss / 1024 / 1024).toFixed(1) : '']
  rows.push(row)
  console.log(`[rss] t=${elapsedTarget}s rss=${rss != null ? (rss / 1024 / 1024).toFixed(1) + ' MB' : 'process not found'}`)
  writeFileSync(OUT, rows.map((r) => r.join(',')).join('\n') + '\n')
}

let n = 0
sampleOnce(0)
const timer = setInterval(() => {
  n += 1
  const elapsed = Math.round((Date.now() - start) / 1000)
  sampleOnce(elapsed)
  if (n >= samples - 1) {
    clearInterval(timer)
    console.log('[rss] done.')
  }
}, INTERVAL_S * 1000)
