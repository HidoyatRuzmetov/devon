import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  authedPost,
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  login,
  stripSecureCookies,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { adaptLocalUiSessionCookies } from './flow-ui-cookies.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { visualLabel } from './visual-label.js'
import { setTextScale, settleCapture } from './platform-capture.js'
import type { Locale } from '@devon/i18n'

async function fixture(browser: Browser) {
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const username = uniqueLogin('period.timer')
    const password = examplePassword()
    await createApprovedDepartment(context, admin, {
      headLogin: username,
      headPassword: password,
      departmentName: 'Synthetic periods and timer QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    await context.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
    const foreign: string[] = []
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === FLOW_WEB_BASE_URL) await route.continue()
      else {
        foreign.push(url.hostname)
        await route.abort('blockedbyclient')
      }
    })
    const page = await context.newPage()
    await adaptLocalUiSessionCookies(context)
    return {
      context,
      page,
      username,
      password,
      admin,
      close: async () => {
        await Promise.all([context.close(), admin.close()])
        expect(foreign).toEqual([])
      },
    }
  } catch (error) {
    await Promise.all([context.close(), admin.close()])
    throw error
  }
}

async function openTimer(page: Page) {
  await page.goto('/personal')
  await page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start focus', exact: true })).toBeVisible()
}

async function createPeriod(page: Page, goal: string) {
  await page.goto('/personal')
  await page.getByRole('tab', { name: 'Periods', exact: true }).click()
  await page
    .getByRole('heading', { name: 'Active periods', exact: true })
    .locator('..')
    .getByRole('button', { name: 'New period', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'New period', exact: true })
  await dialog.getByRole('textbox', { name: 'Goal', exact: true }).fill(goal)
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/personal/sprints' && r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Create period', exact: true }).click()
  expect((await saved).status()).toBe(201)
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText(goal, { exact: true })).toBeVisible()
  return page.getByRole('listitem').filter({ has: page.getByText(goal, { exact: true }) })
}

test('failed timer start reports failure without claiming a running session', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await openTimer(f.page)
    await f.page.route('**/api/v1/personal/pomodoro/sessions', async (route) => {
      if (route.request().method() === 'POST') await route.abort('connectionfailed')
      else await route.continue()
    })
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (r) =>
        r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    })
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    await failed
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('button', { name: 'Start focus', exact: true })).toBeEnabled()
    expect(
      await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json(),
    ).toEqual([])
    expect(
      await f.page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('devon.personal.pomodoro.v1.'))
          .map(([, value]) => JSON.parse(value).phase),
      ),
    ).toEqual(['idle'])
  } finally {
    await f.close()
  }
})

test('real held start and finish receipts remain pending across panel/widget tab remounts', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let releaseStart!: () => void
  let releaseEnd!: () => void
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  const endGate = new Promise<void>((resolve) => {
    releaseEnd = resolve
  })
  let startReceived!: () => void
  let endReceived!: () => void
  const startCommitted = new Promise<void>((resolve) => {
    startReceived = resolve
  })
  const endCommitted = new Promise<void>((resolve) => {
    endReceived = resolve
  })
  let starts = 0
  let ends = 0
  try {
    await openTimer(f.page)
    await f.page.route('**/api/v1/personal/pomodoro/sessions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      starts += 1
      const actual = await route.fetch()
      expect(actual.status()).toBe(201)
      startReceived()
      await startGate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    await startCommitted
    expect(
      await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json(),
    ).toHaveLength(1)
    await expect(f.page.getByRole('button', { name: 'Start focus', exact: true })).toBeDisabled()
    await f.page.getByRole('button', { name: 'Pomodoro timer', exact: true }).click()
    const buttons = f.page.getByRole('button', { name: 'Start focus', exact: true })
    await expect(buttons).toHaveCount(2)
    for (const button of await buttons.all()) await expect(button).toBeDisabled()
    await f.page.keyboard.press('Escape')
    await f.page.getByRole('tab', { name: 'Periods', exact: true }).click()
    const started = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    releaseStart()
    expect((await started).status()).toBe(201)
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
    await f.page.route('**/api/v1/personal/pomodoro/sessions/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      ends += 1
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      endReceived()
      await endGate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await endCommitted
    await expect(f.page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    await f.page.getByRole('button', { name: 'Pomodoro timer', exact: true }).click()
    const stops = f.page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stops).toHaveCount(2)
    for (const stop of await stops.all()) await expect(stop).toBeDisabled()
    await f.page.keyboard.press('Escape')
    await f.page.getByRole('tab', { name: 'Periods', exact: true }).click()
    const ended = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    releaseEnd()
    expect((await ended).status()).toBe(200)
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    await expect(
      f.page
        .getByRole('tabpanel', { name: 'Pomodoro', exact: true })
        .getByRole('button', { name: 'Start focus', exact: true }),
    ).toBeEnabled()
    const rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows).toHaveLength(1)
    expect(rows[0].endedAt).not.toBeNull()
    expect(starts).toBe(1)
    expect(ends).toBe(1)
  } finally {
    releaseStart()
    releaseEnd()
    await f.close()
  }
})

