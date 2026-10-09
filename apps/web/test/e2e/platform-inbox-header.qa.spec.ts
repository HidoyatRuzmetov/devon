import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'

// Reuse the existing demo-only credential without importing the DB's native hashing module
// across this package's TypeScript root. The guarded flow setup owns and seeds this database.
const fixtureSource = readFileSync(
  join(import.meta.dirname, '../../../../packages/db/src/seed/fixtures.ts'),
  'utf8',
)
const demoPassword = /^export const DEMO_PASSWORD = '([^']+)'/m.exec(fixtureSource)?.[1]
if (!demoPassword) throw new Error('The documented seeded demo credential is missing')

test('@qa unread delivery does not move the notification list below its actions', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let release: (() => void) | undefined
  try {
    await login(context, { login: 'demo.boshliq', password: demoPassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const source = await context.request.get('/api/v1/notifications?status=inbox&limit=30')
    expect(source.status()).toBe(200)
    const saved = await source.json()
    expect(saved.unreadCount).toBeGreaterThan(0)
    const catalogue = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
        'utf8',
      ),
    ) as { inbox: { title: string; markAllRead: string; tabs: { inbox: string } } }
    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let started: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/notifications?*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      started!()
      await held
      await route.fulfill({ response })
    })
    await page.goto('/inbox')
    await readStarted
    await expect(
      page.getByRole('heading', { name: catalogue.inbox.title, exact: true }),
    ).toBeVisible()
    const panel = page.getByRole('tabpanel', { name: catalogue.inbox.tabs.inbox, exact: true })
    await expect(panel).toBeVisible()
    const markAll = page.getByRole('button', { name: catalogue.inbox.markAllRead, exact: true })
    await expect(markAll).toBeDisabled()
    await settleCapture(page, false)
    const before = await panel.boundingBox()
    await page.screenshot({ path: test.info().outputPath('unread-header-before-data.png') })
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/notifications',
    )
    release!()
    expect((await receipt).status()).toBe(200)
    await expect(markAll).toBeEnabled()
    await settleCapture(page, false)
    const after = await panel.boundingBox()
    await page.screenshot({ path: test.info().outputPath('unread-header-after-data.png') })
    await test.info().attach('unread-header-position', {
      body: JSON.stringify({ before, after, unreadCount: saved.unreadCount }),
      contentType: 'application/json',
    })
    expect(
      Math.abs(after!.y - before!.y),
      'Delivered unread data must not move the existing list',
    ).toBeLessThanOrEqual(1)
  } finally {
    release?.()
    await context.close()
  }
})
