import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

const qaExamplePassword = 'Ishonchli#2026'
const root = resolve(import.meta.dirname, '../../../..')

test('public configuration starts during the held real session read and is reused by Home', async ({
  browser,
}, info) => {
  const context = await newFlowContext(browser)
  const foreign: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      foreign.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await login(context, { login: 'demo.boshliq', password: qaExamplePassword })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  const errors: string[] = []
  const reads: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) reads.push(request.method() + ' ' + url.pathname)
  })
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let reached!: () => void
  const actualSessionFetched = new Promise<void>((resolve) => {
    reached = resolve
  })
  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const actual = await route.fetch()
    expect(actual.status()).toBe(200)
    reached()
    await held
    await route.fulfill({ response: actual })
  })
  try {
    const instanceReply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/instance' && response.status() === 200,
    )
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await actualSessionFetched
    await instanceReply
    const beforeRelease = [...reads]
    expect(
      beforeRelease.filter((entry) => !['GET /api/v1/me', 'GET /api/v1/instance'].includes(entry)),
    ).toEqual([])
    await expect(page.getByRole('heading', { name: 'Management view', exact: true })).toHaveCount(0)
    expect(reads.filter((entry) => entry === 'GET /api/v1/instance')).toHaveLength(1)
    release()
    await expect(page.getByRole('heading', { name: 'Management view', exact: true })).toBeVisible()
    expect(reads.filter((entry) => entry === 'GET /api/v1/instance')).toHaveLength(1)
    expect(foreign).toEqual([])
    expect(errors).toEqual([])
    await info.attach('real-startup-receipts', {
      body: JSON.stringify(
        {
          build: JSON.parse(
            readFileSync(resolve(root, 'tools/perf/lighthouse/out/production-build.json'), 'utf8'),
          ),
          beforeRelease,
          afterRelease: reads,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  } finally {
    release()
    await context.close()
  }
})
