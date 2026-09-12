import { defineConfig, devices } from '@playwright/test'
import { FLOW_API_PORT, FLOW_WEB_BASE_URL, FLOW_WEB_PORT } from './flow-env.js'

// `pnpm --filter @devon/web test:e2e -- --grep @smoke` is `agentic/gates.json`'s `e2e-smoke` command
// (used as every item's `item`-profile gate, per this item's handoff to EPIC-000.9). The full
// `routes.json`-driven suite (screenshot manifest, axe, 390px overflow/glyph assertions) is
// EPIC-000.9's TOUCHES (`e2e/**`); this file and `shell.smoke.spec.ts` are this item's own minimum
// so that command is never a vacuous no-op (AC-14) between the two items landing.
//
// H30.1's `@flow` suite (`*.flow.spec.ts`, `global-setup.ts`) needs a *real*, dedicated `apps/api`
// behind this same web dev server -- `FLOW_WEB_PORT`/`FLOW_API_PORT` (`flow-env.ts`) are fixed,
// suite-owned ports distinct from the plain `WEB_PORT`/`API_PORT` defaults precisely so this never
// attaches to some other already-running `pnpm start` on 3000/5173 (see that file's own header).
// `@smoke` needs no API at all (`shell.smoke.spec.ts`'s header) so it is unaffected by which API ends
// up behind the proxy; running the whole file under one shared web+api pair keeps `test:e2e` a single
// gate command rather than two.
const port = FLOW_WEB_PORT

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // `@flow` specs are real, multi-request round trips against one shared dev-mode `apps/api` process
  // (`global-setup.ts`) -- the same contention `e2e/playwright.config.ts` already documents for its
  // own suite (unpinned default worker count == CPU cores reliably starved one dev server, observed
  // there as `net::ERR_CONNECTION_RESET`; here as this file's own specs occasionally missing their
  // `timeout` waiting on a button that was simply slow to hydrate under load). 4 keeps `test:e2e`
  // reliable without serialising the whole run.
  workers: 4,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // `@devon/i18n`'s resolution order is user record -> stored/cookie -> `Accept-Language` -> the
    // `uz-Latn` default (`packages/i18n/src/locale.ts`) -- deliberately: a real visitor's browser
    // language should win over a hardcoded default. Playwright's own Chromium reports `en-US` unless
    // told otherwise, which made a signed-out spec asserting the *default* screen ("Tizimga kirish")
    // see the `Accept-Language`-resolved English one instead ("Sign in") -- not a product bug, a test
    // environment that didn't match the ministry's actual visitors. `uz-UZ` here is what a real
    // Uzbekistan-based browser with no stored preference reports.
    locale: 'uz-UZ',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The dev server (not `build && preview`) so a real `/api/*` proxy target is available -- `@flow`
  // specs need `apps/api` running (`global-setup.ts` brings that up, on `FLOW_API_PORT`); `API_PORT`
  // here is what `src/vite.config.ts`'s proxy reads to pick the same target.
  webServer: {
    command: 'pnpm --filter @devon/web dev',
    url: FLOW_WEB_BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
    env: { ...process.env, WEB_PORT: String(FLOW_WEB_PORT), API_PORT: String(FLOW_API_PORT) },
  },
})