test('a lost actual start response recovers the exact committed session without another POST', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let starts = 0
  try {
    await openTimer(f.page)
    await f.page.route('**/api/v1/personal/pomodoro/sessions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      starts += 1
      const actual = await route.fetch()
      expect(actual.status()).toBe(201)
      await route.abort('connectionfailed')
    })
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    const rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows).toHaveLength(1)
    const stored = await f.page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith('devon.personal.pomodoro.v1.'))
        .map(([, value]) => JSON.parse(value)),
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].sessionId).toBe(rows[0].id)
    expect(starts).toBe(1)
    await f.page.unroute('**/api/v1/personal/pomodoro/sessions')
    const ended = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await ended).status()).toBe(200)
  } finally {
    await f.close()
  }
})

for (const action of ['start', 'finish', 'settings'] as const) {
  test(`late actual ${action} receipt cannot enter a different account's timer or settings cache`, async ({
    browser,
  }) => {
    const f = await fixture(browser)
    const second = await newFlowContext(browser)
    const probe = await newFlowContext(browser)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let received!: () => void
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    try {
      const otherLogin = uniqueLogin('period.other')
      const otherPassword = examplePassword()
      await createApprovedDepartment(second, f.admin, {
        headLogin: otherLogin,
        headPassword: otherPassword,
        departmentName: 'Synthetic other timer owner',
      })
      expect((await authedPatch(second, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      await login(probe, { login: f.username, password: f.password })
      await openTimer(f.page)
      if (action === 'finish') {
        const created = f.page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
        )
        await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
        expect((await created).status()).toBe(201)
        await expect(f.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      }
      const pattern =
        action === 'settings'
          ? '**/api/v1/personal/pomodoro/settings'
          : action === 'start'
            ? '**/api/v1/personal/pomodoro/sessions'
            : '**/api/v1/personal/pomodoro/sessions/*'
      const method = action === 'start' ? 'POST' : 'PATCH'
      let holdFirst = true
      await f.page.route(pattern, async (route) => {
        if (route.request().method() !== method || !holdFirst) return route.continue()
        holdFirst = false
        const actual = await route.fetch()
        expect(actual.status()).toBe(action === 'start' ? 201 : 200)
        received()
        await gate
        await route.fulfill({ response: actual })
      })
      if (action === 'settings') {
        await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
        const field = f.page
          .getByRole('dialog', { name: 'Pomodoro settings', exact: true })
          .getByRole('spinbutton', { name: 'Focus (minutes)', exact: true })
        await field.fill('30')
        await field.press('Tab')
        await committed
        await f.page.keyboard.press('Escape')
      } else {
        await f.page
          .getByRole('button', { name: action === 'start' ? 'Start focus' : 'Stop', exact: true })
          .click()
        await committed
      }
      await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
      await f.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
      await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
      await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(otherLogin)
      await f.page.getByLabel('Password', { exact: true }).fill(otherPassword)
      await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
      await stripSecureCookies(f.context)
      await f.page.getByRole('link', { name: 'Personal', exact: true }).click()
      await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
      await expect(f.page.getByRole('button', { name: 'Start focus', exact: true })).toBeEnabled()
      const current = f.page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
      )
      await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
      expect((await current).status()).toBe(201)
      await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
      const late = f.page.waitForResponse(
        (r) =>
          r.request().method() === method &&
          (action === 'settings'
            ? new URL(r.url()).pathname.endsWith('/pomodoro/settings')
            : action === 'start'
              ? new URL(r.url()).pathname.endsWith('/pomodoro/sessions')
              : new URL(r.url()).pathname.includes('/pomodoro/sessions/')),
      )
      release()
      expect((await late).status()).toBe(action === 'start' ? 201 : 200)
      await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
      const ownRows = await (
        await f.context.request.get('/api/v1/personal/pomodoro/sessions')
      ).json()
      expect(ownRows).toHaveLength(1)
      const owner = (await (await f.context.request.get('/api/v1/me')).json()).user.id
      const state = await f.page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`devon.personal.pomodoro.v1.${id}`) ?? 'null'),
        owner,
      )
      expect(state.sessionId).toBe(ownRows[0].id)
      expect(state.phase).toBe('focus')
      if (action === 'settings') {
        await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
        await expect(
          f.page
            .getByRole('dialog', { name: 'Pomodoro settings', exact: true })
            .getByRole('spinbutton', { name: 'Focus (minutes)', exact: true }),
        ).toHaveValue('25')
        expect(
          (await (await probe.request.get('/api/v1/personal/pomodoro/settings')).json()).focusMin,
        ).toBe(30)
        await f.page.keyboard.press('Escape')
      } else
        expect(
          await (await probe.request.get('/api/v1/personal/pomodoro/sessions')).json(),
        ).toHaveLength(1)
      const ended = f.page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
      )
      await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
      expect((await ended).status()).toBe(200)
    } finally {
      release()
      await Promise.all([second.close(), probe.close()])
      await f.close()
    }
  })
}

