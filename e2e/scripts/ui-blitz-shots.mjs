#!/usr/bin/env node
// Screenshot evidence for the UI-blitz pass over `docs/03-plan/UI-OVERHAUL.md`: every route this repo
// declares in `e2e/routes.json` (this item's own handoff contract, `routes.schema.json`), captured as
// the seeded demo head (`packages/db/src/seed/fixtures.ts`'s `demo.boshliq`, documented in
// MODULE-GUIDE.md "Running the app"), at 1440x900 and 390x844, light and dark.
//
// Deliberately a standalone script, not a Playwright spec, for the exact reason
// `e2e/scripts/ui-foundation-shots.mjs` already documents: it drives a *running* `pnpm start --demo`
// (real Postgres behind a real `apps/api`, a real seeded session) rather than the gate's own
// Playwright projects, which spin up their own web server against no database at all -- joining those
// would either fail outright or quietly assert nothing. Reads `../routes.json` directly (the same
// contract `lib/routes.ts` types for the spec suite) so this script never drifts from that suite's own
// idea of "every route" -- adding or removing a route only ever means editing `routes.json`.
//
//   node e2e/scripts/ui-blitz-shots.mjs \
//     --base http://127.0.0.1:5173 \
//     --out agentic/ledger/ui-blitz/<timestamp>/after
//
// Every route x width x theme combination is captured full-page. A route that requires a session
// (`routes.json`'s `auth: "session"`) is shot signed in as the demo head; `auth: "public"` /
// `auth: "super_admin"` routes are shot in that same signed-in browser too (a `super_admin`-only route
// like `/admin` then correctly renders its designed no-permission state for a department head, and
// `/login` correctly renders its form regardless of session -- both real, intended product behaviour,
// not a gap in this script). Missing routes are reported, never silently skipped -- a screenshot set
// with a hole in it is worse than no set.
import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const E2E_DIR = join(SCRIPT_DIR, '..')

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : (args[i + 1] ?? fallback)
}

const BASE = argOf('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = argOf('out', join('agentic', 'ledger', 'ui-blitz', 'latest', 'after'))
// The one demo password every seeded account shares (`packages/db/src/seed/fixtures.ts`'s
// `DEMO_PASSWORD`, documented in MODULE-GUIDE.md "Running the app") -- not read from that package
// directly (this directory manages its own `node_modules` outside the pnpm workspace, `package.json`'s
// own header comment) so the two defaults are repeated, not imported; both are overridable by flag if
// the seed ever changes.
const LOGIN = argOf('login', 'demo.boshliq')
const PASSWORD = argOf('password', 'Ishonchli#2026')

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['light', 'dark']

async function loadRoutes() {
  const raw = await readFile(join(E2E_DIR, 'routes.json'), 'utf8')
  return JSON.parse(raw).routes
}

async function main() {
  const routes = await loadRoutes()
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const failures = []

  for (const size of SIZES) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
        deviceScaleFactor: 1,
      })
      // `apps/web/src/lib/theme.ts`'s `bootTheme()` reads this key before first paint when it is set
      // ("light"/"dark" pin the theme outright; leaving it unset would let `bootTheme()` fall through
      // to `system`, which already matches `colorScheme` above -- set explicitly anyway so a shot never
      // depends on that fallback continuing to agree with the context option).
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem('devon_theme', t)
        } catch {
          /* storage disabled -- the shot still renders the OS-matched theme via colorScheme */
        }
      }, theme)

      const page = await context.newPage()

      try {
        await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
        await page.fill('input[name="identifier"]', LOGIN)
        await page.fill('input[name="password"]', PASSWORD)
        await page.click('button[type="submit"]')
        await page.waitForURL(`${BASE}/`, { timeout: 15_000 })
      } catch (error) {
        failures.push(`sign-in failed (${size.name}/${theme}): ${String(error)}`)
        await context.close()
        continue
      }

      for (const route of routes) {
        try {
          await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
          // Let entrance animations/staggers settle so a shot is of the screen, not of frame 3
          // (`ui-foundation-shots.mjs` verified 900ms is enough for this catalogue's longest stagger).
          await page.waitForTimeout(900)
          const file = join(OUT, `${route.slug}__${size.name}__${theme}.png`)
          await page.screenshot({ path: file, fullPage: true })
          console.log(`[ui-blitz-shots] ${file}`)
        } catch (error) {
          failures.push(`${route.slug} ${size.name}/${theme}: ${String(error)}`)
        }
      }
      await context.close()
    }
  }

  await browser.close()
  if (failures.length > 0) {
    console.error(`[ui-blitz-shots] ${failures.length} failed:`)
    for (const f of failures) console.error(`   ${f}`)
    process.exit(1)
  }
  console.log(`[ui-blitz-shots] done -> ${OUT}`)
}

await main()
