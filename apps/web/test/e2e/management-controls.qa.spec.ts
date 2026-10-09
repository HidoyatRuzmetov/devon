import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  login,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { assertLocalTestUrl } from './flow-safety.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

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
function wire(page: Page) {
  const seen = { connected: 0, types: [] as string[], errors: [] as string[] }
  page.on('pageerror', (error) => seen.errors.push(error.message))
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let data: unknown
        try {
          data = JSON.parse(line)
        } catch {
          continue
        }
        for (const raw of Array.isArray(data) ? data : [data]) {
          if (!raw || typeof raw !== 'object') continue
          const reply = raw as {
            connect?: { client?: string }
            push?: { pub?: { data?: { type?: string } } }
          }
          if (reply.connect?.client) seen.connected += 1
          if (reply.push?.pub?.data?.type) seen.types.push(reply.push.pub.data.type)
        }
      }
    }),
  )
  return seen
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
}
async function capture(page: Page, name: string) {
  await page.bringToFront()
  try {
    await settleCapture(page)
  } catch (error) {
    const animations = await page.evaluate(() =>
      document.getAnimations().map((animation) => {
        const effect = animation.effect as KeyframeEffect | null
        const target = effect?.target as HTMLElement | null
        return {
          state: animation.playState,
          timing: effect?.getComputedTiming(),
          className: target?.className,
          text: target?.textContent?.slice(0, 80),
        }
      }),
    )
    await test.info().attach('unsettled-animation-diagnostics', {
      body: JSON.stringify(animations, null, 2),
      contentType: 'application/json',
    })
    throw error
  }
  await noOverflow(page)
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true })
}