test('failed timer Stop remains retryable and cannot silently leave the server session open', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await openTimer(f.page)
    const created = f.page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/pomodoro/sessions') && r.request().method() === 'POST',
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(f.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await f.page.route('**/api/v1/personal/pomodoro/sessions/*', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('connectionfailed')
      else await route.continue()
    })
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (r) =>
        r.method() === 'PATCH' && new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    })
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await failed
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
    const sessions = await (
      await f.context.request.get('/api/v1/personal/pomodoro/sessions')
    ).json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].endedAt).toBeNull()
    await f.page.unroute('**/api/v1/personal/pomodoro/sessions/*')
    const ended = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await ended).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Start focus', exact: true })).toBeVisible()
    const persisted = await (
      await f.context.request.get('/api/v1/personal/pomodoro/sessions')
    ).json()
    expect(persisted[0].endedAt).not.toBeNull()
    expect(persisted[0].completed).toBe(false)
  } finally {
    await f.close()
  }
})

test('failed timer settings save keeps a visibly unsaved draft and permits an actual retry', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await openTimer(f.page)
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const field = sheet.getByRole('spinbutton', { name: 'Focus (minutes)', exact: true })
    await expect(field).toHaveValue('25')
    await f.page.route('**/api/v1/personal/pomodoro/settings', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('connectionfailed')
      else await route.continue()
    })
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (r) =>
        r.method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
    })
    await field.fill('30')
    await field.press('Tab')
    await failed
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(field).toHaveValue('30')
    await expect(sheet.getByRole('alert')).toHaveText('Could not save. Your draft is still here.')
    expect(
      (await (await f.context.request.get('/api/v1/personal/pomodoro/settings')).json()).focusMin,
    ).toBe(25)
    await f.page.unroute('**/api/v1/personal/pomodoro/settings')
    const saved = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet.getByRole('button', { name: 'Retry save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    expect(
      (await (await f.context.request.get('/api/v1/personal/pomodoro/settings')).json()).focusMin,
    ).toBe(30)
  } finally {
    await f.close()
  }
})

test('session log read failure is distinguishable from an empty log and retries actual data', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.route('**/api/v1/personal/pomodoro/sessions?*', async (route) => {
      if (route.request().method() === 'GET') await route.abort('connectionfailed')
      else await route.continue()
    })
    await openTimer(f.page)
    const section = f.page.getByRole('heading', { name: 'Session log', exact: true }).locator('..')
    await expect(section.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(section.getByText('No sessions yet', { exact: true })).toHaveCount(0)
    await f.page.unroute('**/api/v1/personal/pomodoro/sessions?*')
    await section.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(section.getByText('No sessions yet', { exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})

test('period completion failure shows feedback and preserves the active period for retry', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const goal = `Synthetic period completion ${uniqueLogin('goal')}`
    const card = await createPeriod(f.page, goal)
    await f.page.route('**/api/v1/personal/sprints/*', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('connectionfailed')
      else await route.continue()
    })
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (r) =>
        r.method() === 'PATCH' && new URL(r.url()).pathname.includes('/personal/sprints/'),
    })
    await card.getByRole('button', { name: 'Mark complete', exact: true }).click()
    await failed
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    expect(
      (await (await f.context.request.get('/api/v1/personal/sprints')).json()).find(
        (s: { goal: string }) => s.goal === goal,
      ).status,
    ).toBe('active')
    await f.page.unroute('**/api/v1/personal/sprints/*')
    const saved = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/personal/sprints/'),
    )
    await card.getByRole('button', { name: 'Mark complete', exact: true }).click()
    expect((await saved).status()).toBe(200)
    expect(
      (await (await f.context.request.get('/api/v1/personal/sprints')).json()).find(
        (s: { goal: string }) => s.goal === goal,
      ).status,
    ).toBe('completed')
  } finally {
    await f.close()
  }
})

