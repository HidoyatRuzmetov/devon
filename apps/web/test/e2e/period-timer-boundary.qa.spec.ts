import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  login,
  loginAsSuperAdmin,
  newFlowContext,
  stripSecureCookies,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { adaptLocalUiSessionCookies } from './flow-ui-cookies.js'

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
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
    await failed
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
    await startCommitted
    expect(
      await (await f.context.request.get('/api/v1/personal/pomodoro/sessions')).json(),
    ).toHaveLength(1)
    await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
    await f.page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await f.page.getByRole('button', { name: 'Pomodoro timer', exact: true }).click()
    const buttons = f.page.getByRole('button', { name: 'Start focus', exact: true })
    await expect(buttons).toHaveCount(1)
    for (const button of await buttons.all()) await expect(button).toBeDisabled()
    await f.page.keyboard.press('Escape')
    await f.page.getByRole('tab', { name: 'Personal calendar', exact: true }).click()
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
    await f.page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await f.page.getByRole('button', { name: 'Pomodoro timer', exact: true }).click()
    const stops = f.page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stops).toHaveCount(1)
    for (const stop of await stops.all()) await expect(stop).toBeDisabled()
    await f.page.keyboard.press('Escape')
    await f.page.getByRole('tab', { name: 'Personal calendar', exact: true }).click()
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
        .getByRole('button', { name: 'Start', exact: true }),
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
        await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
          .getByRole('button', { name: action === 'start' ? 'Start' : 'Stop', exact: true })
          .click()
        await committed
      }
      await f.page.getByRole('button', { name: 'Profile settings', exact: true }).click()
      await f.page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
      await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(otherLogin)
      await f.page.getByLabel('Password', { exact: true }).fill(otherPassword)
      await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
      await stripSecureCookies(f.context)
      await f.page.getByRole('link', { name: 'Personal', exact: true }).click()
      await f.page.getByRole('tab', { name: 'Pomodoro', exact: true }).click()
      await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
      const current = f.page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
      )
      await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
    await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
    await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(f.page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await f.page.clock.runFor(20_000)
    await f.page.getByRole('button', { name: 'Pause', exact: true }).click()
    const ring = f.page
      .getByRole('tabpanel', { name: 'Pomodoro', exact: true })
      .getByRole('timer', { name: 'Focus', exact: true })
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
        .getByRole('timer', { name: 'Long break', exact: true }),
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
    await f.page.getByRole('button', { name: 'Stop', exact: true }).click()
    expect((await skipped).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    const short = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/pomodoro/sessions'),
    )
    await f.page.getByRole('button', { name: 'Short break', exact: true }).click()
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
    await expect(f.page.getByRole('timer')).toHaveText('1:00')
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
    await f.page.getByRole('button', { name: 'Start', exact: true }).click()
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