test('head rule controls persist and real live clients refresh both rules and their run log', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    const external = await guard(head)
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('qa.rules.head'),
      headPassword: examplePassword(),
      departmentName: 'Local rule controls QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('qa.rules.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const context of [head, member])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const editor = await head.newPage()
    const observer = await head.newPage() // Independent cache and WebSocket client, same authorized head.
    const observerWire = wire(observer)
    await Promise.all([editor.goto('/automations'), observer.goto('/automations')])
    await waitForLoadedRoute(editor, '/automations')
    await expect.poll(() => observerWire.connected).toBe(1)
    await editor
      .locator('main header')
      .getByRole('button', { name: 'Add a rule', exact: true })
      .click()
    const dialog = editor.getByRole('dialog', { name: 'New rule', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Rule name' })
      .fill('Priority for newly created cards')
    await dialog.getByRole('combobox', { name: 'Action', exact: true }).selectOption('set_priority')
    await dialog.getByRole('button', { name: 'Add a rule', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const rules = (await (await head.request.get('/api/v1/automations')).json()) as {
      id: string
      name: string
      enabled: boolean
      version: number
    }[]
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    await expect(observer.getByRole('heading', { name: rule.name, exact: true })).toBeVisible()
    await expect.poll(() => observerWire.types.includes('automations.rule.created')).toBe(true)
    // Card fixture creates a real outbox event. The local development engine applies this rule.
    const createdCard = await authedPost(head, '/api/v1/cards', {
      title: 'Actual local automation trigger',
    })
    expect(createdCard.status()).toBe(201)
    const card = (await createdCard.json()) as { id: string }
    await expect
      .poll(
        async () => (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()).priority,
      )
      .toBe('high')
    await expect.poll(() => observerWire.types.includes('automations.run.recorded')).toBe(true)
    await expect(
      observer.getByText('Actual local automation trigger', { exact: true }),
    ).toBeVisible()
    expect((await (await head.request.get('/api/v1/automations/runs')).json()).total).toBe(1)
    await editor.getByRole('button', { name: 'Pause all', exact: true }).click()
    await expect(
      observer.getByRole('switch', { name: `Enable or disable the rule “${rule.name}”` }),
    ).not.toBeChecked()
    await expect.poll(() => observerWire.types.includes('automations.rules.paused')).toBe(true)
    await editor.getByRole('button', { name: `Edit the rule ${rule.name}`, exact: true }).click()
    const edit = editor.getByRole('dialog', { name: 'Edit rule', exact: true })
    await expect(edit.getByRole('combobox', { name: 'Event' })).toBeDisabled()
    await edit.getByRole('textbox', { name: 'Rule name' }).fill('Edited paused priority rule')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(edit).not.toBeVisible()
    await expect(
      observer.getByRole('heading', { name: 'Edited paused priority rule', exact: true }),
    ).toBeVisible()
    await expect(
      observer.getByRole('switch', {
        name: 'Enable or disable the rule “Edited paused priority rule”',
      }),
    ).not.toBeChecked()
    await editor
      .getByRole('button', { name: 'Duplicate the rule Edited paused priority rule', exact: true })
      .click()
    const copy = editor.getByRole('dialog', { name: 'New rule', exact: true })
    await copy.getByRole('button', { name: 'Add a rule', exact: true }).click()
    await expect(copy).not.toBeVisible()
    const persisted = (await (await head.request.get('/api/v1/automations')).json()) as typeof rules
    expect(persisted).toHaveLength(2)
    expect(persisted.every((item) => !item.enabled)).toBe(true)
    await editor.reload()
    await editor
      .getByRole('switch', { name: 'Enable or disable the rule “Edited paused priority rule”' })
      .click()
    await expect(
      observer.getByRole('switch', {
        name: 'Enable or disable the rule “Edited paused priority rule”',
      }),
    ).toBeChecked()
    await editor
      .getByRole('button', { name: 'Delete the rule “Edited paused priority rule”', exact: true })
      .click()
    await expect(
      observer.getByRole('heading', { name: 'Edited paused priority rule', exact: true }),
    ).not.toBeVisible()
    await expect.poll(() => observerWire.types.includes('automations.rule.deleted')).toBe(true)
    expect(await (await head.request.get('/api/v1/automations')).json()).toHaveLength(1)
    await editor
      .locator('main header')
      .getByRole('button', { name: 'Add a rule', exact: true })
      .click()
    const fieldDialog = editor.getByRole('dialog', { name: 'New rule', exact: true })
    await fieldDialog.getByRole('textbox', { name: 'Rule name' }).fill('Only priority changes')
    await fieldDialog
      .getByRole('combobox', { name: 'Event', exact: true })
      .selectOption('card_field_changed')
    await fieldDialog
      .getByRole('combobox', { name: 'Which field', exact: true })
      .selectOption('priority')
    await fieldDialog
      .getByRole('combobox', { name: 'Action', exact: true })
      .selectOption('add_checklist')
    await fieldDialog
      .getByRole('textbox', { name: 'Checklist', exact: true })
      .fill('Actual priority change')
    await fieldDialog.getByRole('button', { name: 'Add a rule', exact: true }).click()
    await expect(fieldDialog).not.toBeVisible()
    const fieldRule = (
      (await (await head.request.get('/api/v1/automations')).json()) as typeof rules
    ).find((item) => item.name === 'Only priority changes')!
    expect(
      (
        await authedPatch(head, `/api/v1/cards/${card.id}`, { dueAt: '2026-12-31T12:00:00Z' })
      ).status(),
    ).toBe(200)
    await expect
      .poll(
        async () =>
          (await (await head.request.get(`/api/v1/automations/runs?ruleId=${fieldRule.id}`)).json())
            .items[0]?.detail.reason,
      )
      .toBe('field_did_not_match')
    await expect(observer.getByText('A different field changed', { exact: true })).toBeVisible()
    expect(
      (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()).checklist,
    ).toHaveLength(0)
    expect(
      (await authedPatch(head, `/api/v1/cards/${card.id}`, { priority: 'medium' })).status(),
    ).toBe(200)
    await expect
      .poll(
        async () =>
          (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()).checklist.length,
      )
      .toBe(1)
    await expect
      .poll(
        async () =>
          (await (await head.request.get(`/api/v1/automations/runs?ruleId=${fieldRule.id}`)).json())
            .total,
      )
      .toBe(2)
    // The five-second undo countdown is an intentional finite animation, not route entrance.
    // Let the actual undo affordance expire before asking the shared capture guard to settle.
    await editor.bringToFront()
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible({
      timeout: 15_000,
    })
    await editor.setViewportSize({ width: 320, height: 640 })
    await capture(editor, 'rules-320.png')
    const memberPage = await member.newPage()
    await memberPage.goto('/automations')
    await expect(
      memberPage.getByRole('button', { name: 'Add a rule', exact: true }),
    ).not.toBeVisible()
    expect((await member.request.get('/api/v1/automations')).status()).toBe(403)
    expect((await member.request.get('/api/v1/automations/runs')).status()).toBe(403)
    expect(observerWire.errors).toEqual([])
    expect(external).toEqual([])
    await test.info().attach('actual-live-delivery', {
      body: JSON.stringify(observerWire, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})

test('analytics filters, tables, exports and home pins are usable and persisted', async ({
  browser,
}) => {
  const head = await newFlowContext(browser)
  try {
    const external = await guard(head)
    await login(head, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await head.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/analytics')
    await waitForLoadedRoute(page, '/analytics')
    await page.getByRole('button', { name: 'Advanced', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'assignee:@me status:active due:<today' })
      .fill('status:active')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page).toHaveURL((url) => url.searchParams.get('filter') === 'status:active')
    await waitForLoadedRoute(page, '/analytics')
    await page.getByRole('button', { name: 'Save filter', exact: true }).click()
    await page.getByRole('textbox', { name: 'Filter name' }).fill('Local active work filter')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Local active work filter', exact: true }),
    ).toBeVisible()
    const filters = (await (await head.request.get('/api/v1/analytics/saved-filters')).json()) as {
      id: string
      query: string
      name: string
    }[]
    expect(filters.find((filter) => filter.name === 'Local active work filter')?.query).toBe(
      'status:active',
    )
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Local active work filter', exact: true }),
    ).toBeVisible()
    const chart = page.getByRole('region', { name: 'Load per person', exact: true })
    await chart.getByRole('button', { name: 'View as table', exact: true }).click()
    await expect(chart.getByRole('columnheader', { name: 'Person', exact: true })).toBeVisible()
    await expect(chart.getByRole('columnheader')).toHaveCount(3)
    expect(await chart.getByRole('cell').count()).toBeGreaterThan(0)
    const pinned = (await (await head.request.get('/api/v1/analytics/pins')).json()) as {
      id: string
      chartKey: string
    }[]
    const initiallyPinned = pinned.some((pin) => pin.chartKey === 'loadPerPerson')
    await chart
      .getByRole('button', { name: initiallyPinned ? 'Unpin' : 'Pin to Home', exact: true })
      .click()
    await expect(
      chart.getByRole('button', { name: initiallyPinned ? 'Pin to Home' : 'Unpin', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      chart.getByRole('button', { name: initiallyPinned ? 'Pin to Home' : 'Unpin', exact: true }),
    ).toBeVisible()
    expect(
      ((await (await head.request.get('/api/v1/analytics/pins')).json()) as typeof pinned).some(
        (pin) => pin.chartKey === 'loadPerPerson',
      ),
    ).toBe(!initiallyPinned)
    await chart.getByRole('button', { name: 'View as table', exact: true }).click()
    await chart.getByRole('button', { name: 'Export', exact: true }).click()
    const csvPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download as CSV', exact: true }).click()
    const csv = await csvPromise
    await csv.saveAs(test.info().outputPath('load-per-person.csv'))
    const csvBytes = await readFile(test.info().outputPath('load-per-person.csv'))
    expect(csvBytes.byteLength).toBeGreaterThan(20)
    expect(csvBytes.toString('utf8')).toContain('open')
    await chart.getByRole('button', { name: 'Export', exact: true }).click()
    const pngPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download as image', exact: true }).click()
    const png = await pngPromise
    await png.saveAs(test.info().outputPath('load-per-person.png'))
    expect(
      (await readFile(test.info().outputPath('load-per-person.png')))
        .subarray(0, 8)
        .toString('hex'),
    ).toBe('89504e470d0a1a0a')
    await page
      .getByRole('button', {
        name: 'Delete the saved filter “Local active work filter”',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', { name: 'Local active work filter', exact: true }),
    ).not.toBeVisible()
    expect(
      (
        (await (await head.request.get('/api/v1/analytics/saved-filters')).json()) as typeof filters
      ).some((filter) => filter.name === 'Local active work filter'),
    ).toBe(false)
    await page.setViewportSize({ width: 320, height: 640 })
    await capture(page, 'analytics-320.png')
    expect(errors).toEqual([])
    expect(external).toEqual([])
  } finally {
    await head.close()
  }
})

test('admin analytics guidance fits every locale/theme and opens the real global screen', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const external = await guard(context)
    await loginAsSuperAdmin(context)
    const page = await context.newPage()
    const departmentReads: string[] = []
    page.on('request', (request) => {
      if (/\/api\/v1\/analytics\/(summary|pins)/.test(request.url()))
        departmentReads.push(request.url())
    })
    await page.setViewportSize({ width: 320, height: 640 })
    const locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const
    for (let index = 0; index < locales.length; index += 1) {
      const locale = locales[index]!
      const catalog = JSON.parse(
        readFileSync(
          resolve(
            import.meta.dirname,
            `../../../../packages/i18n/messages/${locale}.generated.json`,
          ),
          'utf8',
        ),
      ) as { analytics: { context: { title: string; globalAction: string } } }
      expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
      const themes = ['light', 'dark', 'system'] as const
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex += 1) {
        const theme = themes[themeIndex]!
        await page.goto('/analytics')
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' })
        await page.evaluate((value) => localStorage.setItem('devon_theme', value), theme)
        await page.reload()
        await expect(
          page.getByRole('heading', { name: catalog.analytics.context.title, exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: catalog.analytics.context.globalAction, exact: true }),
        ).toBeVisible()
        await capture(page, `admin-context-${locale}-${theme}-320.png`)
      }
    }
    expect(departmentReads).toEqual([])
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    await page.reload()
    await page.getByRole('button', { name: 'Open system analytics', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await waitForLoadedRoute(page, '/admin/analytics')
    expect(external).toEqual([])
  } finally {
    await context.close()
  }
})

test('management routes and rule dialog fit 320px for each role, locale and theme', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Full locale/theme/role matrix is Chromium; functional journeys run all three engines.',
  )
  test.setTimeout(600_000)
  const roles = ['head', 'member', 'super_admin'] as const
  for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
    const role = roles[roleIndex]!
    const context = await newFlowContext(browser)
    try {
      const external = await guard(context)
      if (role === 'super_admin') await loginAsSuperAdmin(context)
      else
        await login(context, {
          login: role === 'head' ? 'demo.boshliq' : 'demo.xodim',
          password: qaExampleCredential1,
        })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width: 320, height: 640 })
      await page.goto('/analytics')
      const locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const
      for (let localeIndex = 0; localeIndex < locales.length; localeIndex += 1) {
        const locale = locales[localeIndex]!
        const catalog = JSON.parse(
          readFileSync(
            resolve(
              import.meta.dirname,
              `../../../../packages/i18n/messages/${locale}.generated.json`,
            ),
            'utf8',
          ),
        ) as Record<string, unknown>
        const label = (key: string) =>
          key
            .split('.')
            .reduce<unknown>(
              (value, part) => (value as Record<string, unknown>)[part],
              catalog,
            ) as string
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        const themes = ['light', 'dark', 'system'] as const
        for (let themeIndex = 0; themeIndex < themes.length; themeIndex += 1) {
          const theme = themes[themeIndex]!
          await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' })
          await page.evaluate((value) => localStorage.setItem('devon_theme', value), theme)
          // Dependent states of one authenticated page: parallel navigation would change the
          // locale/theme and route under another capture.
          const routes = ['/analytics', '/automations']
          for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
            const route = routes[routeIndex]!
            await page.goto(route)
            await waitForLoadedRoute(page, route)
            expect(await page.locator('html').getAttribute('data-theme')).toBe(
              theme === 'light' ? 'light' : 'dark',
            )
            await capture(page, `${role}-${locale}-${theme}-${route.slice(1)}-320.png`)
            if (route === '/automations' && role === 'head') {
              await page
                .locator('main header')
                .getByRole('button', { name: label('automations.create'), exact: true })
                .click()
              const dialog = page.getByRole('dialog', {
                name: label('automations.newTitle'),
                exact: true,
              })
              await dialog
                .getByRole('combobox', {
                  name: label('automations.builder.actionLabel'),
                  exact: true,
                })
                .selectOption('create_followup')
              await expect(
                dialog.getByRole('textbox', {
                  name: label('automations.builder.followupTitle'),
                  exact: true,
                }),
              ).toBeVisible()
              expect(
                await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
              ).toBe(true)
              await dialog.screenshot({
                path: test.info().outputPath(`${role}-${locale}-${theme}-followup-dialog-320.png`),
              })
              await dialog
                .getByRole('button', { name: label('common.cancel'), exact: true })
                .click()
              await expect(dialog).not.toBeVisible()
            }
          }
        }
      }
      expect(errors).toEqual([])
      expect(external).toEqual([])
    } finally {
      await context.close()
    }
  }
})