test('custom periods offer an actual date range instead of an uneditable default day', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/personal')
    await f.page.getByRole('tab', { name: 'Periods', exact: true }).click()
    await f.page
      .getByRole('heading', { name: 'Active periods', exact: true })
      .locator('..')
      .getByRole('button', { name: 'New period', exact: true })
      .click()
    const dialog = f.page.getByRole('dialog', { name: 'New period', exact: true })
    await dialog.getByRole('button', { name: 'Custom', exact: true }).click()
    await expect(dialog.getByLabel('Starts', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Ends', { exact: true })).toBeVisible()
    await dialog.getByLabel('Starts', { exact: true }).fill('2026-11-05T09:00')
    await dialog.getByLabel('Ends', { exact: true }).fill('2026-11-04T09:00')
    await dialog.getByRole('button', { name: 'Create period', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Choose an end time later than the start time.',
    )
    expect(await (await f.context.request.get('/api/v1/personal/sprints')).json()).toEqual([])
    await dialog.getByLabel('Ends', { exact: true }).fill('2026-11-07T17:00')
    const goal = uniqueLogin('custom.period')
    await dialog.getByRole('textbox', { name: 'Goal', exact: true }).fill(goal)
    const created = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/personal/sprints'),
    )
    await dialog.getByRole('button', { name: 'Create period', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(dialog).not.toBeVisible()
    let periods = await (await f.context.request.get('/api/v1/personal/sprints')).json()
    expect(periods).toHaveLength(1)
    expect(Date.parse(periods[0].endsAt) - Date.parse(periods[0].startsAt)).toBe(56 * 3_600_000)
    const card = f.page
      .getByRole('listitem')
      .filter({ has: f.page.getByText(goal, { exact: true }) })
    await card.getByRole('button', { name: 'Edit period', exact: true }).click()
    const edit = f.page.getByRole('dialog', { name: 'Edit period', exact: true })
    await edit.getByRole('textbox', { name: 'Goal', exact: true }).fill(`${goal} edited`)
    await edit.getByLabel('Ends', { exact: true }).fill('2026-11-08T09:00')
    await f.page.route('**/api/v1/personal/sprints/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue(),
    )
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(edit.getByRole('alert')).toHaveText('Could not save. Your draft is still here.')
    await expect(edit.getByRole('textbox', { name: 'Goal', exact: true })).toHaveValue(
      `${goal} edited`,
    )
    expect((await (await f.context.request.get('/api/v1/personal/sprints')).json())[0].goal).toBe(
      goal,
    )
    await f.page.unroute('**/api/v1/personal/sprints/*')
    const saved = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/personal/sprints/'),
    )
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(edit).not.toBeVisible()
    periods = await (await f.context.request.get('/api/v1/personal/sprints')).json()
    expect(periods[0].goal).toBe(`${goal} edited`)
    expect(Date.parse(periods[0].endsAt) - Date.parse(periods[0].startsAt)).toBe(72 * 3_600_000)
    const sourceId = periods[0].id
    const open = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: 'Synthetic unfinished parent',
      sprintId: sourceId,
    })
    expect(open.status()).toBe(201)
    const parent = await open.json()
    const child = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: 'Synthetic unfinished child',
      sprintId: sourceId,
      parentId: parent.id,
    })
    expect(child.status()).toBe(201)
    const done = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: 'Synthetic completed task',
      sprintId: sourceId,
    })
    expect(done.status()).toBe(201)
    const doneTask = await done.json()
    expect(
      (
        await authedPatch(f.context, `/api/v1/personal/tasks/${doneTask.id}`, {
          done: true,
          version: doneTask.version,
        })
      ).status(),
    ).toBe(200)
    await f.page.reload()
    await f.page.getByRole('tab', { name: 'Periods', exact: true }).click()
    const current = f.page
      .getByRole('listitem')
      .filter({ has: f.page.getByText(`${goal} edited`, { exact: true }) })
    await f.page.route('**/api/v1/personal/sprints/*/rollover', (route) =>
      route.abort('connectionfailed'),
    )
    await current.getByRole('button', { name: 'Roll over', exact: true }).click()
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    expect((await (await f.context.request.get('/api/v1/personal/sprints')).json())[0].status).toBe(
      'active',
    )
    await f.page.unroute('**/api/v1/personal/sprints/*/rollover')
    const rolled = f.page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/rollover'),
    )
    await current.getByRole('button', { name: 'Roll over', exact: true }).click()
    expect((await rolled).status()).toBe(200)
    periods = await (await f.context.request.get('/api/v1/personal/sprints')).json()
    expect(periods).toHaveLength(2)
    expect(periods.find((p: { id: string }) => p.id === sourceId).status).toBe('completed')
    const next = periods.find((p: { id: string }) => p.id !== sourceId)
    expect(Date.parse(next.endsAt) - Date.parse(next.startsAt)).toBe(72 * 3_600_000)
    const tasks = await (await f.context.request.get('/api/v1/personal/tasks')).json()
    expect(tasks.find((task: { id: string }) => task.id === parent.id).sprintId).toBe(next.id)
    expect(tasks.find((task: { parentId: string }) => task.parentId === parent.id).sprintId).toBe(
      next.id,
    )
    expect(tasks.find((task: { id: string }) => task.id === doneTask.id).sprintId).toBe(sourceId)
  } finally {
    await f.close()
  }
})

