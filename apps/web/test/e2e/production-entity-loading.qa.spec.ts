import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Route } from '@playwright/test'
import { problem } from '@devon/contracts'
import {
  applySetCookies,
  authedPatch,
  authedPost,
  login,
  loginAsSuperAdmin,
  newFlowContext,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { localSetCookieHeader } from './flow-cookie-options.js'
import { waitForLoadedRoute } from './platform-capture.js'

const qaExamplePassword = 'Ishonchli#2026'
const root = resolve(import.meta.dirname, '../../../..')
const sourceAsset = (suffix: string) => {
  const matches = readdirSync(resolve(root, 'apps/web/dist/assets')).filter((name) => {
    if (!name.endsWith('.js') || name.startsWith('rolldown-runtime-')) return false
    const map = JSON.parse(
      readFileSync(resolve(root, 'apps/web/dist-sourcemaps', name + '.map'), 'utf8'),
    ) as { sources: string[] }
    return map.sources.some((source) => source.endsWith(suffix))
  })
  expect(matches).toHaveLength(1)
  expect(matches[0]).not.toMatch(/^index-/)
  return `${FLOW_WEB_BASE_URL}/assets/${matches[0]}`
}

async function actor(browser: Browser, admin = false) {
  const context = await newFlowContext(browser)
  const foreign: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      foreign.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  if (admin) await loginAsSuperAdmin(context)
  else await login(context, { login: 'demo.boshliq', password: qaExamplePassword })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return { context, page, foreign, errors }
}

test('compiled Search keeps native focus and fetches all five real entity sources only when opened', async ({
  browser,
}, info) => {
  const { context, page, foreign, errors } = await actor(browser)
  try {
    const me = await (await context.request.get('/api/v1/me')).json()
    const departmentId = me.activeDepartmentId ?? me.memberships[0].departmentId
    const paths = [
      `/api/v1/departments/${departmentId}/roster`,
      '/api/v1/cards?limit=8',
      '/api/v1/events',
      '/api/v1/pages',
      '/api/v1/projects',
    ]
    const receipts: { path: string; status: number }[] = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      const path = url.pathname + url.search
      if (paths.includes(path)) receipts.push({ path, status: response.status() })
    })
    await page.goto('/account')
    await waitForLoadedRoute(page, '/account')
    expect(receipts).toEqual([])
    const search = page.getByRole('banner').getByRole('button', { name: 'Search or action' })
    await search.focus()
    const responses = paths.map((path) => page.waitForResponse(`${FLOW_WEB_BASE_URL}${path}`))
    await search.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Search and actions', exact: true })
    await expect(dialog.getByRole('combobox')).toBeFocused()
    const real = await Promise.all(responses)
    expect(real.map((response) => response.status())).toEqual([200, 200, 200, 200, 200])
    const [members, cards, events, pages, projects] = await Promise.all(
      real.map((response) => response.json()),
    )
    const sources = [
      { group: 'People', label: `${members[0].familyName} ${members[0].givenName}` },
      { group: 'Cards', label: cards.items[0].title },
      { group: 'Events', label: events.items[0].title },
      { group: 'Pages', label: pages[0].title },
      { group: 'Projects', label: projects[0].title },
    ]
    await Promise.all(
      sources.map(({ group, label }) =>
        expect(
          dialog.getByRole('group', { name: group, exact: true }).getByText(label, { exact: true }),
        ).toBeVisible(),
      ),
    )
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(search).toBeFocused()
    await search.press('Enter')
    await expect(dialog.getByRole('group', { name: 'Cards', exact: true })).toBeVisible()
    expect(receipts).toHaveLength(5)
    await dialog
      .getByRole('group', { name: 'Cards', exact: true })
      .getByRole('option')
      .filter({
        has: page.getByText(cards.items[0].title, { exact: true }),
      })
      .click()
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/work/card?id=${cards.items[0].id}`)
    await waitForLoadedRoute(page, '/work/card')
    expect(foreign).toEqual([])
    expect(errors).toEqual([])
    await info.attach('real-entity-receipts', {
      body: JSON.stringify({ receipts, sources }, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})

test('a failed compiled Projects client preserves Search close/focus and reload permits actual recovery', async ({
  browser,
}, info) => {
  const { context, page, foreign, errors } = await actor(browser)
  const asset = sourceAsset('/features/projects/api.ts')
  try {
    await page.goto('/account')
    await waitForLoadedRoute(page, '/account')
    const abort = (route: Route) => route.abort('failed')
    await context.route(asset, abort)
    const failed = page.waitForEvent('requestfailed', {
      predicate: (request) => request.url() === asset,
    })
    const search = page.getByRole('banner').getByRole('button', { name: 'Search or action' })
    await search.focus()
    await search.press('Enter')
    await failed
    const dialog = page.getByRole('dialog', { name: 'Search and actions', exact: true })
    await expect(dialog.getByRole('group', { name: 'Cards', exact: true })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Projects', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('failed-project-client.png'), fullPage: true })
    await dialog.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(search).toBeFocused()
    await context.unroute(asset, abort)
    await page.reload()
    await waitForLoadedRoute(page, '/account')
    const restored = page.waitForResponse(`${FLOW_WEB_BASE_URL}/api/v1/projects`)
    await search.click()
    const actual = await restored
    expect(actual.status()).toBe(200)
    const rows = await actual.json()
    await expect(
      dialog
        .getByRole('group', { name: 'Projects', exact: true })
        .getByText(rows[0].title, { exact: true }),
    ).toBeVisible()
    expect(foreign).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

async function adaptExitCookie(context: BrowserContext) {
  if (context.browser()?.browserType().name() !== 'webkit') return
  const origin = new URL(FLOW_WEB_BASE_URL)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
    throw new Error('View-as cookie adaptation requires owned HTTP loopback')
  const target = `${FLOW_WEB_BASE_URL}/api/v1/admin/view-as/stop`
  await context.route(target, async (route) => {
    if (route.request().url() !== target || route.request().method() !== 'POST')
      throw new Error('Unexpected view-as cookie transport')
    const actual = await route.fetch({ maxRedirects: 0 })
    if (!actual.ok()) return route.fulfill({ response: actual })
    await applySetCookies(context, actual)
    const headers = actual.headers()
    const cookie = headers['set-cookie']
    await route.fulfill({
      response: actual,
      headers: { ...headers, ...(cookie ? { 'set-cookie': localSetCookieHeader(cookie) } : {}) },
    })
  })
}

test('compiled Exit view-as preserves refusal then pointer retry and independently clears the real lens', async ({
  browser,
}, info) => {
  const head = await actor(browser)
  const admin = await actor(browser, true)
  try {
    const headMe = await (await head.context.request.get('/api/v1/me')).json()
    const departmentId = headMe.activeDepartmentId ?? headMe.memberships[0].departmentId
    const started = await authedPost(
      admin.context,
      `/api/v1/admin/departments/${departmentId}/view-as`,
      {},
    )
    expect(started.status()).toBe(204)
    await applySetCookies(admin.context, started)
    expect((await admin.context.request.get('/api/v1/admin/instance')).status()).toBe(403)
    await adaptExitCookie(admin.context)
    const { page } = admin
    await page.goto('/')
    await waitForLoadedRoute(page, '/')
    const exit = page.getByRole('button', { name: 'Exit view-as', exact: true })
    await expect(exit).toBeVisible()
    const target = `${FLOW_WEB_BASE_URL}/api/v1/admin/view-as/stop`
    await page.route(target, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify(problem('internal')),
      }),
    )
    const refused = page.waitForResponse(target)
    await exit.click()
    expect((await refused).status()).toBe(503)
    await expect(
      page.getByText('The change could not be saved. Try again.', { exact: true }),
    ).toBeVisible()
    await expect(exit).toBeVisible()
    expect((await admin.context.request.get('/api/v1/me')).status()).toBe(200)
    expect((await (await admin.context.request.get('/api/v1/me')).json()).activeDepartmentId).toBe(
      departmentId,
    )
    await page.screenshot({ path: info.outputPath('exit-refused.png'), fullPage: true })
    await page.unroute(target)
    const stopped = page.waitForResponse(target)
    await exit.click()
    expect((await stopped).status()).toBe(204)
    await expect(exit).toHaveCount(0)
    const finalMe = await admin.context.request.get('/api/v1/me')
    expect(finalMe.status()).toBe(200)
    expect((await finalMe.json()).activeDepartmentId).toBeNull()
    expect((await admin.context.request.get('/api/v1/admin/instance')).status()).toBe(200)
    await page.reload()
    await waitForLoadedRoute(page, '/')
    await expect(exit).toHaveCount(0)
    expect(admin.foreign).toEqual([])
    expect(admin.errors).toEqual([])
  } finally {
    await Promise.all([head.context.close(), admin.context.close()])
  }
})
