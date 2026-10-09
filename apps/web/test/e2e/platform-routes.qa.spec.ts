/* eslint-disable no-restricted-syntax -- Route, viewport and capture transitions share one browser page and must run sequentially. */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { authedPatch, login, newFlowContext, loginAsSuperAdmin } from './flow-api.js'
import { FLOW_DB_NAME } from './flow-env.js'
import { assertLocalTestUrl } from './flow-safety.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

const root = join(import.meta.dirname, '../../../..')
const phase = process.env['QA_CAPTURE_PHASE'] ?? 'baseline'
if (!/^[a-z][a-z0-9-]{0,63}$/.test(phase)) {
  throw new Error('QA_CAPTURE_PHASE must be a short lowercase name without path separators')
}
const artifactDir = join(root, 'artifacts/qa/2026-10/platform', phase)
const inventory = JSON.parse(
  readFileSync(join(root, 'docs/qa/2026-10/inventory.json'), 'utf8'),
) as { routes: { path: string; auth: string }[] }
const knownRedirects: Record<string, string> = {
  '/inbox/preferences': '/account/notifications',
  '/inbox/telegram': '/account/telegram',
}

async function census(page: Page) {
  return page
    .locator(
      'main button, main a, main input, main textarea, main select, main [role], header button, nav button',
    )
    .evaluateAll((elements) =>
      elements
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        .map((e) => ({
          tag: e.tagName,
          role: e.getAttribute('role'),
          name:
            e.getAttribute('aria-label') ||
            e.textContent?.trim().slice(0, 160) ||
            e.getAttribute('placeholder'),
          disabled: e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true',
          selected: e.getAttribute('aria-selected'),
          checked: e.getAttribute('aria-checked'),
          bounds: (() => {
            const r = e.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })(),
        })),
    )
}

