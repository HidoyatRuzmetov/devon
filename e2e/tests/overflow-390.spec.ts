// @390 -- design.md §4(i), this item's handoff, verbatim: "390px overflow assertions:
// `el.scrollWidth <= el.clientWidth + 1` on every `[data-shell-label]`; no `document.documentElement`
// horizontal scroll; no computed `text-overflow: ellipsis`." Runs against every route's organic
// render, in both uz-Latn and ru (spec.md: "Russian and Uzbek run 20-35% longer than English" --
// §3.5's anti-truncation contract). Needs no backend: the shell chrome (`AppShell`/`AuthShell`, every
// `data-shell-label`) renders unconditionally regardless of `apps/api` reachability
// (`apps/web/src/shell/app-shell.tsx` only swaps `<main>`'s *content*, never the chrome, on a query
// error) -- so this file runs the same whether or not `global-setup.ts` brought up the backend.
import { expect, test } from '../fixtures.js'
import { loadRoutes } from '../lib/routes.js'
import { presetLocale, type TestLocale } from '../lib/locale.js'

const routes = loadRoutes()
const LOCALES: readonly TestLocale[] = ['uz-Latn', 'ru']

interface ShellLabelMeasurement {
  tag: string
  text: string
  scrollWidth: number
  clientWidth: number
  textOverflow: string
}

for (const route of routes) {
  for (const locale of LOCALES) {
    test(`@390 ${route.path} has no overflow/clipped/ellipsized shell label in ${locale}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await presetLocale(page, locale)
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      // Let the shell's own layout settle (fonts, drawer/topbar flex) before measuring -- a fixed,
      // short wait rather than `networkidle` because a route with a live `/api/v1/me` poll should not
      // make this assertion wait on network activity it does not care about.
      await page.waitForTimeout(300)

      const measurements: ShellLabelMeasurement[] = await page.evaluate(() => {
        const out: ShellLabelMeasurement[] = []
        for (const el of document.querySelectorAll<HTMLElement>('[data-shell-label]')) {
          const style = window.getComputedStyle(el)
          out.push({
            tag: el.tagName,
            text: (el.textContent ?? '').trim().slice(0, 60),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            textOverflow: style.textOverflow,
          })
        }
        return out
      })

      expect(
        measurements.length,
        'at least one [data-shell-label] element on this route',
      ).toBeGreaterThan(0)

      const overflowing = measurements.filter((m) => m.scrollWidth > m.clientWidth + 1)
      expect(
        overflowing,
        `overflowing shell labels: ${overflowing.map((m) => `${m.tag} "${m.text}" (${m.scrollWidth}>${m.clientWidth})`).join('; ')}`,
      ).toHaveLength(0)

      const ellipsized = measurements.filter((m) => m.textOverflow === 'ellipsis')
      expect(
        ellipsized,
        `ellipsized shell labels: ${ellipsized.map((m) => `${m.tag} "${m.text}"`).join('; ')}`,
      ).toHaveLength(0)

      const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const innerWidth = await page.evaluate(() => window.innerWidth)
      expect(docScrollWidth, 'no horizontal scroll on the shell at 390px').toBeLessThanOrEqual(
        innerWidth,
      )

      await context.close()
    })
  }
}
