import { expect, test, type Route } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { waitForLoadedRoute } from './platform-capture.js'
import { SIDEBAR_GROUPS_STORAGE_KEY } from '../../src/lib/constants.js'

const qaExamplePassword = 'Ishonchli#2026'
const destinations = [
  { path: '/work', endpoint: '/api/v1/board', intent: 'focus' },
  { path: '/events', endpoint: '/api/v1/events', intent: 'hover' },
  { path: '/calendar', endpoint: '/api/v1/calendar/agenda?days=30', intent: 'focus' },
] as const

for (const destination of destinations) {
  test(`compiled ${destination.path} ${destination.intent} intent warms the exact route query once`, async ({
    browser,
  }, info) => {
    const context = await newFlowContext(browser)
    const foreign: string[] = []
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== FLOW_WEB_BASE_URL) {
        foreign.push(new URL(route.request().url()).hostname)
        await route.abort('blockedbyclient')
      } else await route.continue()
    })
    try {
      await login(context, { login: 'demo.boshliq', password: qaExamplePassword })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      // An existing expanded navigation preference; the actual link still drives intent/navigation.
      await context.addInitScript(
        (key) => localStorage.setItem(key, '[]'),
        SIDEBAR_GROUPS_STORAGE_KEY,
      )
      const page = await context.newPage()
      const errors: string[] = []
      const receipts: number[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.url() === `${FLOW_WEB_BASE_URL}${destination.endpoint}`)
          receipts.push(response.status())
      })
      await page.goto('/account')
      await waitForLoadedRoute(page, '/account')
      expect(receipts).toEqual([])
      const link = page.locator(`aside a[href="${destination.path}"]`)
      await expect(link).toBeVisible()
      const prefetched = page.waitForResponse(`${FLOW_WEB_BASE_URL}${destination.endpoint}`)
      if (destination.intent === 'focus') await link.focus()
      else await link.hover()
      const response = await prefetched
      expect(response.status()).toBe(200)
      expect(await response.json()).toBeTruthy()
      await link.press('Enter')
      await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}${destination.path}`)
      await waitForLoadedRoute(page, destination.path)
      expect(receipts).toEqual([200])
      expect(foreign).toEqual([])
      expect(errors).toEqual([])
      await info.attach('actual-prefetch-receipt', {
        body: JSON.stringify({ ...destination, receipts }, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await context.close()
    }
  })
}

test('an unavailable compiled calendar prefetch remains quiet and its real route recovers after reload', async ({
  browser,
}, info) => {
  const root = resolve(import.meta.dirname, '../../../..')
  const chunks = readdirSync(resolve(root, 'apps/web/dist/assets')).filter((name) => {
    if (!name.endsWith('.js') || name.startsWith('rolldown-runtime-')) return false
    const map = JSON.parse(
      readFileSync(resolve(root, 'apps/web/dist-sourcemaps', name + '.map'), 'utf8'),
    ) as { sources: string[] }
    return map.sources.some((source) => source.endsWith('/features/calendar/hooks.ts'))
  })
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).not.toMatch(/^index-/)
  const context = await newFlowContext(browser)
  const errors: string[] = []
  const foreign: string[] = []
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== FLOW_WEB_BASE_URL) {
      foreign.push(new URL(route.request().url()).hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  try {
    await login(context, { login: 'demo.boshliq', password: qaExamplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    await context.addInitScript(
      (key) => localStorage.setItem(key, '[]'),
      SIDEBAR_GROUPS_STORAGE_KEY,
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/account')
    await waitForLoadedRoute(page, '/account')
    const target = `${FLOW_WEB_BASE_URL}/assets/${chunks[0]}`
    const abort = async (route: Route) => {
      await route.abort('failed')
    }
    await context.route(target, abort)
    const rejected = page.waitForEvent('requestfailed', {
      predicate: (request) => request.url() === target,
    })
    await page.locator('aside a[href="/calendar"]').focus()
    await rejected
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/account`)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await waitForLoadedRoute(page, '/account')
    expect(errors).toEqual([])
    await page.screenshot({ path: info.outputPath('failed-calendar-intent.png'), fullPage: true })
    await context.unroute(target, abort)
    // Reload ends the browser's failed-ESM cache; application data/auth responses are untouched.
    await page.reload()
    await waitForLoadedRoute(page, '/account')
    const receipt = page.waitForResponse(`${FLOW_WEB_BASE_URL}/api/v1/calendar/agenda?days=30`)
    const calendar = page.locator('aside a[href="/calendar"]')
    await calendar.focus()
    expect((await receipt).status()).toBe(200)
    await calendar.press('Enter')
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/calendar`)
    await waitForLoadedRoute(page, '/calendar')
    expect(errors).toEqual([])
    expect(foreign).toEqual([])
  } finally {
    await context.close()
  }
})
