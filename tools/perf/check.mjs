#!/usr/bin/env node
// Supported perf gate: six built Lighthouse routes and four real 1-VU/5s endpoint journeys.
// The owned local runner bootstraps a dedicated guarded database and API/web children;
// an existing developer or production proxy is never reused for mutating load tests.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { completedScenario } from './k6/receipts.mjs'
import { assessBuiltRoute } from './lighthouse/budgets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function runNode(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
    child.once('error', (error) => {
      console.error(error.message)
      done(false)
    })
    child.once('close', (code) => done(code === 0))
  })
}

async function runLhciSmoke(webPort) {
  const routes = ['/', '/work', '/work/table', '/events', '/inbox', '/analytics']
  const outTag = 'production-build'
  if (
    !(await runNode([
      join(ROOT, 'tools/perf/lighthouse/run-lhci.mjs'),
      '--base-url',
      `http://127.0.0.1:${webPort}`,
      '--routes',
      routes.join(','),
      '--out-tag',
      outTag,
    ]))
  )
    return false
  const receipt = join(ROOT, `tools/perf/lighthouse/out/${outTag}/report-paths.json`)
  if (!existsSync(receipt)) {
    console.error('[perf:check] Lighthouse produced no receipt')
    return false
  }
  const reports = JSON.parse(readFileSync(receipt, 'utf8'))
  const files = routes.flatMap((route) => reports[route] ?? [])
  if (routes.some((route) => !reports[route]?.length) || files.some((file) => !existsSync(file))) {
    console.error('[perf:check] Lighthouse produced no current report')
    return false
  }
  console.log(`[perf:check] Lighthouse collected ${files.length} current report(s)`)
  const measurements = routes.map((route) => ({
    route,
    reports: reports[route].map((file) => ({
      file,
      ...assessBuiltRoute(JSON.parse(readFileSync(file, 'utf8'))),
    })),
  }))
  writeFileSync(
    join(ROOT, `tools/perf/lighthouse/out/${outTag}/budgets.json`),
    JSON.stringify(measurements, null, 2),
  )
  console.log(JSON.stringify({ productionBuildBudgets: measurements }))
  return measurements.every((route) => route.reports.every((report) => report.pass))
}

async function runK6Smoke(apiPort) {
  if (
    !(await runNode([
      join(ROOT, 'tools/perf/k6/run-all.mjs'),
      '--vus',
      '1',
      '--duration',
      '5s',
      '--api-port',
      String(apiPort),
      '--k6-binary',
      'k6',
    ]))
  )
    return false
  const receipt = join(ROOT, 'tools/perf/k6/out/results.json')
  if (!existsSync(receipt)) {
    console.error('[perf:check] k6 produced no receipt')
    return false
  }
  const results = JSON.parse(readFileSync(receipt, 'utf8'))
  let ok = true
  for (const scenario of ['board-load', 'card-move', 'rsvp', 'analytics-summary']) {
    const summary = results[scenario]?.['1']
    if (!completedScenario(summary)) {
      console.error(`[perf:check] ${scenario}: incomplete iterations or failed endpoint checks`)
      ok = false
    } else
      console.log(
        `[perf:check] ${scenario}: ${summary.iterations} iteration(s), ${summary.checksPassed} passed checks, p95=${summary.p95 ?? 'n/a'}ms, failedRate=${summary.failedRate ?? 'n/a'}`,
      )
  }
  return ok
}

export async function runChecks(apiPort, webPort) {
  if (
    process.env.FLOW_DB_NAME !== 'devon_qa_perf_gate' ||
    process.env.DEVON_PERF_LOCAL_FIXTURES !== '1' ||
    apiPort !== Number(process.env.FLOW_API_PORT) ||
    webPort !== Number(process.env.FLOW_WEB_PORT)
  ) {
    throw new Error('Performance checks require the owned guarded runner')
  }
  if (process.env.FLOW_PRODUCTION_BUILD !== '1')
    throw new Error('Performance checks require fresh production web assets')
  // Keep the diagnostic navigation measurements separate from concurrent mutating load.
  const [lighthouse, k6] = [await runLhciSmoke(webPort), await runK6Smoke(apiPort)]
  const ok = lighthouse && k6
  console.log(`[perf:check] ${ok ? 'PASS' : 'FAILED'}`)
  return ok
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const child = spawnSync(
    process.execPath,
    [
      join(ROOT, 'packages/db/node_modules/tsx/dist/cli.mjs'),
      join(ROOT, 'tools/perf/local-stack.mts'),
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  if (child.error) console.error(child.error.message)
  process.exit(child.status ?? 1)
}
