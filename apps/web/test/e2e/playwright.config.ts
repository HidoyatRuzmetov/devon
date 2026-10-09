import { defineConfig, devices } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FLOW_API_PORT, FLOW_WEB_BASE_URL, FLOW_WEB_PORT } from './flow-env.js'
import { flowTestIgnore, flowWebCommand, type ProductionBuildReceipt } from './flow-production.js'

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
const production = process.env['FLOW_PRODUCTION_BUILD'] === '1'
let receipt: ProductionBuildReceipt | undefined
let currentInputs: string | undefined
if (production) {
  const root = resolve(import.meta.dirname, '../../../..')
  receipt = JSON.parse(
    readFileSync(resolve(root, 'tools/perf/lighthouse/out/production-build.json'), 'utf8'),
  ) as ProductionBuildReceipt
  // Use the release builder's actual source manifest rather than a second approximation. This
  // child executes a fixed local module without a shell and emits only the public source hash.
  const hash = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { productionBuildInputs } from ${JSON.stringify(pathToFileURL(resolve(root, 'tools/perf/web-build.mjs')).href)}; process.stdout.write(productionBuildInputs(${JSON.stringify(root)}).sha256)`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 },
  )
  if (hash.error || hash.status !== 0)
    throw new Error('Could not verify current production browser inputs')
  currentInputs = hash.stdout.trim()
}
const webCommand = flowWebCommand(production, receipt, currentInputs)

export default defineConfig({
  testDir: '.',
  // Dedicated *.qa.spec.ts suites have their own seeded database/broker and serial fixture
  // contracts. Keep the ordinary CI flows and smoke tests on this fresh, unseeded stack; their
  // explicit QA configs still select and run every dedicated case independently.
  testMatch: ['**/*.flow.spec.ts', '**/*.smoke.spec.ts'],
  // Vite-only TSX component fixtures run in the full default dev gate, never through preview.
  testIgnore: flowTestIgnore(production),
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
  // Ordinary CI uses dev; explicit built verification uses the current stable production artifact.
  // Both proxy to the owned local API started by globalSetup at FLOW_API_PORT.
  webServer: {
    command: webCommand,
    url: FLOW_WEB_BASE_URL,
    // A loopback URL alone does not identify our fixture server; an existing developer proxy
    // could point elsewhere. Refuse a port collision instead of attaching destructive tests.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      WEB_PORT: String(FLOW_WEB_PORT),
      API_PORT: String(FLOW_API_PORT),
      ...(production ? { DEVON_E2E: '0' } : {}),
    },
  },
})
