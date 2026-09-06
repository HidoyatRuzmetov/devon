// Root Playwright config for EPIC-000.9's `e2e/**` suite (routes.json-driven axe/screenshot/state-
// forcing/overflow/glyph/same-origin tests). Distinct from `apps/web/test/e2e/playwright.config.ts`
// (EPIC-000.7's own minimum smoke spec, outside this item's TOUCHES) -- see that file's header comment
// for why the two currently run as separate commands rather than one (`agentic/gates.json`'s
// `e2e-smoke`/`e2e`/`a11y` gates are pinned to `pnpm --filter @devon/web test:e2e[...]`, and wiring
// this suite into that command would mean editing `apps/web/package.json`, which is outside this
// item's TOUCHES; flagged in this item's NOTES for `wp-lead` rather than worked around here).
//
// Run with: `npm test` from this directory (`e2e/package.json` -- see that file's description for why
// this directory manages its own `node_modules` instead of joining the pnpm workspace), or
// `npx playwright test --config e2e/playwright.config.ts` from the repo root once `npm install` has
// been run once inside `e2e/`.
//
// A single project, not one-per-viewport: the baseline/locale-sweep/forced-state screenshot specs and
// the 390px overflow/glyph specs each open their *own* browser contexts at the exact widths, colour
// schemes and locales spec.md §12 lists (see `tests/screenshots.spec.ts`, `tests/overflow-390.spec.ts`)
// -- multiplying every test in this suite by a `projects` matrix would run axe/same-origin/smoke
// checks at every width for no reason.
import { defineConfig } from '@playwright/test'
import { CI, WEB_BASE_URL } from './lib/env.js'

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // A single shared `apps/web` dev server (+ `apps/api`) backs every worker -- Playwright's own
  // per-CPU-core default worker count (observed: 16 on a 16-thread dev machine) opens that many
  // concurrent Chromium contexts against one Vite dev server at once and reliably produces
  // `net::ERR_CONNECTION_RESET` / stalled navigations under contention (verified while building this
  // suite: identical spec file, 0 flakes at `--workers=2`, several at the unpinned default). 4 is
  // conservative enough to stay reliable against a dev-mode server without serialising the whole run.
  workers: 4,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'off', // specs that need a screenshot take one explicitly, named per dod.mjs
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
