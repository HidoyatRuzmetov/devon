import { expect, test, type Browser } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

async function fixture(browser: Browser) {
  const head = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  const ordinary = await newFlowContext(browser)
  const assigned = await newFlowContext(browser)
  const external: string[] = []
  await Promise.all(
    [head, admin, ordinary, assigned].map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('scope.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic scope department',
  })
  await admin.close()
  expect(
    (
      await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
        headers: { 'x-csrf-token': await csrfToken(head) },
        data: { features: { workload: true, estimates: true } },
      })
    ).status(),
  ).toBe(200)
  await joinDepartmentAsNewUser(ordinary, {
    login: uniqueLogin('scope.ordinary'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  await joinDepartmentAsNewUser(assigned, {
    login: uniqueLogin('scope.unit'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  const contexts = [head, ordinary, assigned]
  const names = ['HeadScope', 'OrdinaryScope', 'UnitScope']
  const userIds: string[] = []
  for (let index = 0; index < contexts.length; index += 1) {
    expect(
      (
        await authedPatch(contexts[index]!, '/api/v1/accounts/profile', {
          givenName: names[index],
          familyName: 'Synthetic',
        })
      ).status(),
    ).toBe(200)
    expect((await authedPatch(contexts[index]!, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    userIds.push(
      (await (await contexts[index]!.request.get('/api/v1/me')).json()).user.id as string,
    )
  }
  const unitResponse = await authedPost(
    head,
    `/api/v1/departments/${department.departmentId}/units`,
    { name: 'Synthetic actual unit' },
  )
  expect(unitResponse.status()).toBe(201)
  const unit = await unitResponse.json()
  expect(
    (
      await authedPost(head, `/api/v1/departments/${department.departmentId}/unit-roles`, {
        unitId: unit.id,
        userId: userIds[2],
        role: 'member',
      })
    ).status(),
  ).toBe(201)
  const titles = [
    'Synthetic head owned task',
    'Synthetic ordinary owned task',
    'Synthetic unit owned task',
  ]
  const cards: { id: string; assigneeUserId: string }[] = []
  for (let index = 0; index < userIds.length; index += 1) {
    const created = await authedPost(head, '/api/v1/cards', {
      title: titles[index],
      assigneeUserId: userIds[index],
      giverUserId: userIds[0],
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      estimateMin: 60,
    })
    expect(created.status()).toBe(201)
    cards.push(await created.json())
  }
  const page = await head.newPage()
  return {
    head,
    ordinary,
    assigned,
    page,
    userIds,
    cards,
    department,
    unit,
    close: async () => {
      await Promise.all([head.close(), ordinary.close(), assigned.close()])
      expect(external).toEqual([])
    },
  }
}

test('directory distinguishes department leadership from an ordinary unassigned member without editing either membership', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/people')
    const unassigned = f.page
      .locator('section')
      .filter({ has: f.page.getByRole('heading', { name: /^Unassigned/ }) })
    await expect(
      unassigned.getByText('OrdinaryScope Synthetic', { exact: true }).first(),
    ).toBeVisible()
    await expect(unassigned.getByText('HeadScope Synthetic', { exact: true })).toHaveCount(0)
    const leadership = f.page
      .locator('section')
      .filter({ has: f.page.getByRole('heading', { name: /^Department leadership/ }) })
    await expect(leadership.getByText('HeadScope Synthetic', { exact: true }).first()).toBeVisible()
    await f.page.screenshot({ path: testInfo.outputPath('directory-after.png'), fullPage: true })
    await f.page.getByRole('radio', { name: 'Table', exact: true }).check()
    const row = f.page.getByRole('row').filter({ hasText: 'HeadScope Synthetic' })
    await expect(row.getByRole('cell', { name: 'Department-wide', exact: true })).toBeVisible()
    const actual = await (
      await f.head.request.get(`/api/v1/departments/${f.department.departmentId}/roster`)
    ).json()
    expect(
      actual.find((member: { userId: string }) => member.userId === f.userIds[0]).membershipRole,
    ).toBe('head')
    const roles = await (
      await f.head.request.get(`/api/v1/departments/${f.department.departmentId}/unit-roles`)
    ).json()
    expect(roles.map((role: { userId: string }) => role.userId)).toEqual([f.userIds[2]])
  } finally {
    await f.close()
  }
})

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`@head-visual leadership scope fits ${locale} ${theme} at narrow, tablet and enlarged text`, async ({
      browser,
    }, testInfo) => {
      const f = await fixture(browser)
      try {
        const catalog = JSON.parse(
          await readFile(
            resolve(
              import.meta.dirname,
              `../../../../packages/i18n/messages/${locale}.generated.json`,
            ),
            'utf8',
          ),
        ) as { headScope: { leadership: string; departmentWide: string } }
        expect((await authedPatch(f.head, '/api/v1/me', { locale })).status()).toBe(200)
        await f.page.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        await f.page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        const routes = ['/people', '/work', `/people?person=${f.userIds[0]}`, '/analytics']
        const sizes = [
          { width: 320, height: 640, scale: 1 },
          { width: 768, height: 800, scale: 1 },
          { width: 1280, height: 600, scale: 2 },
        ]
        // These ordered actions share one browser's persisted locale/theme and loaded route state.
        for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex += 1) {
          const size = sizes[sizeIndex]!
          await f.page.setViewportSize({ width: size.width, height: size.height })
          for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
            const route = routes[routeIndex]!
            await f.page.goto(route)
            await waitForLoadedRoute(f.page, route)
            await setTextScale(f.page, size.scale)
            if (route === '/people' || route === '/work') {
              const label = f.page.getByText(catalog.headScope.leadership).first()
              await expect(label).toBeVisible()
              const bounds = await label.evaluate((element) => ({
                client: element.clientWidth,
                scroll: element.scrollWidth,
              }))
              expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
            }
            if (route === '/people') {
              for (const name of [
                'HeadScope Synthetic',
                'OrdinaryScope Synthetic',
                'UnitScope Synthetic',
              ]) {
                const label = f.page.locator('p.text-body').filter({ hasText: name }).first()
                const bounds = await label.evaluate((element) => ({
                  client: element.clientWidth,
                  scroll: element.scrollWidth,
                }))
                expect(bounds.scroll, name).toBeLessThanOrEqual(bounds.client + 1)
              }
            }
            if (route.includes('?person=')) {
              await expect(
                f.page.getByText(catalog.headScope.departmentWide, { exact: true }).first(),
              ).toBeVisible()
            }
            await settleCapture(f.page)
            expect(
              await f.page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(size.width + 1)
            await f.page.screenshot({
              path: testInfo.outputPath(`${routeIndex}-${size.width}-${size.scale}.png`),
              fullPage: true,
            })
          }
        }
      } finally {
        await f.close()
      }
    })
  }
}

test('board keeps the head’s own work in department leadership and ordinary unassigned work separate', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/work')
    const leadership = f.page
      .getByRole('heading', { name: 'Department leadership', exact: true })
      .locator('..')
      .locator('..')
    await expect(
      f.page.getByRole('heading', { name: 'Department leadership', exact: true }),
    ).toBeVisible()
    await expect(
      leadership.getByText('Synthetic head owned task', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      f.page.getByText('Synthetic ordinary owned task', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      f.page.getByText('Synthetic unit owned task', { exact: true }).first(),
    ).toBeVisible()
    const card = await (await f.head.request.get(`/api/v1/cards/${f.cards[0]!.id}`)).json()
    expect(card.assigneeUserId).toBe(f.userIds[0])
    expect(card.status).toBe('active')
    await f.page.screenshot({ path: testInfo.outputPath('board-after.png'), fullPage: true })
  } finally {
    await f.close()
  }
})

test('a real optional head unit remains assigned while directory scope and person metadata stay accurate', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.goto(`/people?person=${f.userIds[0]}`)
    await expect(f.page.getByText('Department-wide', { exact: true })).toBeVisible()
    expect(
      (
        await authedPost(f.head, `/api/v1/departments/${f.department.departmentId}/unit-roles`, {
          unitId: f.unit.id,
          userId: f.userIds[0],
          role: 'member',
        })
      ).status(),
    ).toBe(201)
    await f.page.reload()
    await expect(f.page.getByText('Synthetic actual unit', { exact: true })).toBeVisible()
    await f.page.goto('/people')
    const leadership = f.page.getByRole('heading', { name: /^Department leadership/ }).locator('..')
    await expect(leadership.getByText('HeadScope Synthetic', { exact: true }).first()).toBeVisible()
    await f.page.getByRole('button', { name: 'Synthetic actual unit', exact: true }).click()
    await expect(f.page.getByText('HeadScope Synthetic', { exact: true }).first()).toBeVisible()
    await expect(f.page.getByText('UnitScope Synthetic', { exact: true }).first()).toBeVisible()
    await expect(f.page.getByText('OrdinaryScope Synthetic', { exact: true })).toHaveCount(0)
    const roster = await (
      await f.head.request.get(`/api/v1/departments/${f.department.departmentId}/roster`)
    ).json()
    expect(
      roster.find((member: { userId: string }) => member.userId === f.userIds[0]),
    ).toMatchObject({ membershipRole: 'head', unitId: f.unit.id, unitRole: 'member' })
    expect(
      (await (await f.head.request.get(`/api/v1/cards/${f.cards[0]!.id}`)).json()).assigneeUserId,
    ).toBe(f.userIds[0])
  } finally {
    await f.close()
  }
})

