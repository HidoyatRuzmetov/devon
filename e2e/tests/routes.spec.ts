// Organic (non-forced) rendering for every route in `routes.json` (this item's handoff: "makes the
// existing e2e/a11y gate commands pass" -- the axe/heading/no-crash assertions this file makes are
// the non-visual half of that; `states.spec.ts` covers the five forced kinds and the screenshots).
import { backendReady, expect, test } from '../fixtures.js'
import { loadRoutes } from '../lib/routes.js'
import { message } from '../lib/messages.js'
import { scanForBlockingViolations, formatViolations } from '../lib/axe.js'
import { recordNetwork } from '../lib/network.js'

const routes = loadRoutes()

for (const route of routes) {
  test.describe(`route ${route.path}`, () => {
    // `chrome: 'app'` routes always issue GET /api/v1/me + /api/v1/instance for the shell chrome
    // (AppShell) even when the route's own content does not need them -- without apps/api up, the
    // shell replaces the page with its own generic error state (design.md §6.1's AppShell, not a bug
    // in this route), which is a real, honest thing to test in `states.spec.ts`'s offline/error
    // coverage but not what "organic render" means here.
    test.skip(
      route.chrome === 'app' && !backendReady(),
      "apps/api is not reachable this run (see global-setup.ts log) -- this route's chrome needs it",
    )
    // `/admin` additionally needs a super_admin session to reach its real content at all; anyone else
    // (including an anonymous visitor, once apps/api redirects them) sees the no-permission state,
    // which is exactly what `states.spec.ts`'s forced "forbidden" coverage already asserts for every
    // route uniformly -- this file's job is the *organic*, reachable-today happy path per route.
    test.skip(
      route.auth === 'super_admin' && !backendReady(),
      'apps/api is not reachable this run -- cannot obtain a super_admin session',
    )

    test(`renders its designed content (heading "${route.heading ?? '(none)'}")`, async ({
      page,
    }) => {
      await page.goto(route.path)
      if (route.heading) {
        await expect(page.getByText(message('uz-Latn', route.heading))).toBeVisible({
          timeout: 15_000,
        })
      }
      // I-10 / AC-7 / `packages/ui/src/states/state-view.tsx`'s own contract: at most one primary
      // action once the route has settled -- a bare form (`/login`) legitimately has zero (the submit
      // button carries no `data-primary`; it is not a `StateView` action), a `StateView` screen has
      // exactly one, and nothing in this epic should ever render two.
      const primaryCount = await page.locator('[data-primary]').count()
      expect(
        primaryCount,
        'at most one [data-primary] element once the route has settled',
      ).toBeLessThanOrEqual(1)
    })

    test('has zero serious/critical axe violations', async ({ page }) => {
      await page.goto(route.path)
      if (route.heading) {
        await expect(page.getByText(message('uz-Latn', route.heading))).toBeVisible({
          timeout: 15_000,
        })
      }
      const { blocking, all } = await scanForBlockingViolations(page)
      expect(blocking, formatViolations(all)).toHaveLength(0)
    })

    test('issues only same-origin network requests', async ({ page }) => {
      const net = recordNetwork(page)
      await page.goto(route.path)
      // Not `waitForLoadState('networkidle')`: Vite's dev server keeps an HMR WebSocket open for the
      // life of the page (and `chrome: 'app'` routes poll `/api/v1/me`), so "idle" never arrives.
      if (route.heading) {
        await expect(page.getByText(message('uz-Latn', route.heading))).toBeVisible({
          timeout: 15_000,
        })
      } else {
        await page.waitForLoadState('domcontentloaded')
      }
      await page.waitForTimeout(500)
      const foreign = net.foreignOrigins(new URL(page.url()).origin)
      net.stop()
      expect(foreign, `foreign origins: ${foreign.join(', ')}`).toHaveLength(0)
    })
  })
}