async function setTimerNumber(page: Page, label: string, value: string) {
  const sheet = page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
  )
  const field = sheet.getByRole('spinbutton', { name: label, exact: true })
  await field.fill(value)
  await field.press('Tab')
  expect((await saved).status()).toBe(200)
  await expect(field).toBeEnabled()
}

test('failed automatic timer completion survives reload and retries the original completed receipt', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.clock.install({ time: new Date(Date.now() - 120_000) })
    await openTimer(f.page)
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    await setTimerNumber(f.page, 'Focus (minutes)', '1')
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const silent = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet.getByRole('button', { name: 'Silent', exact: true }).click()
    expect((await silent).status()).toBe(200)
    await f.page.keyboard.press('Escape')
    const created = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await f.page.route('**/api/v1/personal/pomodoro/sessions/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue(),
    )
    const failed = f.page.waitForEvent('requestfailed', {
      predicate: (r) =>
        r.method() === 'PATCH' && new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    })
    await f.page.clock.runFor(61_000)
    await failed
    await expect(f.page.getByRole('alert')).toHaveText('Could not save. Your draft is still here.')
    const owner = (await (await f.context.request.get('/api/v1/me')).json()).user.id
    const intent = await f.page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`devon.personal.pomodoro.v1.${id}`)!).pendingEnd,
      owner,
    )
    expect(intent.completed).toBe(true)
    expect(
      (await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json())[0].endedAt,
    ).toBeNull()
    await f.page.reload()
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    await expect(f.page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled()
    await expect(f.page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible()
    await f.page.unroute('**/api/v1/personal/pomodoro/sessions/*')
    const saved = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Retry save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    const rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows).toHaveLength(1)
    expect(rows[0].completed).toBe(true)
    expect(rows[0].endedAt).toBe(intent.endedAt)
    await expect(f.page.getByRole('button', { name: 'Start focus', exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})

test('timer settings expose invalid range, preserve failed drafts and allow explicit Revert', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await openTimer(f.page)
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const field = sheet.getByRole('spinbutton', { name: 'Focus (minutes)', exact: true })
    let writes = 0
    f.page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/pomodoro/settings'))
        writes += 1
    })
    await field.fill('0')
    await field.press('Tab')
    await expect(sheet.getByRole('alert')).toHaveText('Enter a whole number from 1 to 180.')
    await expect(field).toHaveValue('0')
    expect(writes).toBe(0)
    expect(
      (await (await f.context.request.get('/api/v1/personal/pomodoro/settings')).json()).focusMin,
    ).toBe(25)
    await f.page.route('**/api/v1/personal/pomodoro/settings', (route) =>
      route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue(),
    )
    await field.fill('30')
    await field.press('Tab')
    await expect(sheet.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible()
    await expect(field).toHaveValue('30')
    await sheet.getByRole('button', { name: 'Revert to saved settings', exact: true }).click()
    await expect(field).toHaveValue('25')
    await expect(sheet.getByRole('alert')).toHaveCount(0)
    expect(writes).toBe(1)
  } finally {
    await f.close()
  }
})