test('an ordinary colleague can assign a new card to the head, whose Mine retains it', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const colleague = await f.ordinary.newPage()
    await colleague.goto('/work?new=1')
    const composer = colleague.getByRole('dialog', { name: 'New card', exact: true })
    await composer
      .getByLabel('Title', { exact: true })
      .fill('Synthetic colleague assigned head task')
    const assignee = composer.getByRole('combobox', { name: 'Assignee', exact: true })
    await expect(assignee.locator('option', { hasText: 'HeadScope Synthetic' })).toHaveText(
      'HeadScope Synthetic · Head',
    )
    await assignee.selectOption(f.userIds[0]!)
    const saved = colleague.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/cards',
    )
    await composer.getByRole('button', { name: 'New card', exact: true }).click()
    const receipt = await saved
    expect(receipt.status()).toBe(201)
    const created = await receipt.json()
    expect(
      (await (await f.head.request.get(`/api/v1/cards/${created.id}`)).json()).assigneeUserId,
    ).toBe(f.userIds[0])
    await f.page.goto('/work')
    await f.page.getByRole('radio', { name: 'Mine', exact: true }).check()
    await expect(
      f.page.getByText('Synthetic colleague assigned head task', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      f.page.getByText('Synthetic head owned task', { exact: true }).first(),
    ).toBeVisible()
    await expect(f.page.getByText('Synthetic ordinary owned task', { exact: true })).toHaveCount(0)
    await f.page.reload()
    await expect(
      f.page.getByText('Synthetic colleague assigned head task', { exact: true }).first(),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('directory names remain fully readable at 200 percent text size', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    await f.page.setViewportSize({ width: 1280, height: 600 })
    await f.page.goto('/people')
    await waitForLoadedRoute(f.page, '/people')
    await setTextScale(f.page, 2)
    await settleCapture(f.page)
    await f.page.screenshot({ path: testInfo.outputPath('directory-enlarged.png'), fullPage: true })
    await Promise.all(
      ['HeadScope Synthetic', 'OrdinaryScope Synthetic', 'UnitScope Synthetic'].map(
        async (name) => {
          // The avatar repeats the accessible name in a 1px sr-only span; inspect the visible title.
          const label = f.page.locator('p.text-body').filter({ hasText: name }).first()
          await expect(label).toBeVisible()
          const bounds = await label.evaluate((element) => ({
            client: element.clientWidth,
            scroll: element.scrollWidth,
          }))
          expect(bounds.scroll, name).toBeLessThanOrEqual(bounds.client + 1)
        },
      ),
    )
  } finally {
    await f.close()
  }
})