for (const role of ['head', 'member', 'super_admin', 'public'] as const) {
  test(`full inventory route baseline: ${role}`, async ({ browser }, info) => {
    test.setTimeout(600_000)
    expect(FLOW_DB_NAME).toMatch(/^devon_(?:flow_e2e|qa)/)
    mkdirSync(artifactDir, { recursive: true })
    const context = await newFlowContext(browser)
    const blockedExternal: string[] = []
    await context.route('**/*', async (route) => {
      try {
        assertLocalTestUrl(route.request().url())
        await route.continue()
      } catch {
        blockedExternal.push(new URL(route.request().url()).hostname)
        await route.abort('blockedbyclient')
      }
    })
    try {
      if (role === 'head' || role === 'member') {
        await login(context, {
          login: role === 'head' ? 'demo.boshliq' : 'demo.xodim',
          password: qaExampleCredential1,
        })
        expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      } else if (role === 'super_admin') await loginAsSuperAdmin(context)
      const page = await context.newPage()
      const authProbes: { url: string; status: number }[] = []
      page.on('response', (response) => {
        if (response.status() === 401) authProbes.push({ url: response.url(), status: 401 })
      })
      const browserErrors: {
        kind: string
        message: string
        url?: string
        route: string
        at: string
      }[] = []
      const recordError = (kind: string, message: string, url?: string) => {
        browserErrors.push({
          kind,
          message,
          ...(url ? { url } : {}),
          route: page.url(),
          at: new Date().toISOString(),
        })
      }
      page.on('pageerror', (error) => recordError('pageerror', error.message))
      page.on('console', (message) => {
        if (message.type() === 'error')
          recordError('console', message.text(), message.location().url)
      })
      await page.exposeFunction('__devonRecordBrowserError', (message: string) =>
        recordError('window.error', message),
      )
      await page.addInitScript(() => {
        // ResizeObserver errors can reach window.error without emitting Playwright pageerror.
        window.addEventListener('error', (event) => {
          const scope = window as unknown as Window & {
            __devonRecordBrowserError: (message: string) => Promise<void>
          }
          void scope.__devonRecordBrowserError(event.message)
        })
      })
      const unexplainedErrorsSince = (start: number) =>
        browserErrors.slice(start).filter((error) => {
          // /me deliberately models an anonymous session as401. Keep that response and its exact
          // browser console diagnostic in the evidence; no other failed resource is exempted.
          const anonymousProbe =
            role === 'public' &&
            error.kind === 'console' &&
            error.message ===
              'Failed to load resource: the server responded with a status of 401 (Unauthorized)' &&
            error.url &&
            new URL(error.url).pathname === '/api/v1/me' &&
            authProbes.some((probe) => probe.url === error.url)
          return !anonymousProbe
        })
      let paths = inventory.routes
        .filter((r) =>
          role === 'public'
            ? r.auth === 'public'
            : role === 'super_admin'
              ? r.auth === 'super_admin'
              : r.auth === 'session',
        )
        .map((r) => r.path)
      // Details need real IDs; rendering a missing-ID error is never counted as feature coverage.
      const actualDetails: Record<string, string> = {}
      if (role === 'head' || role === 'member') {
        const projects = (await (await context.request.get('/api/v1/projects')).json()) as {
          id: string
        }[]
        const cardsResponse = await context.request.get('/api/v1/cards')
        const cardPayload = (await cardsResponse.json()) as
          | { items?: { id: string }[]; cards?: { id: string }[] }
          | { id: string }[]
        const cards = Array.isArray(cardPayload)
          ? cardPayload
          : (cardPayload.items ?? cardPayload.cards ?? [])
        expect(projects.length, 'populated project fixture').toBeGreaterThan(0)
        expect(cards.length, 'populated card fixture').toBeGreaterThan(0)
        actualDetails['/projects/view'] = `/projects/view?id=${projects[0]!.id}`
        actualDetails['/work/card'] = `/work/card?id=${cards[0]!.id}`
        const me = (await (await context.request.get('/api/v1/me')).json()) as {
          activeDepartmentId?: string
          memberships: { departmentId: string }[]
        }
        const departmentId = me.activeDepartmentId ?? me.memberships[0]?.departmentId
        expect(departmentId).toBeTruthy()
        actualDetails['/department'] = `/department?id=${departmentId}`
      }
      if (process.env['QA_ROUTE_LIMIT'])
        paths = paths.slice(0, Number(process.env['QA_ROUTE_LIMIT']))
      const requested = process.env['QA_ROUTE_INCLUDE']?.split(',')
      if (requested) {
        for (const path of requested) {
          expect(
            inventory.routes.some((route) => route.path === path),
            'requested route exists',
          ).toBe(true)
        }
        paths = paths.filter((path) => requested.includes(path))
      }
      for (const path of paths) {
        await test.step(path, async () => {
          const errorStart = browserErrors.length
          const probeStart = authProbes.length
          await page.setViewportSize({ width: 1440, height: 900 })
          await page.goto(actualDetails[path] ?? path)
          await waitForLoadedRoute(page, path)
          await settleCapture(page)
          const slug = path.replace(/[^a-z0-9]+/gi, '-') || 'home'
          const stem = `${info.project.name}-${role}-${slug}`
          const screenshot = join(artifactDir, `${stem}-1440-en.png`)
          await page.screenshot({ path: screenshot, fullPage: true })
          await page.screenshot({ path: join(artifactDir, `${stem}-1440-en-viewport.png`) })
          const result = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze()
          const locale = await page.locator('html').getAttribute('lang')
          const observations = {
            route: path,
            resolved: page.url(),
            role,
            browser: info.project.name,
            locale,
            theme: 'default preference',
            width: 1440,
            screenshot,
            pixelInspection: 'pending',
            controls: await census(page),
            renderedHeadings: await page.locator('main h1, main h2, main h3').allTextContents(),
            violations: result.violations,
            browserErrors: browserErrors.slice(errorStart),
            authProbes: authProbes.slice(probeStart),
            unexplainedErrors: unexplainedErrorsSince(errorStart),
          }
          appendFileSync(
            join(artifactDir, 'observations.jsonl'),
            JSON.stringify(observations) + '\n',
          )
          expect
            .soft(new URL(page.url()).pathname, `real route ${path}`)
            .toBe(knownRedirects[path] ?? path)
          expect
            .soft(
              observations.violations.map((violation) => ({
                id: violation.id,
                nodes: violation.nodes.map((node) => node.target),
              })),
              `${path}: all WCAG A/AA axe violations`,
            )
            .toEqual([])
          expect
            .soft(observations.unexplainedErrors, `${path}: unexplained browser errors`)
            .toEqual([])
          for (const width of [768, 390, 320]) {
            await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
            await settleCapture(page)
            await page.screenshot({
              path: join(artifactDir, `${stem}-${width}.png`),
              fullPage: true,
            })
            const overflow = await page.evaluate(() => ({
              width: window.innerWidth,
              scroll: document.documentElement.scrollWidth,
            }))
            const narrowAxe = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
              .analyze()
            appendFileSync(
              join(artifactDir, 'observations.jsonl'),
              JSON.stringify({
                route: path,
                role,
                browser: info.project.name,
                locale,
                width,
                screenshot: join(artifactDir, `${stem}-${width}.png`),
                pixelInspection: 'pending',
                overflow,
                violations: narrowAxe.violations,
                browserErrors: browserErrors.slice(errorStart),
                authProbes: authProbes.slice(probeStart),
                unexplainedErrors: unexplainedErrorsSince(errorStart),
              }) + '\n',
            )
            expect
              .soft(overflow.scroll, `${path}: document overflow at ${width}`)
              .toBeLessThanOrEqual(width + 1)
            expect
              .soft(
                narrowAxe.violations.map((violation) => ({
                  id: violation.id,
                  nodes: violation.nodes.map((node) => node.target),
                })),
                `${path}: all WCAG A/AA axe at ${width}`,
              )
              .toEqual([])
            expect
              .soft(
                unexplainedErrorsSince(errorStart),
                `${path}: unexplained browser errors at ${width}`,
              )
              .toEqual([])
          }
        })
      }
      expect(blockedExternal, 'ordinary flows must not attempt external service calls').toEqual([])
    } finally {
      await context.close()
    }
  })
}