test('actual UI focus completes once with pause, resume, auto long break, skip, short break and Stop', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.clock.install({ time: new Date(Date.now() - 120_000) })
    await openTimer(f.page)
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    await setTimerNumber(f.page, 'Focus (minutes)', '1')
    await setTimerNumber(f.page, 'Short break (minutes)', '1')
    await setTimerNumber(f.page, 'Long break (minutes)', '1')
    await setTimerNumber(f.page, 'Focus sessions before a long break', '1')
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const sound = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet.getByRole('button', { name: 'Silent', exact: true }).click()
    expect((await sound).status()).toBe(200)
    const auto = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet
      .getByRole('checkbox', { name: 'Start the next phase automatically', exact: true })
      .check()
    expect((await auto).status()).toBe(200)
    await f.page.keyboard.press('Escape')
    const created = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(f.page.getByText('In progress', { exact: true })).toBeVisible()
    await f.page.clock.runFor(20_000)
    await f.page.getByRole('button', { name: 'Pause', exact: true }).click()
    const ring = f.page
      .getByRole('tabpanel', { name: 'Pomodoro', exact: true })
      .getByRole('progressbar', { name: 'Focus', exact: true })
    const pausedText = await ring.textContent()
    await f.page.clock.runFor(10_000)
    await expect(ring).toHaveText(pausedText!)
    await f.page.getByRole('button', { name: 'Resume', exact: true }).click()
    const ended = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.clock.runFor(40_100)
    expect((await ended).status()).toBe(200)
    await expect(
      f.page
        .getByRole('tabpanel', { name: 'Pomodoro', exact: true })
        .getByRole('progressbar', { name: 'Long break', exact: true }),
    ).toBeVisible()
    let rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows).toHaveLength(2)
    expect(rows.find((row: { kind: string }) => row.kind === 'focus').completed).toBe(true)
    expect(rows.find((row: { kind: string }) => row.kind === 'long_break').endedAt).toBeNull()
    const skipped = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Skip', exact: true }).click()
    expect((await skipped).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Start break', exact: true })).toBeVisible()
    const short = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start break', exact: true }).click()
    expect((await short).status()).toBe(201)
    const stopped = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await stopped).status()).toBe(200)
    rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows).toHaveLength(3)
    expect(rows.filter((row: { completed: boolean }) => row.completed)).toHaveLength(1)
    expect(rows.every((row: { endedAt: string | null }) => row.endedAt !== null)).toBe(true)
    await f.page.reload()
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    await expect(f.page.getByText('Completed', { exact: true })).toHaveCount(1)
    await expect(f.page.getByText('Skipped', { exact: true })).toHaveCount(2)
  } finally {
    await f.close()
  }
})

