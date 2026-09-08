#!/usr/bin/env node
// H2.4/H2.9/H3/H24.1 baseline measurement: for each of the six main routes, as demo.boshliq, record
// requests/bytes/API-calls/duplicates/waterfall via CDP `Network.*` events (encodedDataLength is the
// actual wire byte count, not a `content-length` header guess -- correct even for chunked/compressed
// responses), and the Postgres statement count the route caused via `pg_stat_statements`, reset
// immediately before each route's navigation.
//
// Usage:  node measure-routes.mjs [--base-url http://127.0.0.1:5173] [--out ./out]
// Requires: `pnpm start --demo` already running (web on --base-url, api proxied through it);
//           the `postgres` compose service must have `pg_stat_statements` in `shared_preload_libraries`
//           (infra/docker-compose.yml) and `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` run once.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const BASE_URL = flag('base-url', 'http://127.0.0.1:5173')
const OUT_DIR = flag('out', join(here, 'out'))
mkdirSync(OUT_DIR, { recursive: true })

const DEMO_USER = process.env.DEVON_PERF_USER || 'demo.boshliq'
const DEMO_PASSWORD = process.env.DEVON_PERF_PASSWORD || 'Ishonchli#2026'

const ROUTES = ['/', '/work', '/work/table', '/events', '/inbox', '/analytics']

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'devon-postgres', 'psql', '-U', 'postgres', '-d', 'devon', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

function resetSqlStats() {
  try {
    psql('SELECT pg_stat_statements_reset();')
  } catch (e) {
    console.error('[measure] pg_stat_statements_reset failed -- is the extension installed? ' + e.message)
  }
}

/** Sum of `calls` across every statement recorded since the last reset, plus the top rows by calls
 * for evidence. Excludes pg_stat_statements' own bookkeeping query. */
function readSqlStats() {
  const totalsRaw = psql(
    "SELECT coalesce(sum(calls),0), coalesce(sum(rows),0), coalesce(round(sum(total_exec_time)::numeric,2),0) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%';",
  )
  const [calls, rows, totalMs] = totalsRaw.split('|').map((v) => Number(v))
  const topRaw = psql(
    "SELECT calls || '\t' || rows || '\t' || round(total_exec_time::numeric,2) || '\t' || left(regexp_replace(query, '\\s+', ' ', 'g'), 140) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' ORDER BY calls DESC LIMIT 10;",
  )
  const top = topRaw
    ? topRaw.split('\n').map((line) => {
        const [c, r, ms, q] = line.split('\t')
        return { calls: Number(c), rows: Number(r), totalMs: Number(ms), query: q }
      })
    : []
  return { calls, rows, totalExecMs: totalMs, top }
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="identifier"]', DEMO_USER)
  await page.fill('input[name="password"]', DEMO_PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ])
}

async function measureRoute(page, client, route) {
  /** @type {Map<string, any>} */
  const byRequestId = new Map()
  const events = []

  const onWillBeSent = (p) => {
    byRequestId.set(p.requestId, {
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      resourceType: p.type,
      wallStartMs: Date.now(),
      cdpStartS: p.timestamp,
      status: null,
      encodedBytes: 0,
      fromCache: false,
      endS: null,
    })
  }
  const onResponse = (p) => {
    const r = byRequestId.get(p.requestId)
    if (!r) return
    r.status = p.response.status
    r.mimeType = p.response.mimeType
    r.fromCache = !!p.response.fromDiskCache || !!p.response.fromServiceWorker
    // `encodedDataLength` is not final until loadingFinished; headers size is a reasonable floor.
    r.headersBytes = (p.response.headersText || '').length
  }
  const onFinished = (p) => {
    const r = byRequestId.get(p.requestId)
    if (!r) return
    r.encodedBytes = p.encodedDataLength || 0
    r.endS = p.timestamp
    events.push(r)
  }
  const onFailed = (p) => {
    const r = byRequestId.get(p.requestId)
    if (!r) return
    r.failed = true
    r.errorText = p.errorText
    r.endS = p.timestamp
    events.push(r)
  }

  client.on('Network.requestWillBeSent', onWillBeSent)
  client.on('Network.responseReceived', onResponse)
  client.on('Network.loadingFinished', onFinished)
  client.on('Network.loadingFailed', onFailed)

  resetSqlStats()
  const navStart = Date.now()
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch((e) => {
    console.error(`[measure] navigation to ${route} did not reach networkidle: ${e.message}`)
  })
  // Give in-flight TanStack Query refetches / lazy chunks a moment to settle after networkidle fires.
  await page.waitForTimeout(500)
  const navEndWall = Date.now()

  client.off('Network.requestWillBeSent', onWillBeSent)
  client.off('Network.responseReceived', onResponse)
  client.off('Network.loadingFinished', onFinished)
  client.off('Network.loadingFailed', onFailed)

  const sql = readSqlStats()

  const cdpBase = events.length ? Math.min(...events.map((e) => e.cdpStartS)) : 0
  const waterfall = events
    .map((e) => ({
      url: e.url,
      method: e.method,
      resourceType: e.resourceType,
      status: e.status,
      failed: !!e.failed,
      fromCache: e.fromCache,
      bytes: e.encodedBytes,
      startOffsetMs: Math.round((e.cdpStartS - cdpBase) * 1000),
      durationMs: e.endS != null ? Math.round((e.endS - e.cdpStartS) * 1000) : null,
    }))
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs)

  const apiRequests = waterfall.filter((w) => w.url.includes('/api/'))
  const totalBytes = waterfall.reduce((s, w) => s + w.bytes, 0)
  const byKey = new Map()
  for (const w of waterfall) {
    const key = `${w.method} ${w.url}`
    byKey.set(key, (byKey.get(key) || 0) + 1)
  }
  const duplicates = [...byKey.entries()].filter(([, n]) => n > 1)

  const nav = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation')
    if (!entry) return null
    return {
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
      loadEventMs: Math.round(entry.loadEventEnd),
      transferSizeBytes: entry.transferSize,
    }
  })

  return {
    route,
    wallDurationMs: navEndWall - navStart,
    navigationTiming: nav,
    totalRequests: waterfall.length,
    totalBytes,
    apiRequestCount: apiRequests.length,
    apiBytes: apiRequests.reduce((s, w) => s + w.bytes, 0),
    duplicateRequestGroups: duplicates.map(([key, count]) => ({ key, count })),
    sql,
    waterfall,
  }
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Network.enable')
  // Realistic 4G-ish shaping keeps this comparable to the Lighthouse CWV run, without the full
  // Lighthouse harness overhead -- not required for byte/request/SQL counts, only left commented as
  // a knob: await client.send('Network.emulateNetworkConditions', { offline:false, latency:150,
  // downloadThroughput: 1.6*1024*1024/8, uploadThroughput: 750*1024/8 })

  console.log(`[measure] logging in as ${DEMO_USER} ...`)
  await login(page)
  console.log('[measure] logged in.')

  const results = []
  for (const route of ROUTES) {
    console.log(`[measure] route ${route} ...`)
    const result = await measureRoute(page, client, route)
    results.push(result)
    const slug = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-')
    writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(result, null, 2))
    console.log(
      `[measure]   requests=${result.totalRequests} bytes=${result.totalBytes} api=${result.apiRequestCount} dupGroups=${result.duplicateRequestGroups.length} sqlCalls=${result.sql.calls} wallMs=${result.wallDurationMs}`,
    )
  }

  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(results, null, 2))
  await browser.close()
  console.log(`[measure] done. Per-route JSON + summary.json written to ${OUT_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
