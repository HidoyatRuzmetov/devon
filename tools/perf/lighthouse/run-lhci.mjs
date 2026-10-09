#!/usr/bin/env node
// H24.1 baseline: LCP/INP/CLS on the six main routes at simulated 4G, via Lighthouse CI
// (installed @lhci/cli at the verified exact version below) driving Playwright's own Chromium
// (CHROME_PATH / --chromePath), authenticated as demo.boshliq through tools/perf/lighthouse/auth.cjs
// (a `--puppeteerScript`).
//
// Usage: node run-lhci.mjs [--base-url http://127.0.0.1:5173]
// Each route's Lighthouse JSON lands at tools/perf/lighthouse/out/<slug>/.lighthouseci/*.json --
// paths are printed and written to out/report-paths.json for the baseline report to cite.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { findPerformanceChromium } from './browser-path.mjs'

const LHCI_VERSION = '0.15.1' // pinned exact version (repo convention: TECH-SPEC §16, "pin exact versions")

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const BASE_URL = flag('base-url', 'http://127.0.0.1:5173')
const OUT_TAG = flag('out-tag', 'dev') // 'dev' (Vite dev server) or 'prod' (production build via prod-server.mjs)
const target = new URL(BASE_URL)
if (
  target.origin !== BASE_URL ||
  target.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(target.hostname)
)
  throw new Error('Lighthouse performance journeys require a literal local origin')
if (!/^[a-z0-9-]+$/.test(OUT_TAG)) throw new Error('Invalid local performance output tag')
const OUT_ROOT = join(here, 'out', OUT_TAG)
mkdirSync(OUT_ROOT, { recursive: true })
const RUN_ROOT = mkdtempSync(join(OUT_ROOT, 'run-'))

const CHROME_PATH =
  process.env.CHROME_PATH || findPerformanceChromium(flag('ms-playwright-dir', ''))
console.log(`[lhci] using Chromium: ${CHROME_PATH}`)
console.log(`[lhci] @lhci/cli@${LHCI_VERSION}`)
if (
  execFileSync('lhci', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim() !== LHCI_VERSION
)
  throw new Error('Installed Lighthouse CLI does not match the pinned version')

// `--routes /,/work` narrows this to a subset (tools/perf/check.mjs's "smoke" wiring passes just `/`
// -- a full 6-route Lighthouse pass is a multi-minute baseline measurement, not a per-gate smoke
// check); omit the flag for the original full baseline behaviour.
const ROUTES = flag('routes', '/,/work,/work/table,/events,/inbox,/analytics').split(',')
const reportPaths = {}
let allCollected = true

for (const route of ROUTES) {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(route)) throw new Error('Invalid local Lighthouse route')
  const slug = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-')
  const outDir = join(RUN_ROOT, slug)
  mkdirSync(outDir, { recursive: true })
  const url = `${BASE_URL}${route}`
  console.log(`[lhci] collecting ${url} ...`)

  const settings = {
    // Lighthouse's default mobile config already throttles to a "Slow 4G"-equivalent profile
    // (rttMs 150, throughputKbps 1638.4, cpuSlowdownMultiplier 4) under simulated throttling --
    // this is the "simulated 4G" HARDENING.md H24.1 asks for, made explicit here rather than relied
    // on implicitly.
    formFactor: 'mobile',
    throttlingMethod: 'simulate',
    'throttling.rttMs': 150,
    'throttling.throughputKbps': 1638.4,
    'throttling.cpuSlowdownMultiplier': 4,
    'screenEmulation.mobile': true,
    'screenEmulation.width': 412,
    'screenEmulation.height': 823,
    'screenEmulation.deviceScaleFactor': 2.625,
    'screenEmulation.disabled': false,
    onlyCategories: 'performance,accessibility,best-practices,seo',
    skipAudits: 'uses-http2', // dev server (Vite) is plain HTTP/1.1; not a production signal
  }
  const settingsArgs = Object.entries(settings).flatMap(([k, v]) => [`--settings.${k}=${v}`])

  try {
    execFileSync(
      'lhci',
      [
        'collect',
        `--url=${url}`,
        '--numberOfRuns=1',
        `--chromePath=${CHROME_PATH}`,
        `--puppeteerScript=${relative(outDir, join(here, 'auth.cjs'))}`,
        ...settingsArgs,
      ],
      {
        cwd: outDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env },
        timeout: 120_000,
      },
    )
  } catch (e) {
    console.error(`[lhci] collect failed for ${route}: ${e.message}`)
    allCollected = false
    reportPaths[route] = []
    continue
  }

  const lhciDir = join(outDir, '.lighthouseci')
  if (existsSync(lhciDir)) {
    const jsonFiles = readdirSync(lhciDir).filter(
      (f) => f.endsWith('.json') && !f.startsWith('links'),
    )
    reportPaths[route] = jsonFiles
      .map((f) => join(lhciDir, f))
      .filter((file) => {
        const report = JSON.parse(readFileSync(file, 'utf8'))
        const finalUrl = new URL(report.finalDisplayedUrl ?? report.finalUrl)
        return !report.runtimeError && finalUrl.origin === BASE_URL && finalUrl.pathname === route
      })
  } else {
    reportPaths[route] = []
  }
  if (reportPaths[route].length === 0) allCollected = false
}

writeFileSync(join(OUT_ROOT, 'report-paths.json'), JSON.stringify(reportPaths, null, 2))
console.log('[lhci] done. Report paths written to out/report-paths.json')
process.exitCode = allCollected ? 0 : 1
