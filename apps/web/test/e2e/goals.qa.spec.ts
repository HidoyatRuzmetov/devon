import { test, expect, type Browser, type Page } from '@playwright/test'
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
import { adaptLocalUiDepartmentCookie } from './flow-ui-cookies.js'

async function fixture(browser: Browser) {
  const head = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const external: string[] = []
  await Promise.all(
    [head, admin, member].map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('goals.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic Goals Department',
  })
  await admin.close()
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('goals.member'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  expect(
    (
      await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
        headers: { 'x-csrf-token': await csrfToken(head) },
        data: { features: { goals: true, estimates: true } },
      })
    ).status(),
  ).toBe(200)
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await head.newPage()
  const goals = async (): Promise<
    Array<{
      id: string
      title: string
      version: number
      metric: string
      currentValue: number
      matchedCards: number
      filter: string
      description: string | null
      targetValue: number
      startsOn: string | null
      dueOn: string | null
    }>
  > => {
    const response = await head.request.get('/api/v1/goals')
    expect(response.status()).toBe(200)
    return response.json()
  }
  return {
    head,
    member,
    page,
    department,
    goals,
    close: async () => {
      await Promise.all([head.close(), member.close()])
      expect(external).toEqual([])
    },
  }
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: 'Add a goal', exact: true }).first().click()
  return page.getByRole('dialog', { name: 'New goal', exact: true })
}

test('a zero-card cap visibly reports a real open card over the cap', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    const me = await (await f.head.request.get('/api/v1/me')).json()
    expect(
      (
        await authedPost(f.head, '/api/v1/cards', {
          title: 'Synthetic open card against zero cap',
          assigneeUserId: me.user.id,
        })
      ).status(),
    ).toBe(201)
    await f.page.goto('/goals')
    const dialog = await openCreate(f.page)
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic zero-card cap')
    await dialog.getByLabel('What is counted', { exact: true }).selectOption('open_cards_max')
    await dialog.getByRole('spinbutton', { name: 'Target value', exact: true }).fill('0')
    const write = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
    expect((await write).status()).toBe(201)
    expect((await f.goals())[0]).toMatchObject({
      metric: 'open_cards_max',
      currentValue: 1,
      targetValue: 0,
    })
    const article = f.page.locator('article').filter({
      has: f.page.getByRole('heading', { name: 'Synthetic zero-card cap', exact: true }),
    })
    await expect(article).toBeVisible()
    await f.page.screenshot({ path: testInfo.outputPath('zero-card-cap.png'), fullPage: true })
    await expect(article.getByText('1 over the cap', { exact: true })).toBeVisible()
    await expect(article.getByRole('progressbar').locator('[data-state]')).toHaveClass(
      /bg-destructive/,
    )
  } finally {
    await f.close()
  }
})

