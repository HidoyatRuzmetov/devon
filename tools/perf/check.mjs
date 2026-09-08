#!/usr/bin/env node
// `pnpm -w perf:check` -- the `perf` gate's command (agentic/gates.json). A SMOKE check, not the full
// H26.1/H24.1 baseline measurement (that is tools/perf/k6/run-all.mjs's full VU matrix + tools/perf/
// lighthouse/run-lhci.mjs's full 6-route pass, run by hand for the hardening report): one Lighthouse
// pass on `/` and one 1-VU/5s k6 pass per scenario, just enough to catch "the app doesn't come up" or
// "a route 500s under Lighthouse's own load" in every gated run without the multi-minute cost of the
// real baseline.
//
// If nothing is listening on API_PORT/WEB_PORT yet, this boots Postgres+Valkey (the same `docker
// compose ... up -d postgres valkey` `pnpm start` runs) and spawns `api`/`web` dev servers itself,
// waits for both to answer, runs the smoke checks, then stops only the processes it started (the
// Postgres/Valkey containers are left running -- other gates/processes may already depend on them,
// same convention as scripts/start.mjs never tearing them down either).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API_PORT = Number(process.env.API_PORT || 3000)
const WEB_PORT = Number(process.env.WEB_PORT || 5173)
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`
const started = { api: null, web: null }

function httpOk(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await httpOk(url)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.error(`[perf:check] ${label} never became ready at ${url} within ${timeoutMs}ms.`)
  return false
}

function stopStarted() {
  for (const [name, child] of Object.entries(started)) {
    if (child) {
      console.log(`[perf:check] stopping ${name} (pid ${child.pid}) ...`)
      try { process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']) : child.kill('SIGTERM') } catch {}
    }
  }
}

async function ensureStackRunning() {
  const apiUp = await httpOk(`http://127.0.0.1:${API_PORT}/healthz`)
  const webUp = await httpOk(BASE_URL)
  if (apiUp && webUp) {
    console.log('[perf:check] api + web already reachable -- using the running instance.')
    return true
  }
  console.log('[perf:check] api/web not reachable -- booting Postgres/Valkey and dev servers for this smoke check.')
  const compose = spawnSync('docker', ['compose', '-f', join(ROOT, 'infra', 'docker-compose.yml'), 'up', '-d', 'postgres', 'valkey'], { stdio: 'inherit', cwd: ROOT })
  if (compose.status !== 0) {
    console.error('[perf:check] could not start postgres/valkey via docker compose -- is Docker running?')
    return false
  }
  // Migrations use whatever DATABASE_URL/.env this process already has (same contract as
  // scripts/start.mjs); if the workspace has never been migrated this also brings it up to date.
  spawnSync('pnpm', ['--filter', '@devon/db', 'migrate:apply'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' })

  if (!apiUp) {
    started.api = spawn('pnpm', ['--filter', '@devon/api', 'dev'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', detached: process.platform !== 'win32' })
  }
  if (!webUp) {
    started.web = spawn('pnpm', ['--filter', '@devon/web', 'dev'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', detached: process.platform !== 'win32' })
  }
  const [apiReady, webReady] = await Promise.all([
    waitFor(`http://127.0.0.1:${API_PORT}/healthz`, 'api'),
    waitFor(BASE_URL, 'web'),
  ])
  return apiReady && webReady
}

async function runLhciSmoke() {
  const result = spawnSync('node', [join(ROOT, 'tools', 'perf', 'lighthouse', 'run-lhci.mjs'), '--base-url', BASE_URL, '--routes', '/', '--out-tag', 'smoke'], { stdio: 'inherit', cwd: ROOT })
  if (result.status !== 0) {
    console.error('[perf:check] lhci smoke: run-lhci.mjs exited non-zero.')
    return false
  }
  const reportPathsFile = join(ROOT, 'tools', 'perf', 'lighthouse', 'out', 'smoke', 'report-paths.json')
  if (!existsSync(reportPathsFile)) {
    console.error('[perf:check] lhci smoke: no report-paths.json written -- collection did not run.')
    return false
  }
  const reportPaths = JSON.parse(readFileSync(reportPathsFile, 'utf8'))
  const files = reportPaths['/'] || []
  if (files.length === 0) {
    console.error('[perf:check] lhci smoke: "/" produced no Lighthouse report -- the route did not respond to Lighthouse\'s collector.')
    return false
  }
  console.log(`[perf:check] lhci smoke: "/" collected (${files.length} report file(s)).`)
  return true
}

async function runK6Smoke() {
  const result = spawnSync('node', [join(ROOT, 'tools', 'perf', 'k6', 'run-all.mjs'), '--vus', '1', '--duration', '5s', '--api-port', String(API_PORT)], { stdio: 'inherit', cwd: ROOT })
  if (result.status !== 0) {
    console.error('[perf:check] k6 smoke: run-all.mjs exited non-zero.')
    return false
  }
  const resultsFile = join(ROOT, 'tools', 'perf', 'k6', 'out', 'results.json')
  if (!existsSync(resultsFile)) {
    console.error('[perf:check] k6 smoke: no results.json written.')
    return false
  }
  const results = JSON.parse(readFileSync(resultsFile, 'utf8'))
  let ok = true
  for (const [scenario, byVu] of Object.entries(results)) {
    const summary = byVu['1']
    if (!summary || summary.reqs === null || summary.reqs === 0) {
      console.error(`[perf:check] k6 smoke: scenario "${scenario}" produced no completed requests -- target likely unreachable or the scenario itself failed to run.`)
      ok = false
      continue
    }
    console.log(`[perf:check] k6 smoke: "${scenario}" -- ${summary.reqs} req(s), p95=${summary.p95 ?? 'n/a'}ms, failedRate=${summary.failedRate ?? 'n/a'}`)
  }
  return ok
}

async function main() {
  if (spawnSync(process.platform === 'win32' ? 'where' : 'which', ['docker']).status !== 0) {
    console.error('[perf:check] docker not found on PATH -- required to run k6 (and, if the stack is not already up, Postgres/Valkey). Skipping is handled by agentic/gates.json\'s requires_cmd, not by this script.')
    process.exit(1)
  }
  const ready = await ensureStackRunning()
  if (!ready) {
    stopStarted()
    console.error('[perf:check] FAILED -- could not get api+web to a healthy state to run the smoke check against.')
    process.exit(1)
  }
  const [lhciOk, k6Ok] = await Promise.all([runLhciSmoke(), runK6Smoke()])
  stopStarted()
  if (!lhciOk || !k6Ok) {
    console.error('\n[perf:check] FAILED -- see output above.')
    process.exit(1)
  }
  console.log('\n[perf:check] PASS')
}

main().catch((err) => {
  console.error(err)
  stopStarted()
  process.exit(1)
})
