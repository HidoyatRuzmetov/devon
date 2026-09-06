// AC-7's forced-state coverage (design.md §8, spec.md §12.B): every route in `routes.json`, every one
// of the five forceable kinds, via `?__state=` behind `DEVON_E2E=1` (`global-setup.ts` sets that env
// var on the spawned `apps/web` dev server; `lib/state.ts` builds the URL). Screenshots at
// {1440/light/uz-Latn, 390/light/ru} per spec.md §12.B ("ru at 390 is the worst case for AC-6
// truncation") -- 5 routes x 5 states x 2 configs = 50 shots, named per `agentic/scripts/dod.mjs`.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser } from '@playwright/test'
import { backendReady, expect, test } from '../fixtures.js'
import { loadRoutes } from '../lib/routes.js'
import { FORCEABLE_STATES, withForcedState } from '../lib/state.js'
import { screenshotName } from '../lib/screenshot-naming.js'
import { recordStatesVerified } from '../lib/manifest.js'
import { QA_VISUAL_DIR } from '../lib/env.js'
import { presetLocale } from '../lib/locale.js'
import { recordNetwork } from '../lib/network.js'

const routes = loadRoutes()

const CONFIGS = [
  {
    width: 1440,
    height: 900,
    theme: 'light' as const,
    locale: 'uz-Latn' as const,
    localeShort: 'uz' as const,
  },
  {
    width: 390,
    height: 844,
    theme: 'light' as const,
    locale: 'ru' as const,
    localeShort: 'ru' as const,
  },
]

async function newContext(browser: Browser, config: (typeof CONFIGS)[number]) {
  return browser.newContext({
    viewport: { width: config.width, height: config.height },
    colorScheme: config.theme,
  })
}

test.beforeAll(async () => {
  await mkdir(QA_VISUAL_DIR, { recursive: true })
})

for (const route of routes) {
  for (const state of FORCEABLE_STATES) {
    for (const config of CONFIGS) {
      const title = `${route.path} forced=${state} @ ${config.width} ${config.theme} ${config.locale}`

      test(title, async ({ browser }, testInfo) => {
        test.skip(
          route.chrome === 'app' && !backendReady(),
          "apps/api is not reachable this run -- this route's chrome (AppShell) needs it even for a forced state",
        )

        const context = await newContext(browser, config)
        const page = await context.newPage()
        await presetLocale(page, config.locale)
        const net = recordNetwork(page)

        await page.goto(withForcedState(route.path, state))
        // The forced block's title is always visible once rendered -- no network round trip stands
        // between navigation and it for any of the five kinds (`ForcedStateBlock`).
        await expect(page.locator('h3, [role="status"], [role="alert"]').first()).toBeVisible({
          timeout: 10_000,
        })

        // AC-7: "each state names what happened and offers exactly one next action."
        const primaryCount = await page.locator('[data-primary]').count()
        expect(primaryCount, `${title}: exactly one [data-primary] action`).toBe(1)

        const foreign = net.foreignOrigins(new URL(page.url()).origin)
        expect(foreign, `${title}: same-origin only`).toHaveLength(0)
        net.stop()

        const filename = screenshotName(
          route.slug,
          config.width,
          config.theme,
          config.localeShort,
          state,
        )
        await page.screenshot({ path: join(QA_VISUAL_DIR, filename), fullPage: true })
        testInfo.attachments.push({
          name: filename,
          path: join(QA_VISUAL_DIR, filename),
          contentType: 'image/png',
        })
        await recordStatesVerified()

        await context.close()
      })
    }
  }
}
