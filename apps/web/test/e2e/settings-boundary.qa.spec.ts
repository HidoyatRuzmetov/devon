import { expect, test, type Browser } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  csrfToken,
  loginAsSuperAdmin,
  login,
  examplePassword,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { adaptLocalUiSessionCookies, adaptLocalUiDepartmentCookie } from './flow-ui-cookies.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

async function account(browser: Browser) {
  const context = await newFlowContext(browser)
  const foreign: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      foreign.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await adaptLocalUiSessionCookies(context)
  await adaptLocalUiDepartmentCookie(context)
  const username = uniqueLogin('settings.qa')
  const password = examplePassword()
  await registerUser(context, {
    login: username,
    password,
    givenName: 'Synthetic',
    familyName: 'Settings',
  })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  return {
    context,
    page,
    username,
    password,
    foreign,
    close: async () => {
      await context.close()
      expect(foreign).toEqual([])
    },
  }
}

test('a held quiet-hours receipt cannot erase newer typing', async ({ browser }) => {
  const f = await account(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    await f.page.goto('/account/notifications')
    await f.page.getByLabel('Starts', { exact: true }).fill('19:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('09:00')
    let first = true
    await f.page.route('**/api/v1/notifications/quiet-hours*', async (route) => {
      if (route.request().method() !== 'PUT' || !first) return route.continue()
      first = false
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    await committed
    await expect(f.page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await f.page.getByLabel('Starts', { exact: true }).fill('17:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('10:00')
    const receipt = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    release()
    expect((await receipt).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('17:00')
    await expect(f.page.getByLabel('Ends', { exact: true })).toHaveValue('10:00')
    const stored = await (await f.context.request.get('/api/v1/notifications/quiet-hours')).json()
    expect(stored.startMinute).toBe(19 * 60)
    expect(stored.endMinute).toBe(9 * 60)
    const saved = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await f.page.reload()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('17:00')
    await expect(f.page.getByLabel('Ends', { exact: true })).toHaveValue('10:00')
  } finally {
    release()
    await f.close()
  }
})

test('a late personal notification preference receipt cannot replace a new account cache', async ({
  browser,
}) => {
  const f = await account(browser)
  const other = await account(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    const ownBefore = await (await other.context.request.get('/api/v1/notifications/prefs')).json()
    const ownAssignment = ownBefore.items.find(
      (row: { reason: string; channel: string }) =>
        row.reason === 'assigned' && row.channel === 'telegram',
    )
    await f.page.goto('/account/notifications')
    const assignment = f.page.getByRole('switch', { name: 'Assignment via Telegram', exact: true })
    await expect(assignment).toHaveAttribute('aria-checked', String(ownAssignment.enabled))
    let first = true
    await f.page.route('**/api/v1/notifications/prefs', async (route) => {
      if (route.request().method() !== 'PUT' || !first) return route.continue()
      first = false
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await assignment.click()
    await committed
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
    await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(other.username)
    await f.page.getByLabel('Password', { exact: true }).fill(other.password)
    await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Profile settings', exact: true }).click()
    await f.page.getByRole('link', { name: 'Notification preferences', exact: true }).click()
    await expect(assignment).toHaveAttribute('aria-checked', String(ownAssignment.enabled))
    const receipt = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/prefs'),
    )
    release()
    expect((await receipt).status()).toBe(200)
    await expect(assignment).toBeEnabled()
    await expect(assignment).toHaveAttribute('aria-checked', String(ownAssignment.enabled))
    const ownResponse = await other.context.request.get('/api/v1/notifications/prefs')
    expect(ownResponse.status()).toBe(200)
    const ownAfter = await ownResponse.json()
    expect(ownAfter).toEqual(ownBefore)
  } finally {
    release()
    await Promise.all([f.close(), other.close()])
  }
})

test('a late quiet-hours receipt cannot replace a new account cache', async ({ browser }) => {
  const f = await account(browser)
  const other = await account(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    const ownBefore = await (
      await other.context.request.get('/api/v1/notifications/quiet-hours')
    ).json()
    await f.page.goto('/account/notifications')
    await f.page.getByLabel('Starts', { exact: true }).fill('19:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('09:00')
    let first = true
    await f.page.route('**/api/v1/notifications/quiet-hours*', async (route) => {
      if (route.request().method() !== 'PUT' || !first) return route.continue()
      first = false
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    await committed
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
    await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(other.username)
    await f.page.getByLabel('Password', { exact: true }).fill(other.password)
    await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Profile settings', exact: true }).click()
    await f.page.getByRole('link', { name: 'Notification preferences', exact: true }).click()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('')
    const receipt = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    release()
    expect((await receipt).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('')
    await expect(f.page.getByLabel('Ends', { exact: true })).toHaveValue('')
    const ownResponse = await other.context.request.get('/api/v1/notifications/quiet-hours')
    expect(ownResponse.status()).toBe(200)
    expect(await ownResponse.json()).toEqual(ownBefore)
    const feed = f.page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/ics-token'))
    await f.page.getByRole('button', { name: 'Get the link', exact: true }).click()
    expect((await feed).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible()
    expect(await f.page.getByText('Preferences saved', { exact: true }).count()).toBe(0)
  } finally {
    release()
    await Promise.all([f.close(), other.close()])
  }
})

test('a held default reset keeps its captured department and cannot announce success in a new department', async ({
  browser,
}) => {
  const f = await account(browser)
  const admin = await newFlowContext(browser)
  const headA = await newFlowContext(browser)
  const headB = await newFlowContext(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    await loginAsSuperAdmin(admin)
    const a = await createApprovedDepartment(headA, admin, {
      headLogin: uniqueLogin('quiet.a'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic quiet A',
    })
    const b = await createApprovedDepartment(headB, admin, {
      headLogin: uniqueLogin('quiet.b'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic quiet B',
    })
    const departments = [a, b]
    for (let index = 0; index < departments.length; index += 1) {
      const department = departments[index]!
      expect(
        (
          await f.context.request.post('/api/v1/departments/join', {
            headers: { 'x-csrf-token': await csrfToken(f.context) },
            data: { key: department.joinKey, password: department.joinPassword },
          })
        ).status(),
      ).toBe(200)
    }
    expect(
      (
        await headB.request.put(`/api/v1/notifications/departments/${b.departmentId}/settings`, {
          headers: { 'x-csrf-token': await csrfToken(headB) },
          data: { quietStartMinute: 18 * 60, quietEndMinute: 10 * 60, quietWeekends: true },
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await f.context.request.put(
          `/api/v1/notifications/quiet-hours?departmentId=${a.departmentId}`,
          {
            headers: { 'x-csrf-token': await csrfToken(f.context) },
            data: { startMinute: 19 * 60, endMinute: 9 * 60, includeWeekends: true },
          },
        )
      ).status(),
    ).toBe(200)
    await f.page.goto('/account/notifications')
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('19:00')
    let first = true
    await f.page.route('**/api/v1/notifications/quiet-hours*', async (route) => {
      if (route.request().method() !== 'PUT' || !first) return route.continue()
      first = false
      expect(new URL(route.request().url()).searchParams.get('departmentId')).toBe(a.departmentId)
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Use department default', exact: true }).click()
    await committed
    await f.page.getByRole('button', { name: 'Switch department', exact: true }).click()
    const switched = f.page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/active-department'),
    )
    await f.page.getByRole('button').filter({ hasText: 'Synthetic quiet B' }).click()
    expect((await switched).status()).toBe(200)
    const summary = f.page.getByText("Using your department's default: 18:00–10:00", {
      exact: true,
    })
    await expect(summary).toBeVisible()
    const receipt = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    release()
    expect((await receipt).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    const feed = f.page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/ics-token'))
    await f.page.getByRole('button', { name: 'Get the link', exact: true }).click()
    expect((await feed).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible()
    await expect(summary).toBeVisible()
    expect(await f.page.getByText('Preferences saved', { exact: true }).count()).toBe(0)
    const stored = await f.context.request.get(
      `/api/v1/notifications/quiet-hours?departmentId=${b.departmentId}`,
    )
    expect(stored.status()).toBe(200)
    expect((await stored.json()).effective).toEqual({
      startMinute: 18 * 60,
      endMinute: 10 * 60,
      includeWeekends: true,
      source: 'department_default',
    })
  } finally {
    release()
    await Promise.all([f.close(), admin.close(), headA.close(), headB.close()])
  }
})

test('a late profile receipt cannot replace another account identity', async ({ browser }) => {
  const f = await account(browser)
  const other = await account(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    const ownBefore = await (await other.context.request.get('/api/v1/accounts/profile')).json()
    await f.page.goto('/account')
    const profile = f.page.locator('#section-profile')
    await profile
      .getByRole('textbox', { name: 'First name', exact: true })
      .fill('Previous owner draft')
    await f.page.route('**/api/v1/accounts/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    await committed
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
    await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(other.username)
    await f.page.getByLabel('Password', { exact: true }).fill(other.password)
    await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Profile settings', exact: true }).click()
    await expect(profile.getByRole('textbox', { name: 'First name', exact: true })).toHaveValue(
      ownBefore.givenName,
    )
    const receipt = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/accounts/profile'),
    )
    release()
    expect((await receipt).status()).toBe(200)
    await expect(profile.getByRole('textbox', { name: 'First name', exact: true })).toHaveValue(
      ownBefore.givenName,
    )
    await expect(profile.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      ownBefore.login,
    )
    const persisted = await other.context.request.get('/api/v1/accounts/profile')
    expect(persisted.status()).toBe(200)
    expect(await persisted.json()).toEqual(ownBefore)
  } finally {
    release()
    await Promise.all([f.close(), other.close()])
  }
})

test('editing a profile field from another tab cannot revert a separately changed username', async ({
  browser,
}) => {
  const f = await account(browser)
  const second = await newFlowContext(browser)
  try {
    await login(second, { login: f.username, password: f.password })
    const otherPage = await second.newPage()
    await Promise.all([f.page.goto('/account'), otherPage.goto('/account')])
    const firstProfile = f.page.locator('#section-profile')
    const otherProfile = otherPage.locator('#section-profile')
    await expect(otherProfile.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      f.username,
    )
    const newLogin = uniqueLogin('settings.renamed')
    await firstProfile.getByRole('textbox', { name: 'Username', exact: true }).fill(newLogin)
    const renamed = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/accounts/profile'),
    )
    await firstProfile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await renamed).status()).toBe(200)
    await otherProfile
      .getByRole('textbox', { name: 'Position', exact: true })
      .fill('Independent title edit')
    const changed = otherPage.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/accounts/profile'),
    )
    await otherProfile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await changed).status()).toBe(200)
    const persisted = await second.request.get('/api/v1/accounts/profile')
    expect(persisted.status()).toBe(200)
    const actual = await persisted.json()
    expect({ login: actual.login, title: actual.title }).toEqual({
      login: newLogin,
      title: 'Independent title edit',
    })
    await otherPage.reload()
    await expect(otherProfile.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      newLogin,
    )
  } finally {
    await Promise.all([f.close(), second.close()])
  }
})

test('a late quiet-hours refusal cannot show an old account error in a new account', async ({
  browser,
}) => {
  const f = await account(browser)
  const other = await account(browser)
  let release!: () => void
  let received!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const refused = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    await f.page.goto('/account/notifications')
    await f.page.getByLabel('Starts', { exact: true }).fill('22:00')
    await f.page.getByLabel('Ends', { exact: true }).fill('06:00')
    await f.page.route('**/api/v1/notifications/quiet-hours*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      const actual = await route.fetch()
      expect(actual.status()).toBe(422)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await f.page.getByRole('button', { name: 'Save', exact: true }).click()
    await refused
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/login?signedOut=1`)
    await f.page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(other.username)
    await f.page.getByLabel('Password', { exact: true }).fill(other.password)
    await f.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(f.page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    await f.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Profile settings', exact: true }).click()
    await f.page.getByRole('link', { name: 'Notification preferences', exact: true }).click()
    await expect(f.page.getByLabel('Starts', { exact: true })).toHaveValue('')
    const receipt = f.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/quiet-hours'),
    )
    release()
    expect((await receipt).status()).toBe(422)
    const feed = f.page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/ics-token'))
    await f.page.getByRole('button', { name: 'Get the link', exact: true }).click()
    expect((await feed).status()).toBe(200)
    await expect(f.page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible()
    expect(await f.page.getByText('Could not save', { exact: true }).count()).toBe(0)
    expect(
      await f.page
        .getByText("This range must be at least as quiet as your department's default.", {
          exact: true,
        })
        .count(),
    ).toBe(0)
  } finally {
    release()
    await Promise.all([f.close(), other.close()])
  }
})

test('an older profile receipt cannot revert an authoritative refresh while catch-up is held', async ({
  browser,
}) => {
  const f = await account(browser)
  const other = await newFlowContext(browser)
  let release!: () => void
  let releaseRefresh!: () => void
  let received!: () => void
  let refreshing!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  const catchUp = new Promise<void>((resolve) => {
    refreshing = resolve
  })
  try {
    await login(other, { login: f.username, password: f.password })
    const instant = Date.now()
    await f.page.clock.setFixedTime(instant)
    await f.page.goto('/account')
    const profile = f.page.locator('#section-profile')
    await profile
      .getByRole('textbox', { name: 'Position', exact: true })
      .fill('Acknowledged position')
    let holdReads = false
    await f.page.route('**/api/v1/accounts/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        const actual = await route.fetch()
        expect(actual.status()).toBe(200)
        received()
        await gate
        return route.fulfill({ response: actual })
      }
      if (holdReads) {
        const actual = await route.fetch()
        expect(actual.status()).toBe(200)
        refreshing()
        await refreshGate
        return route.fulfill({ response: actual })
      }
      return route.continue()
    })
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    await committed
    const newLogin = uniqueLogin('settings.latest')
    expect(
      (await authedPatch(other, '/api/v1/accounts/profile', { login: newLogin })).status(),
    ).toBe(200)
    await f.page.clock.setFixedTime(instant + 31_000)
    await f.page.getByRole('link', { name: 'Notification preferences', exact: true }).click()
    await f.page.getByRole('link', { name: 'Profile settings', exact: true }).click()
    await expect(profile.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      newLogin,
    )
    holdReads = true
    release()
    await catchUp
    await expect(profile.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(
      newLogin,
    )
    releaseRefresh()
    await expect(profile.getByRole('textbox', { name: 'Position', exact: true })).toHaveValue(
      'Acknowledged position',
    )
  } finally {
    release()
    releaseRefresh()
    await Promise.all([f.close(), other.close()])
  }
})

test('profile native username validation rejects unsupported characters before transport', async ({
  browser,
}) => {
  const f = await account(browser)
  try {
    await f.page.goto('/account')
    const profile = f.page.locator('#section-profile')
    const username = profile.getByRole('textbox', { name: 'Username', exact: true })
    let writes = 0
    f.page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname.endsWith('/accounts/profile')
      )
        writes += 1
    })
    /* eslint-disable no-restricted-syntax -- These values replace the same native input; each submit/focus check must finish before the next fill. */
    for (const invalid of ['UPPERCASE', 'with space', 'has@sign']) {
      await username.fill(invalid)
      expect(
        await username.evaluate((input) => (input as HTMLInputElement).validity.patternMismatch),
      ).toBe(true)
      await profile.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(username).toBeFocused()
      expect(writes).toBe(0)
    }
    /* eslint-enable no-restricted-syntax */
    const valid = uniqueLogin('settings.valid-2')
    await username.fill(valid)
    expect(await username.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(
      true,
    )
    const saved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/accounts/profile'),
    )
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    expect(writes).toBe(1)
    const actual = await f.context.request.get('/api/v1/accounts/profile')
    expect(actual.status()).toBe(200)
    expect((await actual.json()).login).toBe(valid)
  } finally {
    await f.close()
  }
})
