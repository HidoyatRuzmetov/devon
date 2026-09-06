import { defineConfig, devices } from '@playwright/test'

// `pnpm --filter @devon/web test:e2e -- --grep @smoke` is `agentic/gates.json`'s `e2e-smoke` command
// (used as every item's `item`-profile gate, per this item's handoff to EPIC-000.9). The full
// `routes.json`-driven suite (screenshot manifest, axe, 390px overflow/glyph assertions) is
// EPIC-000.9's TOUCHES (`e2e/**`); this file and `shell.smoke.spec.ts` are this item's own minimum
// so that command is never a vacuous no-op (AC-14) between the two items landing.
const port = Number(process.env['WEB_PORT'] ?? 5173)

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
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
  // The dev server (not `build && preview`) so a real `/api/*` proxy target is available -- most
  // specs need `apps/api` running too (`src/vite.config.ts`'s proxy); orchestrating that second
  // process is EPIC-000.9's TOUCHES (`e2e/**`), not this file's.
  webServer: {
    command: 'pnpm --filter @devon/web dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
})
