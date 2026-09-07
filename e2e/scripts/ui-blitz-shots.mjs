#!/usr/bin/env node
// Screenshot evidence for the UI-blitz pass over `docs/03-plan/UI-OVERHAUL.md`: every route this repo
// declares in `e2e/routes.json` (this item's own handoff contract, `routes.schema.json` -- now every
// sidebar destination, not just the five foundation routes: work's four views, projects, personal,
// events, people, structure, pages, analytics, ai, departments, account and every `/admin/*` tab),
// captured at 1440x900 and 390x844, light and dark, uz-Latn and ru.
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
//     --out agentic/ledger/ui-blitz/<timestamp>/final
//
// Every route x width x theme x locale combination is captured full-page. Role-aware login (package
// `demo-super-admin`): a route whose `routes.json` entry has `auth: "super_admin"` (every `/admin/*`
// tab) is captured signed in as the seeded super admin (`packages/db/src/seed/fixtures.ts`'s
// `DEMO_SUPER_ADMIN`, login `admin.super` -- MODULE-GUIDE.md "Running the app"); every other route
// (`auth: "session"` or `"public"`) is captured signed in as the demo head (`demo.boshliq`), exactly
// as before. Before `DEMO_SUPER_ADMIN` existed, no seeded account held the `super_admin` role at all,
// so every `/admin*` capture was necessarily the route's own no-permission state
// (`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/report.md`'s "One gap up front") -- this script
// now exercises the console itself. Missing routes are reported, never silently skipped -- a
// screenshot set with a hole in it is worse than no set.
//
// The locale axis is driven through the real `LocaleMenu` (see `switchLocale` below), never through a
// `devon_locale` localStorage seed -- `critique.md`'s "Locale note" found the previous version of this
// script produced byte-identical uz/ru captures for exactly that reason (`app.tsx`'s
// `LocaleReconciler` lets the signed-in user's own record win over any storage seed). `main()` also
// asserts the root route's uz-Latn and ru captures actually differ, so that regression cannot recur
// silently.
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
// The one demo password every seeded account shares, head and super admin alike
// (`packages/db/src/seed/fixtures.ts`'s `DEMO_PASSWORD`, documented in MODULE-GUIDE.md "Running the
// app") -- not read from that package directly (this directory manages its own `node_modules` outside
// the pnpm workspace, `package.json`'s own header comment) so the defaults are repeated, not imported;
// all four are overridable by flag if the seed ever changes.
const LOGIN = argOf('login', 'demo.boshliq')
const PASSWORD = argOf('password', 'Ishonchli#2026')
const SUPER_LOGIN = argOf('superLogin', 'admin.super')
const SUPER_PASSWORD = argOf('superPassword', 'Ishonchli#2026')

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['light', 'dark']
// `critique.md`'s own "Locale note": byte-identical uz/ru captures were a *harness* artefact, not a
// product bug -- `apps/web/src/app.tsx`'s `LocaleReconciler` lets the signed-in user's own record win
// over whatever `devon_locale` a capture script seeds into localStorage. So this script drives the
// real `LocaleMenu` (`packages/ui/src/shell/locale-menu.tsx`) through the UI instead: `shell.locale.
// aria` is the trigger's accessible name (itself locale-dependent, hence LOCALE_ARIA_LABEL below), and
// each option's accessible name is its fixed autonym (`packages/i18n/src/locale.ts`'s `LOCALE_LABEL`
// -- "always in their own language, never translated", so these never change with the active locale).
const LOCALES = ['uz-Latn', 'ru']
const LOCALE_ARIA_LABEL = { 'uz-Latn': 'Interfeys tili', ru: 'Язык интерфейса' }
const LOCALE_AUTONYM = { 'uz-Latn': "Oʻzbekcha (lotin)", ru: 'Русский' }

/** Two clicks, exactly as design.md §4.3/AC-4 describes it: open the trigger (found by its current
 * accessible name -- `fromLocale`, the locale this page is already rendering in), then the target
 * option (found by its fixed autonym, so this line never depends on which locale is active). Asserts
 * the chip actually changed so a silent no-op (harness drift, a renamed key) fails loudly instead of
 * quietly shipping byte-identical "two locales". */
async function switchLocale(page, fromLocale, toLocale) {
  if (fromLocale === toLocale) return
  const trigger = page.getByRole('button', { name: LOCALE_ARIA_LABEL[fromLocale], exact: true })
  await trigger.click()
  await page.getByRole('menuitemradio', { name: LOCALE_AUTONYM[toLocale], exact: true }).click()
  await page.getByRole('button', { name: LOCALE_ARIA_LABEL[toLocale], exact: true }).waitFor({ timeout: 5_000 })
}

async function loadRoutes() {
  const raw = await readFile(join(E2E_DIR, 'routes.json'), 'utf8')
  return JSON.parse(raw).routes
}

