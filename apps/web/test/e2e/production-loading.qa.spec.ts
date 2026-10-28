import { expect, test, type Browser } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

const qaExamplePassword = 'Ishonchli#2026'
const root = resolve(import.meta.dirname, '../../../..')
const builtAssets = readdirSync(resolve(root, 'apps/web/dist/assets'))
  .filter((name) => name.endsWith('.js'))
  .filter((name) => !name.startsWith('rolldown-runtime-'))
  .map((name) => {
    const map = resolve(root, 'apps/web/dist-sourcemaps', name + '.map')
    const sources: string[] = JSON.parse(readFileSync(map, 'utf8')).sources
    return { name, sources }
  })
const checkinAssets = builtAssets
  .filter(({ sources }) =>
    sources.some((source) => /\/features\/analytics\/checkin-screen/.test(source)),
  )
  .map(({ name }) => name)
const unrelatedHeavyHomeAssets = builtAssets
  .filter(({ sources }) =>
    sources.some((source) =>
      /react-day-picker|\/recharts(?:@|\/)|\/features\/calendar\/calendar-screen|\/features\/personal\/canvas(?:-editor|-view)?\.|\/features\/pages\/graph|@xyflow/.test(
        source,
      ),
    ),
  )
  .map(({ name }) => name)
if (checkinAssets.length === 0)
  throw new Error('A real built check-in asset must exist for this proof')

async function actor(browser: Browser, username: 'demo.boshliq' | 'demo.xodim') {
  const context = await newFlowContext(browser)
  const foreignRequests: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      foreignRequests.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await login(context, { login: username, password: qaExamplePassword })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  const pageErrors: string[] = []
  const assets: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js'))
      assets.push(url.pathname.slice('/assets/'.length))
  })
  return { context, page, foreignRequests, pageErrors, assets }
}

test('cold built head Home avoids check-in downloads while rendering the department overview', async ({
  browser,
}, info) => {
  const { context, page, foreignRequests, pageErrors, assets } = await actor(
    browser,
    'demo.boshliq',
  )
  try {
    await page.goto('/')
    await expect(page.getByText('Total workforce', { exact: true })).toBeVisible()
    await waitForLoadedRoute(page, '/')
    await settleCapture(page)
    expect(assets.filter((name) => checkinAssets.includes(name))).toEqual([])
    expect(assets.filter((name) => unrelatedHeavyHomeAssets.includes(name))).toEqual([])
    expect(foreignRequests).toEqual([])
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: info.outputPath('head-home.png'), fullPage: true })
    await info.attach('build-and-request-proof', {
      body: JSON.stringify(
        {
          build: JSON.parse(
            readFileSync(resolve(root, 'tools/perf/lighthouse/out/production-build.json'), 'utf8'),
          ),
          checkinAssets,
          unrelatedHeavyHomeAssets,
          requestedAssets: assets,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})

test('built routing preserves unsigned, unknown and administrator route boundaries', async ({
  browser,
}) => {
  const visitor = await newFlowContext(browser)
  const workReads: string[] = []
  try {
    await visitor.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
    const page = await visitor.newPage()
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/') && !['/api/v1/me', '/api/v1/instance'].includes(path))
        workReads.push(request.method() + ' ' + path)
    })
    await page.goto('/work')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('link[data-devon-route-preload]')).toHaveCount(0)
    expect(workReads).toEqual([])
  } finally {
    await visitor.close()
  }
  for (const path of ['/unrecognized-example', '/admin']) {
    const { context, page, foreignRequests } = await actor(browser, 'demo.boshliq')
    const adminReads: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/admin'))
        adminReads.push(request.method())
    })
    try {
      await page.goto(path)
      await expect(
        page.getByRole('heading', {
          name: path === '/admin' ? 'This page is not open to you' : 'Page not found',
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.locator('link[data-devon-route-preload]')).toHaveCount(0)
      expect(adminReads).toEqual([])
      expect(foreignRequests).toEqual([])
    } finally {
      await context.close()
    }
  }
})

test('retired management routes have no page or protected data reads', async ({ browser }) => {
  const check = async (path: string, protectedPrefix: string) => {
    const { context, page, foreignRequests, pageErrors } = await actor(browser, 'demo.xodim')
    const protectedReads: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(protectedPrefix))
        protectedReads.push(request.method())
    })
    try {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible()
      expect(protectedReads).toEqual([])
      expect(foreignRequests).toEqual([])
      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  }
  // Separate actual actors/contexts make these independent permission boundaries.
  await Promise.all([
    check('/goals', '/api/v1/goals'),
    check('/work/workload', '/api/v1/work/workload'),
  ])
})

test('built check-in view lazy-loads the new feature and opens Progress without retired chart dependencies', async ({
  browser,
}, info) => {
  const { context, page, foreignRequests, pageErrors, assets } = await actor(browser, 'demo.xodim')
  try {
    await page.goto('/analytics')
    await expect(page.getByRole('tab', { name: 'Check-in / out', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Two-week cycle', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Progress', exact: true }).click()
    await expect(page.locator('.checkin-progress')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Progress', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await settleCapture(page)
    expect(assets.some((name) => checkinAssets.includes(name))).toBe(true)
    expect(
      builtAssets.some(({ sources }) => sources.some((source) => /recharts/.test(source))),
    ).toBe(false)
    expect(foreignRequests).toEqual([])
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: info.outputPath('member-checkins.png'), fullPage: true })
  } finally {
    await context.close()
  }
})
