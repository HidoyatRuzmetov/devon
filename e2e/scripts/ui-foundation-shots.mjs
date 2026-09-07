#!/usr/bin/env node
// Screenshot evidence for the UI overhaul's foundation pass (UI-OVERHAUL.md §6: "Screenshots of
// every route at 1440/390 x light/dark x uz-Latn/ru ... captured by a Playwright script committed to
// e2e/").
//
// Deliberately a standalone script, not a spec: it drives a *running* `pnpm start --demo` (it signs
// in as the seeded head account and needs the real API behind it), so it must never join the gate's
// Playwright projects, which spin up their own web server and run against no database.
//
//   node e2e/scripts/ui-foundation-shots.mjs --base http://127.0.0.1:5173 --out agentic/ledger/ui/<ts>
//
// Every combination in the matrix below is captured full-page. Missing routes are reported, never
// silently skipped -- a screenshot set with a hole in it is worse than no set.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : (args[i + 1] ?? fallback)
}

const BASE = argOf('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = argOf('out', join('agentic', 'ledger', 'ui-foundation', 'latest'))
const LOGIN = argOf('login', 'demo.boshliq')
const PASSWORD = argOf('password', 'Ishonchli#2026')

const WIDTHS = [
  { name: '1440', width: 1440, height: 1000 },
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['light', 'dark']
const LOCALES = ['uz-Latn', 'ru']
const ROUTES = [
  { slug: 'login', path: '/login', auth: false },
  { slug: 'home', path: '/', auth: true },
  { slug: 'work', path: '/work', auth: true },
  { slug: 'events', path: '/events', auth: true },
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const failures = []

  for (const size of WIDTHS) {
    for (const theme of THEMES) {
      for (const locale of LOCALES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: theme,
          locale: locale === 'ru' ? 'ru-RU' : 'uz-UZ',
          deviceScaleFactor: 1,
        })
        // Theme and locale are read from localStorage before the first paint (`main.tsx`), so both
        // are set as an init script rather than toggled after load -- otherwise every shot would
        // capture the transition rather than the state.
        await context.addInitScript(
          ([t, l]) => {
            try {
              // `apps/web/src/lib/constants.ts` -- the keys `bootTheme()`/`bootLocale()` read
              // before the first paint.
              window.localStorage.setItem('devon_theme', t)
              window.localStorage.setItem('devon_locale', l)
            } catch {
              /* storage disabled -- the shot still renders the default */
            }
          },
          [theme, locale],
        )

        const page = await context.newPage()
        let signedIn = false

        for (const route of ROUTES) {
          if (route.auth && !signedIn) {
            try {
              await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
              await page.fill('input[name="identifier"]', LOGIN)
              await page.fill('input[name="password"]', PASSWORD)
              await page.click('button[type="submit"]')
              await page.waitForURL(`${BASE}/`, { timeout: 15_000 })
              // Once a session exists the *user record's* locale wins over the stored one
              // (`LocaleReconciler`, design.md §4.3) -- correct product behaviour, and it means a
              // signed-in shot in another language has to be switched the way a user would: two
              // clicks in the locale menu.
              if (locale === 'ru') {
                await page.getByRole('button', { name: 'Interfeys tili' }).click()
                await page.getByRole('menuitemradio', { name: 'Русский' }).click()
                await page.waitForTimeout(400)
              }
              signedIn = true
            } catch (error) {
              failures.push(`sign-in failed (${size.name}/${theme}/${locale}): ${String(error)}`)
              break
            }
          }
          try {
            await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
            // Let the entrance animations settle so a shot is of the screen, not of frame 3.
            await page.waitForTimeout(900)
            const file = join(OUT, `${route.slug}__${size.name}__${theme}__${locale}.png`)
            await page.screenshot({ path: file, fullPage: true })
            console.log(`[shots] ${file}`)
          } catch (error) {
            failures.push(`${route.slug} ${size.name}/${theme}/${locale}: ${String(error)}`)
          }
        }
        await context.close()
      }
    }
  }

  await browser.close()
  if (failures.length > 0) {
    console.error(`[shots] ${failures.length} failed:`)
    for (const f of failures) console.error(`   ${f}`)
    process.exit(1)
  }
  console.log(`[shots] done -> ${OUT}`)
}

await main()