/**
 * Signs into one fresh browser context as `credentials`, switches locale if needed, captures every
 * route in `routesForSession` at `size`/`theme`, restores the account's locale, and closes the
 * context. Factored out of `main()` so a session can be run once per credential (head, super admin)
 * per size/theme/locale cell without duplicating the sign-in/locale/capture/restore choreography.
 */
async function captureSession(browser, { credentials, routesForSession, size, theme, locale, failures }) {
  if (routesForSession.length === 0) return

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
  const label = `${size.name}/${theme}/${locale}/${credentials.login}`

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.fill('input[name="identifier"]', credentials.login)
    await page.fill('input[name="password"]', credentials.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 })
  } catch (error) {
    failures.push(`sign-in failed (${label}): ${String(error)}`)
    await context.close()
    return
  }

  if (locale !== 'uz-Latn') {
    try {
      // Real UI switch (design.md §4.3/AC-4), never the `devon_locale` localStorage seed the
      // previous version of this script wrote -- `LocaleReconciler` (app.tsx) lets the
      // signed-in user's own record win over that seed, which is exactly why the byte-identical
      // uz/ru captures `critique.md` flagged were a harness artefact, not a product bug.
      await switchLocale(page, 'uz-Latn', locale)
    } catch (error) {
      failures.push(`locale switch to ${locale} failed (${label}): ${String(error)}`)
      await context.close()
      return
    }
  }

  for (const route of routesForSession) {
    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
      // Let entrance animations/staggers settle so a shot is of the screen, not of frame 3
      // (`ui-foundation-shots.mjs` verified 900ms is enough for this catalogue's longest stagger).
      await page.waitForTimeout(900)
      const file = join(OUT, `${route.slug}__${size.name}__${theme}__${locale}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log(`[ui-blitz-shots] ${file}`)
    } catch (error) {
      failures.push(`${route.slug} ${label}: ${String(error)}`)
    }
  }

  if (locale !== 'uz-Latn') {
    // Leave the shared demo account the way this script found it, so a later run (or another
    // suite) never inherits a locale this script switched for its own purposes.
    try {
      await switchLocale(page, locale, 'uz-Latn')
    } catch (error) {
      failures.push(`locale reset to uz-Latn failed (${label}): ${String(error)}`)
    }
  }

  await context.close()
}

async function main() {
  const routes = await loadRoutes()
  // Role-aware split (package `demo-super-admin`): `routes.json`'s `auth` field is the single source
  // of truth for which credential a route needs -- `super_admin` routes go to `DEMO_SUPER_ADMIN`,
  // everything else (`session`/`public`) goes to the demo head, exactly as `auth.ts`/the app's own
  // route guard already decides at runtime.
  const headRoutes = routes.filter((r) => r.auth !== 'super_admin')
  const superAdminRoutes = routes.filter((r) => r.auth === 'super_admin')
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const failures = []

  // A route x width x theme x locale grid, locale outermost (each signed-in context only ever needs
  // to switch the menu once -- uz-Latn is the seeded demo department's own default locale,
  // `DEMO_DEPARTMENT.localeDefault`, so a fresh head session already renders it and needs no switch
  // there; `DEMO_SUPER_ADMIN` is seeded with the same default for the identical reason). Within each
  // cell, two short-lived sessions run in turn -- head first (covers every non-`super_admin` route,
  // matching this script's original coverage exactly), then the super admin (covers only the
  // `/admin/*` tabs) -- rather than one long-lived session per cell, so neither account's own locale
  // setting or session cookie ever leaks into the other's capture.
  for (const locale of LOCALES) {
    for (const size of SIZES) {
      for (const theme of THEMES) {
        await captureSession(browser, {
          credentials: { login: LOGIN, password: PASSWORD },
          routesForSession: headRoutes,
          size,
          theme,
          locale,
          failures,
        })
        await captureSession(browser, {
          credentials: { login: SUPER_LOGIN, password: SUPER_PASSWORD },
          routesForSession: superAdminRoutes,
          size,
          theme,
          locale,
          failures,
        })
      }
    }
  }

  // Verifies the locale switch was real, not the harness artefact `critique.md` (§"Locale note")
  // documented: the root route's uz-Latn and ru captures at the same width/theme must differ.
  if (LOCALES.includes('uz-Latn') && LOCALES.includes('ru')) {
    const rootRoute = routes.find((r) => r.slug === 'root' || r.path === '/')
    if (rootRoute) {
      const a = join(OUT, `${rootRoute.slug}__1440__light__uz-Latn.png`)
      const b = join(OUT, `${rootRoute.slug}__1440__light__ru.png`)
      try {
        const [bufA, bufB] = await Promise.all([readFile(a), readFile(b)])
        if (Buffer.compare(bufA, bufB) === 0) {
          failures.push(
            `locale switch did not change the rendered page: ${a} and ${b} are byte-identical`,
          )
        } else {
          console.log(`[ui-blitz-shots] locale switch verified: ${a} differs from ${b}`)
        }
      } catch (error) {
        failures.push(`locale-switch verification could not read both captures: ${String(error)}`)
      }
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
