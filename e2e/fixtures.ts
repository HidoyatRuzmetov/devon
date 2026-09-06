// Shared Playwright fixtures for every spec in `tests/`. `backendReady`/`storybookReady` read the
// flags `global-setup.ts` writes to `process.env` -- every spec that needs a live `apps/api` or
// Storybook reads one of these and calls `test.skip(...)` with a specific reason instead of failing,
// so a clone that has not yet built EPIC-000's other work items (`@devon/db migrate:apply`, the demo
// seed, Storybook) still gets an honest, green run of everything this item can actually prove today.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, type Page } from '@playwright/test'
import { TMP_DIR } from './lib/env.js'
import { presetLocale } from './lib/locale.js'

export const backendReady = (): boolean => process.env['E2E_BACKEND_READY'] === '1'
export const storybookReady = (): boolean => process.env['E2E_STORYBOOK_READY'] === '1'

const SUPERADMIN_STATE_PATH = join(TMP_DIR, 'superadmin-storage-state.json')
export const superAdminSessionAvailable = (): boolean => existsSync(SUPERADMIN_STATE_PATH)

interface Fixtures {
  /** A page whose browser context was created with the `super_admin` session `global-setup.ts`
   * produced (`lib/backend.ts`). Skips the test with a clear reason when no such session exists. */
  superAdminPage: Page
}

export const test = base.extend<Fixtures>({
  // Deterministic default locale regardless of the runner's own OS/browser locale: without this,
  // `apps/web`'s resolution order (design.md §4.3: user record -> localStorage -> Accept-Language ->
  // `uz-Latn`) falls through to whatever the test machine's system locale is (e.g. `en` on a
  // US-configured CI runner), silently rendering the whole app in English instead of the shipped
  // default. A spec that wants a *different* locale calls `presetLocale(page, ...)` again itself,
  // which simply overwrites the same localStorage key applied here.
  page: async ({ page }, use) => {
    await presetLocale(page, 'uz-Latn')
    await use(page)
  },
  superAdminPage: async ({ browser }, use, testInfo) => {
    if (!superAdminSessionAvailable()) {
      testInfo.skip(
        true,
        'no super_admin session available (apps/api and/or @devon/db migrate:apply are not up yet -- ' +
          'see global-setup.ts log lines above)',
      )
    }
    const context = await browser.newContext({ storageState: SUPERADMIN_STATE_PATH })
    const page = await context.newPage()
    await use(page)
    await context.close()
  },
})

export { expect } from '@playwright/test'