test('a goal list read refusal exposes Retry and recovers the authoritative saved goal', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    expect(
      (
        await authedPost(f.head, '/api/v1/goals', {
          title: 'Synthetic read recovery',
          metric: 'cards_done',
          targetValue: 3,
        })
      ).status(),
    ).toBe(201)
    let refuse = true
    await f.page.route('**/api/v1/goals', (route) => {
      if (route.request().method() !== 'GET' || !refuse) return route.continue()
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Synthetic unavailable read',
          status: 503,
          code: 'internal',
        }),
      })
    })
    await f.page.goto('/goals')
    const retry = f.page.getByRole('button', { name: 'Try again', exact: true })
    await expect(retry).toBeVisible()
    refuse = false
    const read = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await retry.click()
    expect((await read).status()).toBe(200)
    await expect(
      f.page.getByRole('heading', { name: 'Synthetic read recovery', exact: true }),
    ).toBeVisible()
    expect(await f.goals()).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('a saved-version reload refusal retains the conflicting draft and allows an explicit recovered reload', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.head, '/api/v1/goals', {
      title: 'Synthetic reload refusal',
      metric: 'cards_done',
      targetValue: 3,
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const original = (await f.goals())[0]!
    await f.page.goto('/goals')
    await f.page
      .getByRole('button', { name: 'Edit the goal Synthetic reload refusal', exact: true })
      .click()
    const dialog = f.page.getByRole('dialog', { name: 'Edit goal', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic conflicting draft retained')
    expect(
      (
        await authedPatch(f.head, `/api/v1/goals/${id}`, {
          title: 'Synthetic latest saved reload',
          version: original.version,
        })
      ).status(),
    ).toBe(204)
    const write = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/goals/${id}`,
    )
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await write).status()).toBe(409)
    let refuse = true
    await f.page.route('**/api/v1/goals', (route) => {
      if (route.request().method() !== 'GET' || !refuse) return route.continue()
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Synthetic unavailable read',
          status: 503,
          code: 'internal',
        }),
      })
    })
    const reload = dialog.getByRole('button', { name: 'Load saved version', exact: true })
    await reload.click()
    await expect(
      f.page.getByText('Could not load the saved goal. Your draft is still here; try again.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic conflicting draft retained',
    )
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect(reload).toBeEnabled()
    refuse = false
    await reload.click()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic latest saved reload',
    )
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    expect((await f.goals())[0]?.title).toBe('Synthetic latest saved reload')
  } finally {
    await f.close()
  }
})

test('all four goal metrics are created through the UI and link to the persisted counted cards', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    const me = await (await f.head.request.get('/api/v1/me')).json()
    const labelResponse = await authedPost(f.head, '/api/v1/labels', { name: 'goal-fixture' })
    expect(labelResponse.status()).toBe(201)
    const label = await labelResponse.json()
    for (let index = 0; index < 3; index += 1) {
      const cardResponse = await authedPost(f.head, '/api/v1/cards', {
        title: `Synthetic counted card ${index}`,
        assigneeUserId: me.user.id,
        labels: [label.id],
        estimateMin: (index + 1) * 60,
        dueAt: new Date(Date.now() + (index === 1 ? -86_400_000 : 86_400_000)).toISOString(),
      })
      expect(cardResponse.status()).toBe(201)
      const card = await cardResponse.json()
      if (index < 2)
        expect(
          (
            await authedPatch(f.head, `/api/v1/cards/${card.id}`, {
              status: 'done',
              version: card.version,
            })
          ).status(),
        ).toBe(200)
    }
    await f.page.goto('/goals')
    const expected = [
      ['cards_done', 2],
      ['on_time_rate', 50],
      ['estimate_hours', 3],
      ['open_cards_max', 1],
    ] as const
    // UI creation and subsequent authoritative reads form one ordered journey in the same department.
    for (let metricIndex = 0; metricIndex < expected.length; metricIndex += 1) {
      const [metric, value] = expected[metricIndex]!
      const dialog = await openCreate(f.page)
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`Synthetic ${metric}`)
      await dialog.getByLabel('What is counted', { exact: true }).selectOption(metric)
      await dialog
        .getByRole('textbox', { name: 'Which cards', exact: true })
        .fill('label:goal-fixture')
      await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
      await expect(dialog).toBeHidden()
      const actual = (await f.goals()).find((goal) => goal.metric === metric)
      expect(actual?.currentValue).toBe(value)
      expect(actual?.matchedCards).toBe(3)
      const article = f.page
        .locator('article')
        .filter({ has: f.page.getByRole('heading', { name: `Synthetic ${metric}`, exact: true }) })
      await expect(
        article.getByRole('link', { name: '3 cards counted', exact: true }),
      ).toHaveAttribute('href', '/work/table?q=label%3Agoal-fixture')
    }
    await f.page.screenshot({ path: testInfo.outputPath('goals-metrics.png'), fullPage: true })
    await f.page
      .locator('article')
      .filter({ hasText: 'Synthetic cards_done' })
      .getByRole('link', { name: '3 cards counted', exact: true })
      .click()
    await expect(f.page).toHaveURL(/\/work\/table\?q=label%3Agoal-fixture/)
    await expect(
      f.page.getByText('Synthetic counted card 2', { exact: true }).first(),
    ).toBeVisible()
    await f.page.goto('/goals')
    await expect(
      f.page.getByRole('heading', { name: 'Synthetic cards_done', exact: true }),
    ).toBeVisible()
    expect(await f.goals()).toHaveLength(4)
  } finally {
    await f.close()
  }
})

test('a stale goal edit is refused and retains the local draft without overwriting a newer saved version', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.head, '/api/v1/goals', {
      title: 'Synthetic version goal',
      metric: 'cards_done',
      targetValue: 10,
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const original = (await f.goals()).find((goal) => goal.id === id)!
    await f.page.goto('/goals')
    await f.page
      .getByRole('button', { name: 'Edit the goal Synthetic version goal', exact: true })
      .click()
    const dialog = f.page.getByRole('dialog', { name: 'Edit goal', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic local unsaved goal')
    expect(
      (
        await authedPatch(f.head, `/api/v1/goals/${id}`, {
          title: 'Synthetic newer saved goal',
          version: original.version,
        })
      ).status(),
    ).toBe(204)
    const write = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/goals/${id}`,
    )
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await write).status()).toBe(409)
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic local unsaved goal',
    )
    expect((await f.goals()).find((goal) => goal.id === id)?.title).toBe(
      'Synthetic newer saved goal',
    )
    await expect(dialog.getByRole('alert')).toContainText('Your draft is still here')
    await dialog.getByRole('button', { name: 'Load saved version', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic newer saved goal',
    )
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic recovered edit')
    const recovered = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/goals/${id}`,
    )
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await recovered).status()).toBe(204)
    await expect(dialog).toBeHidden()
    expect((await f.goals()).find((goal) => goal.id === id)?.title).toBe('Synthetic recovered edit')
  } finally {
    await f.close()
  }
})

test('an older successful create receipt cannot close or erase a newly reopened goal draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release: (() => void) | undefined
  try {
    let captured = false
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.page.route('**/api/v1/goals', async (route) => {
      if (route.request().method() !== 'POST' || captured) return route.continue()
      captured = true
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      await held
      await route.fulfill({ response })
    })
    await f.page.goto('/goals')
    let dialog = await openCreate(f.page)
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic first committed goal')
    const write = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
    await expect
      .poll(async () =>
        (await f.goals()).some((goal) => goal.title === 'Synthetic first committed goal'),
      )
      .toBe(true)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    dialog = await openCreate(f.page)
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic reopened unsaved draft')
    release!()
    expect((await write).status()).toBe(201)
    await expect(dialog.getByRole('button', { name: 'Add a goal', exact: true })).toBeEnabled()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic reopened unsaved draft',
    )
    expect(await f.goals()).toHaveLength(1)
  } finally {
    release?.()
    await f.close()
  }
})

test('a missing target does not silently create a zero-target goal', async ({ browser }) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/goals')
    const dialog = await openCreate(f.page)
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic missing target')
    await dialog.getByRole('spinbutton', { name: 'Target value', exact: true }).fill('')
    await expect(dialog.getByRole('button', { name: 'Add a goal', exact: true })).toBeDisabled()
    expect(await f.goals()).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('an hours goal accepts a fractional target supported by the API', async ({ browser }) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/goals')
    const dialog = await openCreate(f.page)
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic fractional hours')
    await dialog.getByLabel('What is counted', { exact: true }).selectOption('estimate_hours')
    const target = dialog.getByRole('spinbutton', { name: 'Target value', exact: true })
    await target.fill('1.5')
    expect(
      await target.evaluate((element: HTMLInputElement) => element.validity.stepMismatch),
    ).toBe(false)
    const write = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
    expect((await write).status()).toBe(201)
    expect((await f.goals())[0]?.targetValue).toBe(1.5)
  } finally {
    await f.close()
  }
})

test('a member is refused and disabled goals cannot still be edited or deleted', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.head, '/api/v1/goals', {
      title: 'Synthetic disabled goal',
      metric: 'cards_done',
      targetValue: 10,
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const memberPage = await f.member.newPage()
    await memberPage.goto('/goals')
    await expect(
      memberPage.getByRole('heading', { name: 'This page is not open to you', exact: true }),
    ).toBeVisible()
    await expect(
      memberPage.getByText(
        'Only the department head sees and sets goals. Ask your department head if you need access.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(memberPage.getByRole('button', { name: 'Add a goal', exact: true })).toHaveCount(0)
    expect((await f.member.request.get('/api/v1/goals')).status()).toBe(403)
    expect(
      (
        await authedPatch(f.member, `/api/v1/goals/${id}`, { title: 'Refused member edit' })
      ).status(),
    ).toBe(403)
    expect(
      (
        await f.member.request.delete(`/api/v1/goals/${id}`, {
          headers: { 'x-csrf-token': await csrfToken(f.member) },
        })
      ).status(),
    ).toBe(403)
    await memberPage.goto('/work/workload')
    await expect(
      memberPage.getByRole('heading', { name: 'This page is not open to you', exact: true }),
    ).toBeVisible()
    await expect(
      memberPage.getByText(
        'The department workload overview is for the department head. You can see your own workload on Home.',
        { exact: true },
      ),
    ).toBeVisible()
    expect((await f.member.request.get('/api/v1/work/workload')).status()).toBe(403)
    expect(
      (
        await f.head.request.put(`/api/v1/departments/${f.department.departmentId}/features`, {
          headers: { 'x-csrf-token': await csrfToken(f.head) },
          data: { features: { goals: false } },
        })
      ).status(),
    ).toBe(200)
    await f.page.goto('/goals')
    await expect(f.page.getByText('This feature is turned off', { exact: true })).toBeVisible()
    expect((await f.head.request.get('/api/v1/goals')).status()).toBe(404)
    expect
      .soft(
        (
          await authedPost(f.head, '/api/v1/goals', {
            title: 'Refused disabled create',
            metric: 'cards_done',
            targetValue: 10,
          })
        ).status(),
      )
      .toBe(404)
    expect
      .soft(
        (
          await authedPatch(f.head, `/api/v1/goals/${id}`, { title: 'Refused disabled edit' })
        ).status(),
      )
      .toBe(404)
    expect
      .soft(
        (
          await f.head.request.delete(`/api/v1/goals/${id}`, {
            headers: { 'x-csrf-token': await csrfToken(f.head) },
          })
        ).status(),
      )
      .toBe(404)
    expect(
      (
        await f.head.request.put(`/api/v1/departments/${f.department.departmentId}/features`, {
          headers: { 'x-csrf-token': await csrfToken(f.head) },
          data: { features: { goals: true } },
        })
      ).status(),
    ).toBe(200)
    expect((await f.goals()).find((goal) => goal.id === id)?.title).toBe('Synthetic disabled goal')
    await memberPage.getByRole('link', { name: 'Cards', exact: true }).click()
    await expect(memberPage).toHaveURL(/\/work$/)
  } finally {
    await f.close()
  }
})

test('a delete Undo cannot copy the old department goal into a newly selected department', async ({
  browser,
}) => {
  const f = await fixture(browser)
  const admin = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const request = await authedPost(f.head, '/api/v1/departments/requests', {
      name: 'Synthetic second Goals Department',
      units: [],
    })
    expect(request.status()).toBe(201)
    const requestId = (await request.json()).id
    const approval = await admin.request.post(`/api/v1/departments/requests/${requestId}/approve`, {
      headers: { 'x-csrf-token': await csrfToken(admin) },
    })
    expect(approval.status()).toBe(200)
    const second = await approval.json()
    expect(
      (
        await f.head.request.put(`/api/v1/departments/${second.departmentId}/features`, {
          headers: { 'x-csrf-token': await csrfToken(f.head) },
          data: { features: { goals: true } },
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await authedPost(f.head, '/api/v1/goals', {
          title: 'Synthetic first department goal',
          metric: 'cards_done',
          targetValue: 10,
        })
      ).status(),
    ).toBe(201)
    await adaptLocalUiDepartmentCookie(f.head)
    await f.page.goto('/goals')
    await f.page
      .getByRole('button', {
        name: 'Delete the goal “Synthetic first department goal”',
        exact: true,
      })
      .click()
    const undo = f.page.getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toBeVisible()
    await undo.hover()
    await f.page.getByRole('button', { name: 'Switch department', exact: true }).click()
    const switched = f.page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/active-department'),
    )
    await f.page
      .getByRole('button')
      .filter({ hasText: 'Synthetic second Goals Department' })
      .click()
    expect((await switched).status()).toBe(200)
    await expect(
      f.page.getByText('Synthetic second Goals Department', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      f.page.getByRole('heading', { name: 'Synthetic first department goal', exact: true }),
    ).toHaveCount(0)
    const attempts: string[] = []
    f.page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/goals' && request.method() === 'POST')
        attempts.push(request.postData() ?? '')
    })
    await undo.click()
    // A fresh authoritative read after the real click is the final state boundary, not a success toast.
    expect(await f.goals()).toEqual([])
    await f.page.reload()
    expect(await f.goals()).toEqual([])
    expect(attempts).toEqual([])
  } finally {
    await admin.close()
    await f.close()
  }
})

test('delete and Undo recover from a refused restore and persist the preserved goal values', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.head, '/api/v1/goals', {
      title: 'Synthetic restored goal',
      description: 'Synthetic restore description',
      metric: 'cards_done',
      targetValue: 8,
      filter: 'priority:high',
      dueOn: '2027-01-31',
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    await f.page.goto('/goals')
    await f.page
      .getByRole('button', { name: 'Delete the goal “Synthetic restored goal”', exact: true })
      .click()
    await expect.poll(async () => (await f.goals()).length).toBe(0)
    let refused = false
    await f.page.route('**/api/v1/goals', (route) => {
      if (route.request().method() !== 'POST' || refused) return route.continue()
      refused = true
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Unavailable',
          status: 503,
          code: 'internal',
        }),
      })
    })
    const restoreWrite = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await f.page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect((await restoreWrite).status()).toBe(503)
    await expect(f.page.getByText('Could not add the goal', { exact: true })).toBeVisible()
    await f.page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect.poll(async () => (await f.goals()).length).toBe(1)
    const restored = (await f.goals())[0]!
    expect(restored.id).not.toBe(id)
    expect(restored).toMatchObject({
      title: 'Synthetic restored goal',
      description: 'Synthetic restore description',
      metric: 'cards_done',
      targetValue: 8,
      filter: 'priority:high',
      dueOn: '2027-01-31',
    })
    await f.page.reload()
    await expect(f.page.getByRole('heading', { name: restored.title, exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})

test('a refused create retains the draft and the real retry persists it', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    let attempts = 0
    f.page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/goals' && request.method() === 'POST')
        attempts += 1
    })
    let refused = false
    await f.page.route('**/api/v1/goals', (route) => {
      if (route.request().method() !== 'POST' || refused) return route.continue()
      refused = true
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Unavailable',
          status: 503,
          code: 'internal',
        }),
      })
    })
    await f.page.goto('/goals')
    const dialog = await openCreate(f.page)
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic retained create')
    await dialog
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Synthetic retained description')
    await dialog.getByRole('textbox', { name: 'Which cards', exact: true }).fill('priority:high')
    await dialog.getByLabel('Due', { exact: true }).fill('2027-02-01')
    const first = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/goals',
    )
    await f.page.evaluate(() => {
      const events: unknown[] = []
      ;(window as unknown as { goalRetryEvents: unknown[] }).goalRetryEvents = events
      for (const type of [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'submit',
      ]) {
        document.addEventListener(
          type,
          (event) => {
            const target = event.target instanceof Element ? event.target : null
            const button = target?.closest('button')
            if (button?.textContent?.includes('Add a goal') || type === 'submit')
              events.push({
                type,
                target: target?.tagName,
                className: target?.getAttribute('class'),
                overlay: Boolean(target?.closest('.absolute.inset-0')),
                busy: button?.getAttribute('aria-busy'),
                disabled: button instanceof HTMLButtonElement ? button.disabled : null,
                detail: event instanceof MouseEvent ? event.detail : null,
              })
          },
          true,
        )
      }
    })
    await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
    expect((await first).status()).toBe(503)
    await expect(f.page.getByText('Could not add the goal', { exact: true })).toBeVisible()
    expect(attempts).toBe(1)
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic retained create',
    )
    await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      'Synthetic retained description',
    )
    await expect(dialog.getByRole('button', { name: 'Add a goal', exact: true })).toBeEnabled()
    const retry = f.page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/goals',
      )
      .catch(() => null)
    await dialog.getByRole('button', { name: 'Add a goal', exact: true }).click()
    try {
      await expect
        .poll(() => attempts, { message: 'The retry actually submits its own POST' })
        .toBe(2)
    } catch (error) {
      await testInfo.attach('retry-pointer-events.json', {
        contentType: 'application/json',
        body: JSON.stringify(
          await f.page.evaluate(
            () => (window as unknown as { goalRetryEvents: unknown[] }).goalRetryEvents,
          ),
          null,
          2,
        ),
      })
      // Diagnostic only: prove the same still-valid form can submit through its keyboard path,
      // then retain the original failed pointer assertion rather than treating recovery as a pass.
      await dialog.getByRole('button', { name: 'Add a goal', exact: true }).focus()
      await f.page.keyboard.press('Enter')
      expect((await retry)?.status()).toBe(201)
      expect((await f.goals())[0]?.title).toBe('Synthetic retained create')
      throw error
    }
    expect((await retry)?.status()).toBe(201)
    const nativeEvents = await f.page.evaluate(
      () =>
        (window as unknown as { goalRetryEvents: Array<{ type: string; overlay: boolean }> })
          .goalRetryEvents,
    )
    expect(
      nativeEvents.filter((event) => event.type === 'pointerdown').every((event) => !event.overlay),
    ).toBe(true)
    await testInfo.attach('retry-pointer-events.json', {
      contentType: 'application/json',
      body: JSON.stringify(nativeEvents, null, 2),
    })
    await expect(dialog).toBeHidden()
    expect((await f.goals())[0]).toMatchObject({
      title: 'Synthetic retained create',
      description: 'Synthetic retained description',
      filter: 'priority:high',
      dueOn: '2027-02-01',
    })
  } finally {
    await f.close()
  }
})