test('Today rolls a custom period into the same chosen duration', async ({ browser }) => {
  const f = await fixture(browser)
  try {
    const now = Date.now()
    const created = await authedPost(f.context, '/api/v1/personal/sprints', {
      kind: 'custom',
      goal: uniqueLogin('today.custom'),
      startsAt: new Date(now - 96 * 3_600_000).toISOString(),
      endsAt: new Date(now - 24 * 3_600_000).toISOString(),
    })
    expect(created.status()).toBe(201)
    const source = await created.json()
    await f.page.goto('/personal')
    await f.page.getByRole('tab', { name: 'Today', exact: true }).click()
    const saved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/sprints/${source.id}/rollover`),
    )
    await f.page.getByRole('button', { name: 'Roll over', exact: true }).click()
    expect((await saved).status()).toBe(200)
    const periods = await (await f.context.request.get('/api/v1/personal/sprints')).json()
    const next = periods.find((period: { id: string }) => period.id !== source.id)
    expect(Date.parse(next.endsAt) - Date.parse(next.startsAt)).toBe(72 * 3_600_000)
  } finally {
    await f.close()
  }
})

test('Today selected task remains linked when focus starts from the full Pomodoro panel', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: uniqueLogin('selected.focus'),
    })
    expect(created.status()).toBe(201)
    const task = await created.json()
    await f.page.goto('/personal')
    const row = f.page
      .getByRole('listitem')
      .filter({ has: f.page.getByText(task.title, { exact: true }) })
    await row.getByRole('button', { name: 'Focus', exact: true }).click()
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    const saved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await saved).status()).toBe(201)
    const sessions = await (
      await f.context.request.get('/api/v1/personal/pomodoro/sessions')
    ).json()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].taskId).toBe(task.id)
  } finally {
    await f.close()
  }
})

test('a focus session completes while the user works on another application route', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.clock.install({ time: new Date(Date.now() - 120_000) })
    await openTimer(f.page)
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    await setTimerNumber(f.page, 'Focus (minutes)', '1')
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const settingsSaved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet.getByRole('button', { name: 'Silent', exact: true }).click()
    expect((await settingsSaved).status()).toBe(200)
    await f.page.keyboard.press('Escape')
    const start = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await start).status()).toBe(201)
    await f.page.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(f.page).toHaveURL('/')
    await f.page.clock.fastForward(61_000)
    await expect
      .poll(
        async () => {
          const rows = await (
            await f.context.request.get('/api/v1/personal/pomodoro/sessions')
          ).json()
          expect(rows).toHaveLength(1)
          return rows[0].completed && rows[0].endedAt !== null
        },
        { message: 'The actual started session completed while Home stayed mounted' },
      )
      .toBe(true)
    await expect(f.page).toHaveURL('/')
  } finally {
    await f.close()
  }
})

test('automatic focus and break transitions retain the started task after another Today selection', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: uniqueLogin('captured.focus'),
    })
    const other = await authedPost(f.context, '/api/v1/personal/tasks', {
      title: uniqueLogin('later.focus'),
    })
    expect(created.status()).toBe(201)
    expect(other.status()).toBe(201)
    const task = await created.json()
    const otherTask = await other.json()
    await f.page.clock.install({ time: new Date(Date.now() - 120_000) })
    await f.page.goto('/personal')
    await f.page
      .getByRole('listitem')
      .filter({ has: f.page.getByText(task.title, { exact: true }) })
      .getByRole('button', { name: 'Focus', exact: true })
      .click()
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    await f.page.getByRole('button', { name: 'Pomodoro settings', exact: true }).click()
    await setTimerNumber(f.page, 'Focus (minutes)', '1')
    await setTimerNumber(f.page, 'Long break (minutes)', '1')
    await setTimerNumber(f.page, 'Focus sessions before a long break', '1')
    const sheet = f.page.getByRole('dialog', { name: 'Pomodoro settings', exact: true })
    const silent = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet.getByRole('button', { name: 'Silent', exact: true }).click()
    expect((await silent).status()).toBe(200)
    const auto = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/settings'),
    )
    await sheet
      .getByRole('checkbox', { name: 'Start the next phase automatically', exact: true })
      .check()
    expect((await auto).status()).toBe(200)
    await f.page.keyboard.press('Escape')
    const saved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Start focus', exact: true }).click()
    expect((await saved).status()).toBe(201)
    await f.page.getByRole('tab', { name: 'Today', exact: true }).click()
    await f.page
      .getByRole('listitem')
      .filter({ has: f.page.getByText(otherTask.title, { exact: true }) })
      .getByRole('button', { name: 'Focus', exact: true })
      .click()
    await f.page.clock.fastForward(61_000)
    await expect
      .poll(
        async () =>
          (await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()).length,
      )
      .toBe(2)
    let rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    expect(rows.find((row: { kind: string }) => row.kind === 'focus').taskId).toBe(task.id)
    expect(rows.find((row: { kind: string }) => row.kind === 'focus').completed).toBe(true)
    expect(rows.find((row: { kind: string }) => row.kind === 'long_break').taskId).toBeNull()
    await f.page.clock.fastForward(61_000)
    await expect
      .poll(
        async () =>
          (await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()).length,
      )
      .toBe(3)
    rows = await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json()
    const active = rows.find((row: { endedAt: string | null }) => row.endedAt === null)
    expect(active.kind).toBe('focus')
    expect(active.taskId).toBe(task.id)
    await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
    const ended = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.includes('/pomodoro/sessions/'),
    )
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await ended).status()).toBe(200)
  } finally {
    await f.close()
  }
})

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const satisfies readonly Locale[]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`period and timer nested controls remain readable ${locale} ${theme}`, async ({
      browser,
    }, info) => {
      const f = await fixture(browser)
      const label = (key: string) => visualLabel('personal', locale, `personal.${key}`)
      const captureDir = join(
        import.meta.dirname,
        '../../../../artifacts/qa/2026-10/period-timer/pixels',
      )
      mkdirSync(captureDir, { recursive: true })
      try {
        expect((await authedPatch(f.context, '/api/v1/me', { locale })).status()).toBe(200)
        await f.context.addCookies([{ name: 'wp_locale', value: locale, url: FLOW_WEB_BASE_URL }])
        await f.context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        await f.page.goto('/personal')
        await expect(f.page.locator('html')).toHaveAttribute('data-theme', theme)
        const viewports = [
          { width: 320, height: 800, scale: 1 },
          { width: 768, height: 384, scale: 2 },
        ]
        // The second viewport resumes the same paused session; these actions share one page.
        for (let index = 0; index < viewports.length; index += 1) {
          const viewport = viewports[index]!
          await f.page.setViewportSize(viewport)
          await setTextScale(f.page, viewport.scale)
          await f.page.getByRole('tab', { name: label('tabs.sprints'), exact: true }).click()
          const trigger = f.page
            .getByRole('heading', { name: label('sprints.active.title'), exact: true })
            .locator('..')
            .getByRole('button', { name: label('sprints.create.action'), exact: true })
          await trigger.focus()
          await f.page.keyboard.press('Enter')
          const dialog = f.page.getByRole('dialog', {
            name: label('sprints.create.title'),
            exact: true,
          })
          await dialog
            .getByRole('button', { name: label('sprints.kind.custom'), exact: true })
            .click()
          await expect(dialog.getByLabel(label('sprints.starts'), { exact: true })).toBeVisible()
          await expect(dialog.getByLabel(label('sprints.ends'), { exact: true })).toBeVisible()
          await dialog.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }))
          await settleCapture(f.page, false)
          const name = `${info.project.name}-${locale}-${theme}-${viewport.width}-${viewport.scale}`
          await f.page.screenshot({ path: join(captureDir, `${name}-custom.png`) })
          expect(
            await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          ).toBe(true)
          const submit = dialog.getByRole('button', {
            name: label('sprints.create.submit'),
            exact: true,
          })
          await submit.scrollIntoViewIfNeeded()
          await expect(submit).toBeVisible()
          await f.page.screenshot({ path: join(captureDir, `${name}-custom-bottom.png`) })
          await f.page.keyboard.press('Escape')
          await expect(trigger).toBeFocused()
          await f.page.getByRole('tab', { name: label('tabs.pomodoro'), exact: true }).click()
          const settings = f.page.getByRole('button', {
            name: label('pomodoro.settings.title'),
            exact: true,
          })
          await settings.focus()
          await f.page.keyboard.press('Enter')
          const sheet = f.page.getByRole('dialog', {
            name: label('pomodoro.settings.title'),
            exact: true,
          })
          const number = sheet.getByRole('spinbutton', {
            name: label('pomodoro.settings.focusMin'),
            exact: true,
          })
          await number.fill('0')
          await number.press('Tab')
          await expect(number).toHaveAttribute('aria-invalid', 'true')
          await expect(sheet.getByRole('alert')).toBeVisible()
          await settleCapture(f.page, false)
          await f.page.screenshot({ path: join(captureDir, `${name}-settings-invalid.png`) })
          await info.attach(`${name}-sheet-bounds`, {
            body: JSON.stringify(
              await sheet.evaluate((element) => ({
                width: element.clientWidth,
                scroll: element.scrollWidth,
                overflow: [...element.querySelectorAll('*')]
                  .filter((node) => {
                    const rect = node.getBoundingClientRect()
                    return rect.right > element.getBoundingClientRect().right + 1
                  })
                  .map((node) => ({
                    tag: node.tagName,
                    class: node.className,
                    right: node.getBoundingClientRect().right,
                    text: node.textContent?.slice(0, 100),
                  })),
              })),
              null,
              2,
            ),
            contentType: 'application/json',
          })
          // Vaul extends a pseudo-element beyond a side drawer for its drag affordance. Measure
          // the actual controls instead of mistaking that pseudo-element for hidden form content.
          expect(
            await sheet.evaluate((element) =>
              [...element.querySelectorAll('input, button, label, h2, [role="alert"]')]
                .filter((node) => {
                  const rect = node.getBoundingClientRect()
                  const bounds = element.getBoundingClientRect()
                  return (
                    rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
                  )
                })
                .map((node) => ({ tag: node.tagName, text: node.textContent?.slice(0, 100) })),
            ),
          ).toEqual([])
          const finalSetting = sheet.getByRole('checkbox', {
            name: label('pomodoro.settings.autoStart'),
            exact: true,
          })
          await finalSetting.scrollIntoViewIfNeeded()
          await expect(finalSetting).toBeVisible()
          await f.page.screenshot({ path: join(captureDir, `${name}-settings-bottom.png`) })
          await f.page.keyboard.press('Escape')
          await expect(settings).toBeFocused()
          if (viewport.scale === 1) {
            const started = f.page.waitForResponse(
              (response) =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname.endsWith('/pomodoro/sessions'),
            )
            await f.page
              .getByRole('button', { name: label('pomodoro.action.startFocus'), exact: true })
              .click()
            expect((await started).status()).toBe(201)
            await f.page
              .getByRole('button', { name: label('pomodoro.action.pause'), exact: true })
              .click()
          }
          await settleCapture(f.page)
          await f.page.screenshot({ path: join(captureDir, `${name}-timer.png`), fullPage: true })
          expect(
            await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true)
        }
        expect(await (await f.context.request.get('/api/v1/personal/sprints')).json()).toEqual([])
        const stopped = f.page.waitForResponse(
          (response) =>
            response.request().method() === 'PATCH' &&
            new URL(response.url()).pathname.includes('/pomodoro/sessions/'),
        )
        await f.page
          .getByRole('button', { name: label('pomodoro.action.stop'), exact: true })
          .click()
        expect((await stopped).status()).toBe(200)
        const sessions = await (
          await f.context.request.get('/api/v1/personal/pomodoro/sessions')
        ).json()
        expect(sessions).toHaveLength(1)
        expect(sessions[0].completed).toBe(false)
        expect(sessions[0].endedAt).not.toBeNull()
      } finally {
        await f.close()
      }
    })
  }
}
