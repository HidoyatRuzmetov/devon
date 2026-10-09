/* eslint-disable no-restricted-syntax -- Browser journeys share a page, session and persisted fixture state; locale/theme/route transitions must remain sequential. */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { problem } from '@devon/contracts'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  login,
  newFlowContext,
  uniqueLogin,
  applySetCookies,
} from './flow-api.js'
import { localSetCookieHeader } from './flow-cookie-options.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { FLOW_DB_NAME, FLOW_DB_HOST, FLOW_DB_PORT, FLOW_DB_CONTAINER } from './flow-env.js'
import { assertLocalTestDatabase, assertLocalTestUrl } from './flow-safety.js'
import { assertLocalDockerEndpoint } from './flow-services.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

async function guard(context: BrowserContext) {
  const external: string[] = []
  await context.route('**/*', async (route) => {
    try {
      assertLocalTestUrl(route.request().url())
      await route.continue()
    } catch {
      external.push(route.request().url())
      await route.abort('blockedbyclient')
    }
  })
  return external
}
function fixtureSql<T>(statement: string): T {
  assertLocalTestDatabase({
    host: FLOW_DB_HOST,
    database: FLOW_DB_NAME,
    container: FLOW_DB_CONTAINER,
    port: FLOW_DB_PORT,
  })
  if (FLOW_DB_NAME !== 'devon_flow_e2e_admin')
    throw new Error('Admin control fixtures require their exact owned namespace')
  const context = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
  if (context.status !== 0) throw new Error('Cannot verify local Docker context')
  assertLocalDockerEndpoint(context.stdout.trim())
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      FLOW_DB_CONTAINER,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
      '-At',
    ],
    { input: statement, encoding: 'utf8', timeout: 30_000 },
  )
  if (result.status !== 0)
    throw new Error(`Owned admin fixture SQL failed: ${result.stderr.slice(-1000)}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as T
}
async function capture(page: Page, name: string) {
  await page.bringToFront()
  await settleCapture(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.viewportSize())!.width + 1,
  )
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true })
}
async function expectReadableLocaleNotice(page: Page) {
  const boxes = await page.getByRole('alert').evaluate((alert) => {
    const text = alert.querySelector('p')!.getBoundingClientRect()
    const action = alert.querySelector('button')!.getBoundingClientRect()
    return { textWidth: text.width, textBottom: text.bottom, actionTop: action.top }
  })
  // At a phone width a full-width paragraph precedes the action, so long localized labels do not
  // compress the text into one-word columns or overlap it despite the page's overall width fitting.
  expect(boxes.textWidth).toBeGreaterThan(180)
  expect(boxes.actionTop).toBeGreaterThanOrEqual(boxes.textBottom + 8)
}
async function setupAdmin(context: BrowserContext) {
  const external = await guard(context)
  await loginAsSuperAdmin(context)
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  return external
}

/** Actual WebKit response cookies need the same HTTP-loopback adapter used by local sign-in.
 * Production HTTPS/Secure transport is not covered or changed by this boundary fixture. */
async function adaptLocalViewAsCookies(context: BrowserContext) {
  if (context.browser()?.browserType().name() !== 'webkit') return
  const origin = new URL(FLOW_WEB_BASE_URL)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
    throw new Error('View-as fixture requires HTTP loopback')
  await context.route(
    /\/api\/v1\/admin\/(?:departments\/[0-9a-f-]+\/view-as|view-as\/stop)$/,
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin.origin || request.method() !== 'POST')
        throw new Error('Unexpected view-as fixture request')
      const actual = await route.fetch({ maxRedirects: 0 })
      if (!actual.ok()) return route.fulfill({ response: actual })
      await applySetCookies(context, actual)
      const headers = actual.headers()
      const cookies = headers['set-cookie']
      await route.fulfill({
        response: actual,
        headers: {
          ...headers,
          ...(cookies ? { 'set-cookie': localSetCookieHeader(cookies) } : {}),
        },
      })
    },
  )
}

test('settings persist reversible changes, reject unavailable reads/writes and allow safe ceremony cancellation', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const page = await admin.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin/settings')
    await waitForLoadedRoute(page, '/admin/settings')
    const initial = (await (await admin.request.get('/api/v1/admin/instance')).json()) as {
      registrationOpen: boolean
      userCount: number
      isDemo: boolean
    }
    const toggle = page.getByRole('switch')
    expect(initial.registrationOpen).toBe(true)
    await toggle.click()
    await expect
      .poll(
        async () =>
          (await (await admin.request.get('/api/v1/admin/instance')).json()).registrationOpen,
      )
      .toBe(false)
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect
      .poll(
        async () =>
          (await (await admin.request.get('/api/v1/admin/instance')).json()).registrationOpen,
      )
      .toBe(true)
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Local synthetic maintenance notice')
    await page.getByRole('button', { name: 'Turn on', exact: true }).click()
    await expect
      .poll(
        async () => (await (await admin.request.get('/api/v1/admin/maintenance')).json()).enabled,
      )
      .toBe(true)
    const maintenance = (await (await admin.request.get('/api/v1/admin/maintenance')).json()) as {
      message: Record<string, string>
    }
    expect(maintenance.message).toEqual({
      'uz-Latn': 'Local synthetic maintenance notice',
      'uz-Cyrl': '',
      ru: '',
      en: '',
    })
    await page.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect
      .poll(
        async () => (await (await admin.request.get('/api/v1/admin/maintenance')).json()).enabled,
      )
      .toBe(false)
    const registrationWrite = '**/api/v1/admin/registration'
    await page.route(registrationWrite, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Local write refusal', status: 503 }),
      }),
    )
    await toggle.click()
    await expect(
      page.getByText('The change could not be saved. Try again.', { exact: true }),
    ).toBeVisible()
    await expect(toggle).toBeChecked()
    await page.unroute(registrationWrite)
    const keyCount = fixtureSql<number>('select count(*)::int from app.sentinel_keys')
    await page.getByRole('button', { name: /^(Generate|Rotate) key$/ }).click()
    await expect(page.getByRole('button', { name: 'Rotate key', exact: true })).toBeVisible()
    const key = (await (await admin.request.get('/api/v1/admin/sentinel/status')).json()) as {
      publicKeyB64: string
    }
    expect(key.publicKeyB64.length).toBeGreaterThan(20)
    await page.getByRole('button', { name: 'Rotate key', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await admin.request.get('/api/v1/admin/sentinel/status')).json()).publicKeyB64,
      )
      .not.toBe(key.publicKeyB64)
    expect(
      fixtureSql<{ active: number; total: number }>(
        "select json_build_object('active',count(*) filter(where active),'total',count(*)) from app.sentinel_keys",
      ),
    ).toEqual({ active: 1, total: keyCount + 2 })
    await page.getByRole('button', { name: 'Start wipe', exact: true }).click()
    const ceremony = page.getByRole('dialog', { name: 'Confirmation required', exact: true })
    await ceremony.getByRole('button', { name: 'Continue', exact: true }).click()
    await ceremony.getByRole('textbox').fill('wrong phrase')
    await expect(ceremony.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
    await ceremony
      .getByRole('textbox')
      .fill(`WIPE ${initial.userCount} ${initial.isDemo ? 'DEMO' : 'PROD'}`)
    await ceremony.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(ceremony.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
    await ceremony.getByRole('button', { name: 'Back', exact: true }).click()
    await ceremony.getByRole('button', { name: 'Back', exact: true }).click()
    await ceremony.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(ceremony).not.toBeVisible()
    expect(fixtureSql<number>('select count(*)::int from app.wipe_requests')).toBe(0)
    await page.setViewportSize({ width: 320, height: 800 })
    await capture(page, 'settings-controls-320.png')
    for (const path of ['instance', 'maintenance', 'sentinel/status', 'wipe/status'])
      await page.route(`**/api/v1/admin/${path}`, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Local unavailable read', status: 503 }),
        }),
      )
    await page.reload()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(4)
    await expect(page.getByRole('switch')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start wipe', exact: true })).toHaveCount(0)
    await capture(page, 'settings-unavailable-320.png')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await admin.close()
  }
})

test('audit filters, chain verification and download recover from refusal; local health refresh reports real configuration', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const prefix = `qa-overview-${randomUUID().slice(0, 8)}`
    fixtureSql<number>(
      `insert into app.departments(name,slug) select '${prefix}-'||n,'${prefix}-'||n from generate_series(1,31)n;select count(*)::int from app.departments where slug like '${prefix}%';`,
    )
    const page = await admin.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin/audit')
    await waitForLoadedRoute(page, '/admin/audit')
    const verifyRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/admin/audit/verify')) verifyRequests.push(request.method())
    })
    await page.evaluate(() => {
      const local = window as typeof window & { adminVerifyPointerEvents?: unknown[] }
      local.adminVerifyPointerEvents = []
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'])
        document.addEventListener(
          type,
          (event) => {
            const target = event.target as Element | null
            const button = target?.closest('button')
            if (button?.textContent?.includes('Verify chain'))
              local.adminVerifyPointerEvents!.push({
                type,
                target: target?.tagName,
                disabled: button.disabled,
                busy: button.getAttribute('aria-busy'),
              })
          },
          true,
        )
    })
    await page.route('**/api/v1/admin/audit/verify', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify(problem('internal')),
      }),
    )
    await page.getByRole('button', { name: 'Verify chain', exact: true }).click()
    await expect(
      page.getByText('The change could not be saved. Try again.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Chain intact', { exact: true })).toHaveCount(0)
    await page.unroute('**/api/v1/admin/audit/verify')
    await page.getByRole('button', { name: 'Verify chain', exact: true }).click()
    await test.info().attach('verify-pointer-boundary.json', {
      body: JSON.stringify({
        requests: verifyRequests,
        events: await page.evaluate(
          () =>
            (window as typeof window & { adminVerifyPointerEvents?: unknown[] })
              .adminVerifyPointerEvents,
        ),
      }),
      contentType: 'application/json',
    })
    await expect(page.getByText('Chain intact', { exact: true })).toBeVisible()
    await page.locator('main').getByRole('button', { name: 'Admin', exact: true }).click()
    const today = new Date().toISOString().slice(0, 10)
    await page.getByLabel('From date', { exact: true }).fill(today)
    await page.getByLabel('To date', { exact: true }).fill(today)
    await expect(page.getByLabel('From date', { exact: true })).toHaveValue(today)
    const cap = '**/api/v1/admin/audit/export*'
    await page.route(cap, (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify(
          problem('validation_failed', { errors: [{ path: 'export', code: 'too_many_events' }] }),
        ),
      }),
    )
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    await expect(
      page.getByText(
        'This export has too many events. Choose a category or a shorter date range, then try again.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/audit$/)
    await page.unroute(cap)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    const file = await downloaded
    expect(file.suggestedFilename()).toBe('audit-export.csv')
    const csv = await readFile((await file.path())!, 'utf8')
    expect(csv).toMatch(/^seq,at,actor_user_id,actor_name,/)
    const lines = csv.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.slice(1).every((line) => line.includes('"admin.'))).toBe(true)
    await page.goto('/admin/health')
    await waitForLoadedRoute(page, '/admin/health')
    await expect(page.locator('main section ul>li')).toHaveCount(6)
    const before = (await (await admin.request.get('/api/v1/admin/health')).json()) as {
      checkedAt: string
      telegram: { status: string }
      ai: { status: string }
      backups: { status: string }
    }
    expect(before.telegram.status).toBe('not_configured')
    expect(before.ai.status).toBe('not_configured')
    expect(before.backups.status).toBe('not_configured')
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/admin/health') && response.status() === 200,
    )
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    expect((await (await refreshed).json()).checkedAt).not.toBe(before.checkedAt)
    await page.setViewportSize({ width: 320, height: 800 })
    await capture(page, 'health-local-config-320.png')
    await page.goto('/admin')
    await waitForLoadedRoute(page, '/admin')
    await page.getByRole('button', { name: 'By department', exact: true }).click()
    const tile = page.getByRole('button', { name: 'By department', exact: true }).locator('..')
    const total = fixtureSql<number>(
      'select count(*)::int from app.departments where deleted_at is null',
    )
    while (await tile.getByRole('button', { name: 'More departments', exact: true }).count()) {
      const beforeCount = await tile.locator('li').count()
      const response = page.waitForResponse(
        (row) => row.url().includes('/api/v1/admin/departments?cursor=') && row.status() === 200,
      )
      await tile.getByRole('button', { name: 'More departments', exact: true }).click()
      await response
      await expect.poll(() => tile.locator('li').count()).toBeGreaterThan(beforeCount)
    }
    await expect(tile.locator('li')).toHaveCount(total)
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await admin.close()
  }
})

function catalogueLabel(locale: string, key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') throw new Error(`Missing catalogue object ${key}`)
    value = (value as Record<string, unknown>)[part]
  }
  if (typeof value !== 'string') throw new Error(`Missing catalogue label ${key}`)
  return value
}

test('language chunk refusal keeps the current screen usable and boot offers a real reload recovery', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const external = await guard(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/login')
    await waitForLoadedRoute(page, '/login')
    const russianChunk = /\/packages\/i18n\/src\/catalogues\/ru\.ts(?:\?|$)/
    await page.route(russianChunk, (route) => route.abort('failed'))
    await page
      .getByRole('button', { name: catalogueLabel('uz-Latn', 'shell.locale.aria'), exact: true })
      .click()
    await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Русский')
    await expect(page.locator('html')).toHaveAttribute('lang', 'uz-Latn')
    await expect(page.locator('main form')).toBeVisible()
    await page.setViewportSize({ width: 320, height: 800 })
    await expectReadableLocaleNotice(page)
    await capture(page, 'locale-switch-refusal-320.png')
    await page.unroute(russianChunk)
    await page
      .getByRole('button', { name: catalogueLabel('uz-Latn', 'locale.reload'), exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(page.locator('main form')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    const englishChunk = /\/packages\/i18n\/src\/catalogues\/en\.ts(?:\?|$)/
    await page.route(englishChunk, (route) => route.abort('failed'))
    await page.evaluate(() => localStorage.setItem('devon_locale', 'en'))
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('English')
    await expect(page.locator('main form')).toHaveCount(0)
    await expectReadableLocaleNotice(page)
    await capture(page, 'locale-boot-refusal-320.png')
    await page.unroute(englishChunk)
    await page
      .getByRole('button', { name: catalogueLabel('uz-Latn', 'locale.reload'), exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('main form')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await context.close()
  }
})

test('a delayed older language preference reply cannot override the latest choice or durable profile preference', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
  const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve))
  let firstCommitted!: () => void
  let secondCommitted!: () => void
  const first = new Promise<void>((resolve) => (firstCommitted = resolve))
  const second = new Promise<void>((resolve) => (secondCommitted = resolve))
  try {
    const external = await setupAdmin(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.route('**/api/v1/me', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const choice = route.request().postDataJSON() as { locale: string }
      const actual = await route.fetch({ maxRedirects: 0 })
      expect(actual.status()).toBe(200)
      if (choice.locale === 'ru') {
        firstCommitted()
        await firstGate
      } else if (choice.locale === 'en') {
        secondCommitted()
        await secondGate
      } else throw new Error('Unexpected local preference choice')
      await route.fulfill({ response: actual })
    })
    await page
      .getByRole('button', { name: catalogueLabel('en', 'shell.locale.aria'), exact: true })
      .click()
    await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click()
    await first
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await page
      .getByRole('button', { name: catalogueLabel('ru', 'shell.locale.aria'), exact: true })
      .click()
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.evaluate(() => {
      const local = window as typeof window & { adminLocaleTransitions?: string[] }
      local.adminLocaleTransitions = []
      new MutationObserver(() =>
        local.adminLocaleTransitions!.push(document.documentElement.lang),
      ).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    })
    releaseFirst()
    await second
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { adminLocaleTransitions?: string[] }).adminLocaleTransitions,
      ),
    ).not.toContain('ru')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    releaseSecond()
    await expect
      .poll(() =>
        page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user.locale as string),
      )
      .toBe('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    releaseFirst()
    releaseSecond()
    await context.close()
  }
})
test('refused language preference retains the latest choice across reload and offers a real save retry', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let releaseRetry!: () => void
  const retryGate = new Promise<void>((resolve) => (releaseRetry = resolve))
  let retryStarted!: () => void
  const retryRequest = new Promise<void>((resolve) => (retryStarted = resolve))
  let preferenceWrites = 0
  try {
    const external = await setupAdmin(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin')
    await waitForLoadedRoute(page, '/admin')
    const preference = '**/api/v1/me'
    await page.route(preference, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      preferenceWrites += 1
      if (preferenceWrites === 2) {
        retryStarted()
        await retryGate
      }
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Local preference refusal', status: 503 }),
      })
    })
    const refused = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.status() === 503,
    )
    await page
      .getByRole('button', { name: catalogueLabel('en', 'shell.locale.aria'), exact: true })
      .click()
    await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click()
    await refused
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await page.reload()
    await waitForLoadedRoute(page, '/admin')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(page.getByRole('alert')).toContainText('Русский')
    await page.setViewportSize({ width: 320, height: 800 })
    await expectReadableLocaleNotice(page)
    await capture(page, 'locale-preference-refusal-reloaded-320.png')
    const retry = page.getByRole('button', {
      name: catalogueLabel('ru', 'locale.retrySave'),
      exact: true,
    })
    await retry.click()
    await retryRequest
    await expect(retry).toBeDisabled()
    await page.keyboard.press('Enter')
    expect(preferenceWrites).toBe(2)
    releaseRetry()
    await expect(page.getByRole('alert')).toContainText('Русский')
    await expect(retry).toBeEnabled()
    expect((await (await context.request.get('/api/v1/me')).json()).user.locale).toBe('en')
    await page.unroute(preference)
    await retry.click()
    await expect
      .poll(async () => (await (await context.request.get('/api/v1/me')).json()).user.locale)
      .toBe('ru')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.reload()
    await waitForLoadedRoute(page, '/admin')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    releaseRetry()
    await context.close()
  }
})

test('account and department live searches retain keyboard focus throughout request transitions', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const page = await admin.newPage()
    for (const [route, label, query] of [
      ['/admin/accounts', 'Search by name or login', 'admin'],
      ['/admin/departments', 'Search by department name', 'Design'],
    ]) {
      await page.goto(route!)
      await waitForLoadedRoute(page, route!)
      const input = page.getByRole('textbox', { name: label!, exact: true })
      await input.focus()
      await page.keyboard.type(query!, { delay: 120 })
      await expect.soft(input).toHaveValue(query!)
      await expect.soft(input).toBeFocused()
    }
    expect(external).toEqual([])
  } finally {
    await admin.close()
  }
})
test('language preference notices remain readable and actionable in every locale at320', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const external = await setupAdmin(context)
    expect((await authedPatch(context, '/api/v1/me', { locale: 'ru' })).status()).toBe(200)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/admin')
    await waitForLoadedRoute(page, '/admin')
    await page.route('**/api/v1/me', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Local preference refusal', status: 503 }),
          })
        : route.fallback(),
    )
    for (const [locale, autonym] of [
      ['en', 'English'],
      ['ru', 'Русский'],
      ['uz-Latn', 'Oʻzbekcha (lotin)'],
      ['uz-Cyrl', 'Ўзбекча (кирилл)'],
    ]) {
      const currentLocale = await page.locator('html').getAttribute('lang')
      await page
        .getByRole('button', {
          name: catalogueLabel(currentLocale!, 'shell.locale.aria'),
          exact: true,
        })
        .click()
      const refused = page.waitForResponse(
        (response) => response.request().method() === 'PATCH' && response.status() === 503,
      )
      await page.getByRole('menuitemradio', { name: autonym!, exact: true }).click()
      await refused
      await expect(page.locator('html')).toHaveAttribute('lang', locale!)
      for (const theme of ['light', 'dark']) {
        await settleCapture(page)
        await page.evaluate((value) => localStorage.setItem('devon_theme', value), theme)
        await page.reload()
        await waitForLoadedRoute(page, '/admin')
        await expect(page.locator('html')).toHaveAttribute('lang', locale!)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByRole('alert')).toContainText(autonym!)
        await expect(
          page.getByRole('button', {
            name: catalogueLabel(locale!, 'locale.retrySave'),
            exact: true,
          }),
        ).toBeEnabled()
        await expectReadableLocaleNotice(page)
        const axe = await new AxeBuilder({ page })
          .include('[role="alert"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(
          axe.violations.filter((row) => row.impact === 'critical' || row.impact === 'serious'),
        ).toEqual([])
        await capture(page, `locale-preference-${locale}-${theme}-320.png`)
      }
    }
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await context.close()
  }
})

test('backup warning preserves readable text and its direct health action at320', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const external = await setupAdmin(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/admin')
    await waitForLoadedRoute(page, '/admin')
    for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
      expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
      for (const theme of ['light', 'dark']) {
        await settleCapture(page)
        await page.evaluate((value) => localStorage.setItem('devon_theme', value), theme)
        await page.goto('/admin')
        await waitForLoadedRoute(page, '/admin')
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        const text = page.getByText(
          catalogueLabel(locale, 'admin.console.dashboard.backupsUnconfigured'),
          { exact: true },
        )
        const action = page.getByRole('link', {
          name: catalogueLabel(locale, 'admin.console.dashboard.backupsConfigure'),
          exact: true,
        })
        await text.scrollIntoViewIfNeeded()
        const textBox = await text.boundingBox()
        const actionBox = await action.boundingBox()
        expect(textBox!.width).toBeGreaterThan(180)
        expect(actionBox!.y).toBeGreaterThanOrEqual(textBox!.y + textBox!.height + 8)
        await capture(page, `backup-warning-${locale}-${theme}-320.png`)
      }
    }
    await page
      .getByRole('link', {
        name: catalogueLabel('uz-Cyrl', 'admin.console.dashboard.backupsConfigure'),
        exact: true,
      })
      .click()
    await waitForLoadedRoute(page, '/admin/health')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await context.close()
  }
})

test('same-owner signed department lens preserves an unsaved language until its acknowledged retry', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const external = await setupAdmin(context)
    await adaptLocalViewAsCookies(context)
    const active = (
      await (await context.request.get('/api/v1/admin/departments?status=active')).json()
    ).departments[0] as { id: string; name: string }
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin/departments')
    await waitForLoadedRoute(page, '/admin/departments')
    await page.route('**/api/v1/me', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Local preference refusal', status: 503 }),
          })
        : route.fallback(),
    )
    await page
      .getByRole('button', { name: catalogueLabel('en', 'shell.locale.aria'), exact: true })
      .click()
    await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Русский')
    await page
      .getByRole('textbox', {
        name: catalogueLabel('ru', 'admin.console.departments.searchPlaceholder'),
        exact: true,
      })
      .fill(active.name)
    await page.getByRole('button', { name: active.name, exact: true }).click()
    await page
      .getByRole('button', {
        name: catalogueLabel('ru', 'admin.console.departments.viewAs'),
        exact: true,
      })
      .click()
    await expect(page).toHaveURL((url) => url.pathname === '/')
    await expect(page.getByRole('alert')).toContainText('Русский')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await page
      .getByRole('button', {
        name: catalogueLabel('ru', 'admin.console.viewAsBanner.exit'),
        exact: true,
      })
      .click()
    await waitForLoadedRoute(page, '/admin/departments')
    await expect(page.getByRole('alert')).toContainText('Русский')
    await page.unroute('**/api/v1/me')
    await page
      .getByRole('button', { name: catalogueLabel('ru', 'locale.retrySave'), exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect((await (await context.request.get('/api/v1/me')).json()).user.locale).toBe('ru')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await context.close()
  }
})

test('admin routes and nested safe controls fit all locales and theme preferences at320', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(480_000)
  const admin = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const page = await admin.newPage()
    await page.bringToFront()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 320, height: 800 })
    const departments = (await (
      await admin.request.get('/api/v1/admin/departments?status=active')
    ).json()) as { departments: { name: string }[] }
    const users = (await (
      await admin.request.get('/api/v1/admin/accounts?status=active')
    ).json()) as { users: { login: string; role: string }[] }
    const account = users.users.find((row) => row.role !== 'super_admin')!
    await page.goto('/admin')
    await waitForLoadedRoute(page, '/admin')
    await settleCapture(page)
    for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
      expect((await authedPatch(admin, '/api/v1/me', { locale })).status()).toBe(200)
      for (const theme of ['light', 'dark', 'system']) {
        // Set the next document's theme before its application boots. An extra hard navigation
        // just to set storage immediately aborts the outgoing WebKit document's fetches.
        await page.evaluate((value) => localStorage.setItem('devon_theme', value), theme)
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' })
        for (const route of [
          '/admin',
          '/admin/accounts',
          '/admin/departments',
          '/admin/analytics',
          '/admin/audit',
          '/admin/health',
          '/admin/settings',
        ]) {
          await page.goto(route)
          await waitForLoadedRoute(page, route)
          await expect(page.locator('html')).toHaveAttribute('lang', locale)
          const label = (key: string) => catalogueLabel(locale, `admin.console.${key}`)
          if (route === '/admin')
            await page
              .getByRole('button', { name: label('dashboard.userCountBreakdown'), exact: true })
              .click()
          if (route === '/admin/accounts') {
            await page
              .getByRole('textbox', { name: label('accounts.searchPlaceholder'), exact: true })
              .fill(account.login)
            await expect(page.locator('tbody tr')).toHaveCount(1)
            await page
              .getByRole('button', { name: label('accounts.actionsMenu'), exact: true })
              .click()
            await expect(
              page.getByRole('menuitem', { name: label('accounts.resetPassword'), exact: true }),
            ).toBeVisible()
          }
          if (route === '/admin/departments') {
            await page
              .getByRole('textbox', { name: label('departments.searchPlaceholder'), exact: true })
              .fill(departments.departments[0]!.name)
            await page
              .getByRole('button', { name: departments.departments[0]!.name, exact: true })
              .click()
            await expect(
              page.getByRole('button', { name: label('departments.viewAs'), exact: true }),
            ).toBeVisible()
          }
          if (route === '/admin/settings') {
            await page.getByRole('tab', { name: 'English', exact: true }).click()
            await page
              .getByRole('button', { name: label('settings.wipeStartCta'), exact: true })
              .click()
            await expect(page.getByRole('dialog')).toBeVisible()
          }
          await settleCapture(page)
          const width = await page.evaluate(() => document.documentElement.scrollWidth)
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze()
          const findings = axe.violations.filter(
            (row) => row.impact === 'critical' || row.impact === 'serious',
          )
          const slug = route.replaceAll('/', '-') || 'overview'
          const screenshot = test.info().outputPath(`${locale}-${theme}${slug}-320.png`)
          await page.screenshot({ path: screenshot, fullPage: true })
          await appendFile(
            test.info().outputPath('observations.jsonl'),
            JSON.stringify({
              browser: browserName,
              route,
              locale,
              theme,
              width,
              viewport: 320,
              screenshot,
              violations: findings,
              pixelInspection: 'pending',
            }) + '\n',
          )
          expect
            .soft(width, `${browserName}:${route}:${locale}:${theme}:overflow`)
            .toBeLessThanOrEqual(321)
          expect
            .soft(
              findings.map((row) => ({
                id: row.id,
                nodes: row.nodes.map((node) => ({ html: node.html, summary: node.failureSummary })),
              })),
              `${browserName}:${route}:${locale}:${theme}:a11y`,
            )
            .toEqual([])
          await page.keyboard.press('Escape')
        }
      }
    }
    expect(errors).toEqual([])
    expect(external).toEqual([])
    expect(fixtureSql<number>('select count(*)::int from app.wipe_requests')).toBe(0)
  } finally {
    await admin.close()
  }
})

test('account action menus support keyboard selection, Escape restoration, Tab dismissal and outside navigation', async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const admin = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const page = await admin.newPage()
    await page.goto('/admin/accounts')
    await waitForLoadedRoute(page, '/admin/accounts')
    const trigger = page.getByRole('button', { name: 'Actions', exact: true }).first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    const first = page.getByRole('menuitem').first()
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem').nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect.soft(page.getByRole('menu')).toHaveCount(0)
    await expect
      .soft(page.getByRole('button', { name: 'Actions', exact: true }).nth(1))
      .toBeFocused()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await expect.soft(page.getByRole('menu')).toHaveCount(0)
    await expect
      .soft(page.getByRole('combobox', { name: 'Filter by status', exact: true }))
      .toBeFocused()
    await page.keyboard.press('Escape')
    await trigger.click()
    await page.getByRole('link', { name: 'Health', exact: true }).click({ timeout: 5000 })
    await expect(page).toHaveURL(/\/admin\/health$/)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(external).toEqual([])
  } finally {
    await admin.close()
  }
})

test('accounts and departments page through all rows and nested controls persist without broadening head/member privileges', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    const external = await setupAdmin(admin)
    const name = `Admin control ${randomUUID().slice(0, 8)}`
    await adaptLocalViewAsCookies(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('admin.head'),
      headPassword: examplePassword(),
      departmentName: name,
    })
    const memberLogin = uniqueLogin('admin.member')
    const memberPassword = examplePassword()
    await joinDepartmentAsNewUser(member, {
      login: memberLogin,
      password: memberPassword,
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const actor of [head, member]) {
      await guard(actor)
      expect((await authedPatch(actor, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      for (const path of [
        'instance',
        'accounts',
        'departments',
        'analytics',
        'audit/events',
        'health',
        'maintenance',
        'sentinel/status',
        'wipe/status',
      ])
        expect((await actor.request.get(`/api/v1/admin/${path}`)).status()).toBe(403)
      const denied = await actor.newPage()
      await denied.goto('/admin/settings')
      await expect(
        denied.getByRole('heading', { name: 'This page is not open to you', exact: true }),
      ).toBeVisible()
      await expect(denied.getByRole('switch')).toHaveCount(0)
      await denied.close()
    }
    const prefix = `qa-admin-${randomUUID().slice(0, 8)}`
    fixtureSql<number>(
      `insert into app.departments(name,slug,created_at) select '${prefix}-'||n,'${prefix}-'||n,'2026-10-08T00:00:00.123456Z' from generate_series(1,31) n; select count(*)::int from app.departments where slug like '${prefix}%';`,
    )
    const page = await admin.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/admin/accounts')
    await waitForLoadedRoute(page, '/admin/accounts')
    await expect(page.locator('tbody tr')).toHaveCount(25)
    const firstLogin = await page.locator('tbody tr').first().innerText()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.locator('tbody tr').first()).not.toHaveText(firstLogin)
    await page
      .getByRole('textbox', { name: 'Search by name or login', exact: true })
      .fill(memberLogin)
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Lock', exact: true }).click()
    const lock = page.getByRole('dialog', { name: 'Lock account', exact: true })
    await lock
      .getByRole('textbox', { name: 'Reason', exact: true })
      .fill('Local synthetic restriction')
    await lock.getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(lock).not.toBeVisible()
    const account = (await (
      await admin.request.get(`/api/v1/admin/accounts?query=${memberLogin}`)
    ).json()) as { users: { id: string; status: string }[] }
    expect(account.users[0]?.status).toBe('locked')
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Unlock', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await admin.request.get(`/api/v1/admin/accounts/${account.users[0]!.id}`)).json())
            .status,
      )
      .toBe('active')
    fixtureSql<number>(
      `insert into app.user_security(user_id,totp_enabled,totp_secret_enc,recovery_codes_hash) values('${account.users[0]!.id}',true,'local-fixture','{}') on conflict(user_id) do update set totp_enabled=true,totp_secret_enc='local-fixture';select count(*)::int from app.user_security where user_id='${account.users[0]!.id}' and totp_enabled;`,
    )
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Force 2FA reset', exact: true }).click()
    await expect(page.getByText('Two-factor authentication reset', { exact: true })).toBeVisible()
    expect(
      fixtureSql<{ enabled: boolean; secret: null }>(
        `select json_build_object('enabled',totp_enabled,'secret',totp_secret_enc) from app.user_security where user_id='${account.users[0]!.id}'`,
      ),
    ).toEqual({ enabled: false, secret: null })
    const passwordContext = await newFlowContext(browser)
    await guard(passwordContext)
    try {
      await login(passwordContext, { login: memberLogin, password: memberPassword })
      await page.getByRole('button', { name: 'Actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Reset password', exact: true }).click()
      const temporary = page.getByRole('dialog', { name: 'Temporary password', exact: true })
      await expect(temporary).toBeVisible()
      const password = (await temporary.locator('code').innerText()).trim()
      expect(password.length).toBeGreaterThan(16)
      expect((await passwordContext.request.get('/api/v1/me')).status()).toBe(401)
      await login(passwordContext, { login: memberLogin, password })
      expect(
        (await (await passwordContext.request.get('/api/v1/me')).json()).user.mustChangePassword,
      ).toBe(true)
      await temporary
        .getByRole('button', { name: 'Close', exact: true })
        .filter({ hasText: 'Close' })
        .click()
    } finally {
      await passwordContext.close()
    }
    fixtureSql<number>(
      `insert into app.ai_traces(department_id,user_id,feature,model,status,total_tokens,cost_uzs,created_at) select '${department.departmentId}','${account.users[0]!.id}','quick_add_parse','local-fixture',case when n>20 then 'provider_error'::app.ai_trace_status else 'ok'::app.ai_trace_status end,100,2,now()+n*interval '1 millisecond' from generate_series(1,25)n;select count(*)::int from app.ai_traces where department_id='${department.departmentId}';`,
    )
    await page.goto('/admin/departments')
    await waitForLoadedRoute(page, '/admin/departments')
    await page.getByRole('textbox', { name: 'Search by department name', exact: true }).fill(prefix)
    await expect(page.locator('tbody tr')).toHaveCount(25)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(6)
    await page.getByRole('textbox', { name: 'Search by department name', exact: true }).fill(name)
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    const open = () => page.getByRole('button', { name, exact: true }).click()
    await open()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    const pause = page.getByRole('dialog', { name: 'Pause department', exact: true })
    await pause.getByRole('textbox', { name: 'Reason', exact: true }).fill('Local pause inspection')
    await pause.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await admin.request.get(`/api/v1/admin/departments/${department.departmentId}`)
            ).json()
          ).status,
      )
      .toBe('paused_by_admin')
    await open()
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await admin.request.get(`/api/v1/admin/departments/${department.departmentId}`)
            ).json()
          ).status,
      )
      .toBe('active')
    await open()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await admin.request.get(`/api/v1/admin/departments/${department.departmentId}`)
            ).json()
          ).status,
      )
      .toBe('archived')
    await open()
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await admin.request.get(`/api/v1/admin/departments/${department.departmentId}`)
            ).json()
          ).status,
      )
      .toBe('active')
    await page.setViewportSize({ width: 320, height: 800 })
    await open()
    await capture(page, 'department-drawer-320.png')
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify(problem('internal')),
      }),
    )
    await page.getByRole('button', { name: 'View as', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Exit view-as', exact: true })).toBeVisible()
    expect(await page.evaluate(async () => (await fetch('/api/v1/admin/instance')).status)).toBe(
      403,
    )
    await expect(
      page.getByRole('heading', { name: catalogueLabel('en', 'state.error.title'), exact: true }),
    ).toBeVisible()
    await page.unroute('**/api/v1/me')
    await page
      .getByRole('button', { name: catalogueLabel('en', 'state.error.action'), exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: catalogueLabel('en', 'state.error.title'), exact: true }),
    ).toHaveCount(0)
    await page.goto('/ai?tab=usage')
    await expect(page.locator('tbody tr')).toHaveCount(20)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(5)
    await page.getByLabel('Outcome', { exact: true }).selectOption('provider_error')
    await expect(page.locator('tbody tr')).toHaveCount(5)
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0)
    await capture(page, 'ai-metering-lens-320.png')
    await page.route('**/api/v1/admin/view-as/stop', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Local exit refusal', status: 503 }),
      }),
    )
    await page.getByRole('button', { name: 'Exit view-as', exact: true }).click()
    await expect(
      page.getByText('The change could not be saved. Try again.', { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(async () => (await fetch('/api/v1/admin/instance')).status)).toBe(
      403,
    )
    await page.unroute('**/api/v1/admin/view-as/stop')
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify(problem('internal')),
      }),
    )
    await page.getByRole('button', { name: 'Exit view-as', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Exit view-as', exact: true })).toHaveCount(0)
    expect(await page.evaluate(async () => (await fetch('/api/v1/admin/instance')).status)).toBe(
      200,
    )
    await expect(
      page.getByRole('heading', { name: catalogueLabel('en', 'state.error.title'), exact: true }),
    ).toBeVisible()
    await page.unroute('**/api/v1/me')
    await page
      .getByRole('button', { name: catalogueLabel('en', 'state.error.action'), exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: catalogueLabel('en', 'state.error.title'), exact: true }),
    ).toHaveCount(0)
    await page.goto('/admin/accounts')
    await page
      .getByRole('textbox', { name: 'Search by name or login', exact: true })
      .fill(memberLogin)
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const remove = page.getByRole('dialog', { name: 'Delete account', exact: true })
    await remove.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(remove).not.toBeVisible()
    expect(
      fixtureSql<{ status: string; deleted: boolean; traceCount: number }>(
        `select json_build_object('status',status,'deleted',deleted_at is not null,'traceCount',(select count(*) from app.ai_traces where user_id=u.id)) from app.users u where id='${account.users[0]!.id}'`,
      ),
    ).toEqual({ status: 'deleted', deleted: true, traceCount: 25 })
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
