#!/usr/bin/env node
// H24.1 baseline: LCP/INP/CLS on the six main routes at simulated 4G, via Lighthouse CI
// (`npx @lhci/cli@<pinned>`, exact version below) driving Playwright's own downloaded Chromium
// (CHROME_PATH / --chromePath), authenticated as demo.boshliq through tools/perf/lighthouse/auth.cjs
// (a `--puppeteerScript`).
//
// Usage: node run-lhci.mjs [--base-url http://127.0.0.1:5173]
// Each route's Lighthouse JSON lands at tools/perf/lighthouse/out/<slug>/.lighthouseci/*.json --
// paths are printed and written to out/report-paths.json for the baseline report to cite.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const LHCI_VERSION = '0.15.1' // pinned exact version (repo convention: TECH-SPEC §16, "pin exact versions")

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const BASE_URL = flag('base-url', 'http://127.0.0.1:5173')
const OUT_TAG = flag('out-tag', 'dev') // 'dev' (Vite dev server) or 'prod' (production build via prod-server.mjs)
const OUT_ROOT = join(here, 'out', OUT_TAG)
mkdirSync(OUT_ROOT, { recursive: true })

function findPlaywrightChromium() {
  const cache = flag('ms-playwright-dir', join(process.env.LOCALAPPDATA || '', 'ms-playwright'))
  if (!existsSync(cache)) throw new Error(`Playwright browser cache not found at ${cache}. Run: npx playwright install chromium`)
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  if (!dirs.length) throw new Error(`No chromium-* folder under ${cache}. Run: npx playwright install chromium`)
  const exe = join(cache, dirs[0], 'chrome-win64', 'chrome.exe')
  const exeUnix = join(cache, dirs[0], 'chrome-linux', 'chrome')
  if (existsSync(exe)) return exe
  if (existsSync(exeUnix)) return exeUnix
  throw new Error(`chrome executable not found under ${join(cache, dirs[0])}`)
}

const CHROME_PATH = process.env.CHROME_PATH || findPlaywrightChromium()
console.log(`[lhci] using Chromium: ${CHROME_PATH}`)
console.log(`[lhci] @lhci/cli@${LHCI_VERSION}`)

const ROUTES = ['/', '/work', '/work/table', '/events', '/inbox', '/analytics']
const reportPaths = {}

for (const route of ROUTES) {
  const slug = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-')
  const outDir = join(OUT_ROOT, slug)
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
      'npx',
      [
        '--yes',
        `@lhci/cli@${LHCI_VERSION}`,
        'collect',
        `--url=${url}`,
        '--numberOfRuns=1',
        `--chromePath=${CHROME_PATH}`,
        '--puppeteerScript=../../../auth.cjs',
        ...settingsArgs,
      ],
      {
        cwd: outDir,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env },
        timeout: 120_000,
      },
    )
  } catch (e) {
    console.error(`[lhci] collect failed for ${route}: ${e.message}`)
  }

  const lhciDir = join(outDir, '.lighthouseci')
  if (existsSync(lhciDir)) {
    const jsonFiles = readdirSync(lhciDir).filter((f) => f.endsWith('.json') && !f.startsWith('links'))
    reportPaths[route] = jsonFiles.map((f) => join(lhciDir, f))
  } else {
    reportPaths[route] = []
  }
}

writeFileSync(join(OUT_ROOT, 'report-paths.json'), JSON.stringify(reportPaths, null, 2))
console.log('[lhci] done. Report paths written to out/report-paths.json')
