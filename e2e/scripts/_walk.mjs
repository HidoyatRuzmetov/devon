#!/usr/bin/env node
// v1.1 integration walk: sign in as one persona, visit every route, report what is broken.
// Not evidence -- a bug finder. Screenshots come from e2e/scripts/ui-blitz-shots.mjs.
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : (args[i + 1] ?? d)
}
const BASE = argOf('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const LOGIN = argOf('login', 'demo.boshliq')
const PASSWORD = argOf('password', 'Ishonchli#2026')
const LOCALE = argOf('locale', 'uz-Latn')
const WIDTH = Number(argOf('width', '1440'))
const HEIGHT = Number(argOf('height', '900'))
const OUT = argOf('out', '')
const ROUTES = argOf('routes', '').split(',').filter(Boolean)

const ALL_ROUTES =
  ROUTES.length > 0
    ? ROUTES
    : [
        '/',
        '/inbox',
        '/inbox/preferences',
        '/inbox/telegram',
        '/work',
        '/work/table',
        '/work/timeline',
        '/work/calendar',
        '/work/mine',
        '/work/archive',
        '/work/workload',
        '/work/templates',
        '/projects',
        '/personal',
        '/events',
        '/people',
        '/people/table',
        '/people/me',
        '/structure',
        '/pages',
        '/analytics',
        '/ai',
        '/goals',
        '/automations',
        '/fields',
        '/calendar',
        '/calendar?tab=feeds',
        '/calendar?tab=push',
        '/department',
        '/departments',
        '/departments/new',
        '/departments/requests',
        '/account',
        '/admin',
        '/admin/departments',
        '/admin/accounts',
        '/admin/analytics',
        '/admin/audit',
        '/admin/health',
        '/admin/settings',
        '/404',
      ]

const LOCALE_ARIA = {
  'uz-Latn': 'Interfeys tili',
  ru: 'Язык интерфейса',
  en: 'Interface language',
  'uz-Cyrl': 'Интерфейс тили',
}
const LOCALE_AUTONYM = {
  'uz-Latn': 'Oʻzbekcha (lotin)',
  'uz-Cyrl': 'Ўзбекча (кирилл)',
  ru: 'Русский',
  en: 'English',
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

const report = []
let bucket = null
page.on('console', (m) => {
  if (bucket && (m.type() === 'error' || m.type() === 'warning'))
    bucket.console.push(`${m.type()}: ${m.text()}`.slice(0, 400))
})
page.on('pageerror', (e) => {
  if (bucket) bucket.console.push(`pageerror: ${String(e).slice(0, 400)}`)
})
page.on('requestfailed', (r) => {
  if (bucket) bucket.net.push(`FAILED ${r.method()} ${r.url().replace(BASE, '')}`)
})
page.on('response', (r) => {
  if (!bucket) return
  const u = r.url()
  if (!u.includes('/api/v1/')) return
  if (r.status() >= 400)
    bucket.net.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`)
})

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[name="identifier"]', LOGIN)
await page.fill('input[name="password"]', PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 20_000 })

if (LOCALE !== 'uz-Latn') {
  await page.getByRole('button', { name: LOCALE_ARIA['uz-Latn'], exact: true }).click()
  await page.getByRole('menuitemradio', { name: LOCALE_AUTONYM[LOCALE], exact: true }).click()
  await page
    .getByRole('button', { name: LOCALE_ARIA[LOCALE], exact: true })
    .waitFor({ timeout: 8_000 })
}

for (const route of ALL_ROUTES) {
  bucket = { route, console: [], net: [] }
  let info = {}
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25_000 })
    await page.waitForTimeout(800)
    info = await page.evaluate(() => {
      const main = document.querySelector('main')
      const text = main ? main.innerText : document.body.innerText
      const h1 = document.querySelector('main h1, h1')
      const missing = Array.from(new Set(text.match(/⟨[^⟩]+⟩/g) || []))
      // horizontal overflow
      const de = document.documentElement
      const overflow =
        de.scrollWidth > de.clientWidth + 1 ? `${de.scrollWidth}>${de.clientWidth}` : null
      const wide = []
      for (const el of Array.from(document.querySelectorAll('main *'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > de.clientWidth + 2 && el.children.length === 0) {
          wide.push(
            el.tagName +
              '.' +
              (el.className || '').toString().slice(0, 40) +
              ' @' +
              Math.round(r.right),
          )
        }
      }
      // a StateView marker
      const state =
        document.querySelector('[data-state-view]')?.getAttribute('data-state-view') ?? null
      return {
        title: document.title,
        h1: h1 ? h1.innerText.slice(0, 80) : null,
        chars: text.trim().length,
        preview: text.trim().slice(0, 160).replace(/\s+/g, ' '),
        missing,
        overflow,
        wide: wide.slice(0, 4),
        state,
      }
    })
  } catch (e) {
    info = { error: String(e).slice(0, 300) }
  }
  report.push({ ...bucket, ...info })
}

bucket = null
await browser.close()

const lines = []
for (const r of report) {
  const flags = []
  if (r.error) flags.push('NAV-ERROR')
  if (r.chars !== undefined && r.chars < 60) flags.push('NEARLY-BLANK')
  if (r.missing?.length) flags.push('MISSING-I18N')
  if (r.overflow) flags.push('H-OVERFLOW')
  if (r.console.length) flags.push('CONSOLE')
  if (r.net.length) flags.push('NET')
  lines.push(`\n### ${r.route}  ${flags.length ? '[' + flags.join(',') + ']' : 'ok'}`)
  lines.push(
    `  title=${r.title ?? '?'} h1=${r.h1 ?? '-'} chars=${r.chars ?? '?'} state=${r.state ?? '-'}`,
  )
  if (r.preview) lines.push(`  preview: ${r.preview}`)
  if (r.error) lines.push(`  error: ${r.error}`)
  if (r.missing?.length) lines.push(`  missing: ${r.missing.join(' ')}`)
  if (r.overflow) lines.push(`  overflow: ${r.overflow}  wide=${(r.wide || []).join(' | ')}`)
  for (const c of r.console.slice(0, 6)) lines.push(`  console: ${c}`)
  for (const n of r.net.slice(0, 8)) lines.push(`  net: ${n}`)
}
const out = `# walk ${LOGIN} ${LOCALE} ${WIDTH}x${HEIGHT}\n${lines.join('\n')}\n`
if (OUT) await writeFile(OUT, out, 'utf8')
console.log(out)
