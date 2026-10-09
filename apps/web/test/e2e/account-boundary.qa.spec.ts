import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  login,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  stripSecureCookies,
  uniqueLogin,
} from './flow-api.js'
import type { AccountProfile } from '../../src/features/accounts/api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { adaptLocalUiSessionCookies } from './flow-ui-cookies.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'DifferentValidPassword!2026'

const evidence = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/account')

async function guardedContext(browser: Browser) {
  const context = await newFlowContext(browser)
  // Public routes intentionally start in Uzbek unless a user has chosen another language.
  await context.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
  const foreignRequests: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== FLOW_WEB_BASE_URL) {
      foreignRequests.push(url.hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await adaptLocalUiSessionCookies(context)
  return { context, foreignRequests }
}

async function account(browser: Browser) {
  const { context, foreignRequests } = await guardedContext(browser)
  const username = uniqueLogin('account.qa')
  const password = examplePassword()
  await registerUser(context, {
    login: username,
    password,
    givenName: 'Synthetic',
    familyName: 'Account',
  })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  return { context, username, password, foreignRequests }
}

async function profileRead(context: BrowserContext): Promise<AccountProfile> {
  const response = await context.request.get('/api/v1/accounts/profile')
  expect(response.status()).toBe(200)
  return response.json()
}

async function openProfile(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto('/account')
  const profile = page.locator('#section-profile')
  await expect(profile.getByRole('textbox', { name: 'First name', exact: true })).toBeVisible()
  return { page, profile }
}

async function signIn(page: Page, username: string, password: string) {
  await page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('invitation survives sign-in and joining verifies actual membership', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await account(browser)
  const visitor = await guardedContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('account.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic invitation QA',
    })
    const page = await visitor.context.newPage()
    const invitation = `/join?key=${department.joinKey}`
    await page.goto(invitation)
    await expect(page.getByText('Synthetic invitation QA', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await signIn(page, member.username, member.password)
    await expect(page).toHaveURL(new URL(invitation, FLOW_WEB_BASE_URL).href)
    await page.getByLabel('Password', { exact: true }).fill('IncorrectExamplePassword')
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Invalid key or password')
    await page.getByLabel('Password', { exact: true }).fill(department.joinPassword)
    const joined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/departments/join',
    )
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    expect((await joined).status()).toBe(200)
    await expect(page.getByRole('heading', { name: "You've joined the department" })).toBeVisible()
    const members = await head.request.get(`/api/v1/departments/${department.departmentId}/members`)
    expect(members.status()).toBe(200)
    expect((await members.json()).members).toHaveLength(2)
    expect(visitor.foreignRequests).toEqual([])
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, `${info.project.name}-joined.png`) })
  } finally {
    await Promise.all([
      admin.close(),
      head.close(),
      member.context.close(),
      visitor.context.close(),
    ])
  }
})

test('profile saves every editable detail and preserves newer text during a delayed successful save', async ({
  browser,
}, info) => {
  const user = await account(browser)
  let releaseDelayedResponse = () => {}
  try {
    const { page, profile } = await openProfile(user.context)
    const updatedLogin = uniqueLogin('account.updated')
    const values = {
      givenName: 'Updated',
      familyName: 'Person',
      patronymic: 'Testovich',
      title: 'Synthetic analyst',
      login: updatedLogin,
      email: `${updatedLogin}@example.invalid`,
    }
    for (const [label, value] of [
      ['First name', values.givenName],
      ['Last name', values.familyName],
      ['Patronymic', values.patronymic],
      ['Position', values.title],
      ['Username', values.login],
      ['Email', values.email],
    ])
      await profile.getByRole('textbox', { name: label!, exact: true }).fill(value!)
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === '/api/v1/accounts/profile',
    )
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(profile.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    expect(await profileRead(user.context)).toEqual(values)
    const renamed = await guardedContext(browser)
    const emailLogin = await guardedContext(browser)
    try {
      expect(
        (
          await renamed.context.request.post('/api/v1/auth/login', {
            data: { login: user.username, password: user.password },
          })
        ).status(),
      ).toBe(401)
      await login(renamed.context, { login: values.login, password: user.password })
      const emailPage = await emailLogin.context.newPage()
      await emailPage.goto('/login')
      await signIn(emailPage, values.email, user.password)
      await expect(emailPage).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    } finally {
      await Promise.all([renamed.context.close(), emailLogin.context.close()])
    }
    await page.reload()
    await expect(profile.getByRole('textbox', { name: 'Position', exact: true })).toHaveValue(
      values.title,
    )
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseDelayedResponse = release
    let received!: () => void
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    let delayFirstSave = true
    await page.route('**/api/v1/accounts/profile', async (route) => {
      if (route.request().method() !== 'PATCH' || !delayFirstSave) return route.continue()
      delayFirstSave = false
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await profile
      .getByRole('textbox', { name: 'First name', exact: true })
      .fill('First saved revision')
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    await committed
    await profile
      .getByRole('textbox', { name: 'First name', exact: true })
      .fill('Newer unsaved revision')
    release()
    await expect(profile.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(profile.getByRole('textbox', { name: 'First name', exact: true })).toHaveValue(
      'Newer unsaved revision',
    )
    expect((await profileRead(user.context)).givenName).toBe('First saved revision')
    const newerSaved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === '/api/v1/accounts/profile',
    )
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await newerSaved).status()).toBe(200)
    expect((await profileRead(user.context)).givenName).toBe('Newer unsaved revision')
    expect(user.foreignRequests).toEqual([])
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await profile.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
    await profile.screenshot({ path: join(evidence, `${info.project.name}-profile.png`) })
  } finally {
    releaseDelayedResponse()
    await user.context.close()
  }
})

test('profile collision and transport failure preserve the draft and persisted account', async ({
  browser,
}, info) => {
  const user = await account(browser)
  const occupied = await account(browser)
  try {
    const { page, profile } = await openProfile(user.context)
    const original = await profileRead(user.context)
    await profile.getByRole('textbox', { name: 'Username', exact: true }).fill(occupied.username)
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(profile.getByRole('alert')).toHaveText(
      'That username is already taken. Choose another.',
    )
    expect(await profileRead(user.context)).toEqual(original)
    await profile.getByRole('textbox', { name: 'Username', exact: true }).fill(user.username)
    await profile.getByRole('textbox', { name: 'Position', exact: true }).fill('Recoverable draft')
    let interruptedWrites = 0
    await page.route('**/api/v1/accounts/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        interruptedWrites += 1
        await route.abort('connectionfailed')
      } else await route.continue()
    })
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(() => interruptedWrites, {
        message: 'The retry actually reached the interrupted PATCH transport',
      })
      .toBe(1)
    await expect(profile.getByRole('alert')).toHaveText(
      'Could not save. Check the fields and try again.',
    )
    await expect(profile.getByRole('textbox', { name: 'Position', exact: true })).toHaveValue(
      'Recoverable draft',
    )
    expect(await profileRead(user.context)).toEqual(original)
    await page.unroute('**/api/v1/accounts/profile')
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === '/api/v1/accounts/profile',
    )
    await profile.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    expect((await profileRead(user.context)).title).toBe('Recoverable draft')
    mkdirSync(evidence, { recursive: true })
    await profile.screenshot({ path: join(evidence, `${info.project.name}-profile-recovered.png`) })
    expect(user.foreignRequests).toEqual([])
  } finally {
    await Promise.all([user.context.close(), occupied.context.close()])
  }
})

test('short new password reports validation rather than claiming the current password is wrong', async ({
  browser,
}, info) => {
  const user = await account(browser)
  try {
    const { page } = await openProfile(user.context)
    const section = page.locator('#section-password')
    await section.getByLabel('Current password', { exact: true }).fill(user.password)
    await section.getByLabel('New password', { exact: true }).fill('short')
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText(
      'Use at least 12 characters and avoid very common passwords.',
    )
    const peer = await guardedContext(browser)
    try {
      await login(peer.context, { login: user.username, password: user.password })
    } finally {
      await peer.context.close()
    }
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({
      path: join(evidence, `${info.project.name}-password-validation.png`),
    })
  } finally {
    await user.context.close()
  }
})

test('password change and session controls revoke only the intended sessions', async ({
  browser,
}) => {
  const user = await account(browser)
  const peer = await guardedContext(browser)
  const stranger = await account(browser)
  try {
    await login(peer.context, { login: user.username, password: user.password })
    const { page } = await openProfile(user.context)
    const section = page.locator('#section-password')
    await section.getByLabel('Current password', { exact: true }).fill('IncorrectExamplePassword')
    const nextPassword = examplePassword()
    await section.getByLabel('New password', { exact: true }).fill(nextPassword)
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText('Current password is wrong')
    await section.getByLabel('Current password', { exact: true }).fill(user.password)
    const changed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/password/change',
    )
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await changed).status()).toBe(204)
    await expect(section.getByRole('status')).toHaveText('Password updated')
    const fresh = await guardedContext(browser)
    try {
      expect(
        (
          await fresh.context.request.post('/api/v1/auth/login', {
            data: { login: user.username, password: user.password },
          })
        ).status(),
      ).toBe(401)
      await login(fresh.context, { login: user.username, password: nextPassword })
    } finally {
      await fresh.context.close()
    }
    const sessions = page.locator('#section-sessions')
    const peerSessions = await peer.context.request.get('/api/v1/accounts/sessions')
    const target = (await peerSessions.json()).sessions.find(
      (s: { isCurrent: boolean }) => s.isCurrent,
    )
    expect(target).toBeTruthy()
    // A different account cannot use a known session id to revoke it.
    const strangerCsrf = (await stranger.context.cookies()).find(
      (c) => c.name === 'devon_csrf',
    )!.value
    expect(
      (
        await stranger.context.request.post(`/api/v1/accounts/sessions/${target.id}/revoke`, {
          headers: { 'x-csrf-token': strangerCsrf },
          data: {},
        })
      ).status(),
    ).toBe(404)
    // The older peer is the first non-current session at initial render.
    await expect(sessions.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(1)
    const revoked = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/v1/accounts/sessions/${target.id}/revoke`,
    )
    await sessions.getByRole('button', { name: 'Sign out', exact: true }).click()
    expect((await revoked).status()).toBe(204)
    expect((await peer.context.request.get('/api/v1/me')).status()).toBe(401)
    expect((await user.context.request.get('/api/v1/me')).status()).toBe(200)
    await sessions.getByRole('button', { name: 'Sign out everywhere', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign out everywhere', exact: true })
    const all = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/sessions/revoke-all',
    )
    await dialog.getByRole('button', { name: 'Sign out everywhere', exact: true }).click()
    expect((await all).status()).toBe(204)
    await expect(page).toHaveURL(/\/login\?signedOut=1$/)
    expect((await user.context.request.get('/api/v1/me')).status()).toBe(401)
    expect(user.foreignRequests).toEqual([])
  } finally {
    await Promise.all([user.context.close(), peer.context.close(), stranger.context.close()])
  }
})

// Independent RFC 6238 fixture generator: never imports the application's verifier.
function currentTotp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest.at(-1)! & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('two-factor setup, invalid code, recovery login and password-confirmed disable work', async ({
  browser,
}) => {
  const user = await account(browser)
  const visitor = await guardedContext(browser)
  try {
    const { page } = await openProfile(user.context)
    const section = page.locator('#section-2fa')
    const enrolling = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/2fa/totp/enroll',
    )
    await section.getByRole('button', { name: 'Enable', exact: true }).click()
    const response = await enrolling
    expect(response.status()).toBe(200)
    const { secret } = (await response.json()) as { secret: string }
    const code = section.getByLabel('6-digit code from your app', { exact: true })
    await code.fill('abcdef')
    await section.getByRole('button', { name: 'Verify and enable', exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText(
      "That code is wrong. Check your device's clock.",
    )
    await code.fill(currentTotp(secret))
    const verifying = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/2fa/totp/verify',
    )
    await section.getByRole('button', { name: 'Verify and enable', exact: true }).click()
    const verified = await verifying
    expect(verified.status()).toBe(200)
    const { recoveryCodes } = (await verified.json()) as { recoveryCodes: string[] }
    await expect(section.getByText('Save your recovery codes', { exact: true })).toBeVisible()
    expect(recoveryCodes).toHaveLength(8)
    await section.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(section.getByRole('button', { name: 'Disable', exact: true })).toBeVisible()
    const signin = await visitor.context.newPage()
    await signin.goto('/login')
    await signIn(signin, user.username, user.password)
    await expect(
      signin.getByRole('heading', { name: 'Two-step verification', exact: true }),
    ).toBeVisible()
    await signin.getByLabel('Code', { exact: true }).fill('invalid-code')
    await signin.getByRole('button', { name: 'Verify', exact: true }).click()
    await expect(signin.getByRole('alert')).toHaveText('That code is wrong or expired. Try again.')
    await signin.getByLabel('Code', { exact: true }).fill(recoveryCodes[0]!)
    await signin.getByRole('button', { name: 'Verify', exact: true }).click()
    await expect(signin).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    await page.reload()
    await section.getByRole('button', { name: 'Disable', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Disable 2FA', exact: true })
    await dialog
      .getByLabel('Confirm your password', { exact: true })
      .fill('IncorrectExamplePassword')
    await dialog.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Wrong password')
    await dialog.getByLabel('Confirm your password', { exact: true }).fill(user.password)
    const disabled = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/2fa/disable',
    )
    await dialog.getByRole('button', { name: 'Disable', exact: true }).click()
    expect((await disabled).status()).toBe(204)
    await expect(dialog).toHaveCount(0)
    expect((await (await user.context.request.get('/api/v1/accounts/2fa')).json()).ok).toBe(false)
    expect(user.foreignRequests).toEqual([])
    expect(visitor.foreignRequests).toEqual([])
  } finally {
    await Promise.all([user.context.close(), visitor.context.close()])
  }
})

test('Telegram is discoverable in profile settings and disabled integration makes no external call', async ({
  browser,
}, info) => {
  const user = await account(browser)
  try {
    const { page } = await openProfile(user.context)
    const navigation = page.getByRole('navigation', { name: 'Settings sections', exact: true })
    await navigation.getByRole('link', { name: 'Telegram', exact: true }).click()
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/account/telegram`)
    await expect(navigation.getByRole('link', { name: 'Telegram', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByText('Telegram is not connected yet', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate|Connect|Unlink/ })).toHaveCount(0)
    const status = await user.context.request.get('/api/v1/telegram/status')
    expect(status.status()).toBe(200)
    expect((await status.json()).configured).toBe(false)
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-telegram-disabled.png`),
      fullPage: true,
    })
    await navigation.getByRole('link', { name: 'Notification preferences', exact: true }).click()
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/account/notifications`)
    await expect(page.getByRole('columnheader', { name: 'In-app', exact: true })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Email', exact: true })).toHaveCount(0)
    expect(user.foreignRequests).toEqual([])
  } finally {
    await user.context.close()
  }
})

test('deletion request requires typed confirmation and cancellation persists', async ({
  browser,
}, info) => {
  const user = await account(browser)
  try {
    const { page } = await openProfile(user.context)
    const section = page.locator('#section-delete')
    await section.getByRole('button', { name: 'Request deletion', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete account', exact: true })
    const submit = dialog.getByRole('button', { name: 'Request deletion', exact: true })
    await expect(submit).toBeDisabled()
    await dialog.getByRole('textbox').fill('wrong-login')
    await expect(submit).toBeDisabled()
    await dialog.getByRole('textbox').fill(user.username)
    const requested = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/delete',
    )
    await submit.click()
    expect((await requested).status()).toBe(200)
    await expect(
      section.getByRole('button', { name: 'Cancel deletion', exact: true }),
    ).toBeVisible()
    expect(
      (await (await user.context.request.get('/api/v1/accounts/delete/status')).json())
        .scheduledFor,
    ).toBeTruthy()
    await page.reload()
    const cancelled = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/delete/cancel',
    )
    await section.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    expect((await cancelled).status()).toBe(204)
    expect(
      await (await user.context.request.get('/api/v1/accounts/delete/status')).json(),
    ).toBeNull()
    await expect(
      section.getByRole('button', { name: 'Request deletion', exact: true }),
    ).toBeVisible()
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({
      path: join(evidence, `${info.project.name}-deletion-cancelled.png`),
    })
    expect(user.foreignRequests).toEqual([])
  } finally {
    await user.context.close()
  }
})

test('new registration retains the invitation and all profile fields', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const visitor = await guardedContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('account.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic registration QA',
    })
    const page = await visitor.context.newPage()
    const invitation = `/join?key=${department.joinKey}`
    await page.goto(invitation)
    await page.getByRole('link', { name: 'Create one', exact: true }).click()
    const username = uniqueLogin('account.registered')
    const registrationFields = [
      ['Given name', 'Synthetic'],
      ['Family name', 'Registration'],
      ['Patronymic (optional)', 'Testovich'],
      ['Title (optional)', 'QA analyst'],
      ['Login', username],
      ['Email (optional)', 'registration@example.invalid'],
      ['Password', examplePassword()],
    ]
    // Native fills share form focus and React validation state, so keep these actions sequential.
    for (let index = 0; index < registrationFields.length; index++) {
      const [label, value] = registrationFields[index]!
      const input =
        label === 'Login'
          ? page.locator('input[autocomplete="username"]')
          : label === 'Password'
            ? page.locator('input[autocomplete="new-password"]')
            : page.getByLabel(label!, { exact: true })
      await input.fill(value!)
    }
    await page.locator('form select').selectOption('en')
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 320, height: 780 })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-registration-form.png`),
      fullPage: true,
    })
    const registration = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/register',
    )
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    expect((await registration).status()).toBe(201)
    await expect(page).toHaveURL(new URL(invitation, FLOW_WEB_BASE_URL).href)
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible()
    await stripSecureCookies(visitor.context)
    expect(await profileRead(visitor.context)).toEqual({
      login: username,
      email: 'registration@example.invalid',
      givenName: 'Synthetic',
      familyName: 'Registration',
      patronymic: 'Testovich',
      title: 'QA analyst',
    })
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 320, height: 780 })
    // Observe the auth card's actual entrance finishing; a mid-animation blur is not layout proof.
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'Join', exact: true }).evaluate((button) => {
          const card = button.closest('[data-devon-entrance]')
          return card ? getComputedStyle(card).filter : 'missing'
        }),
      )
      .toBe('blur(0px)')
    await page.screenshot({
      path: join(evidence, `${info.project.name}-registered-invitation.png`),
      fullPage: true,
    })
    expect(visitor.foreignRequests).toEqual([])
  } finally {
    await Promise.all([admin.close(), head.close(), visitor.context.close()])
  }
})

test('nested settings transport failures show feedback and retry preserves real state', async ({
  browser,
}) => {
  const user = await account(browser)
  const peer = await guardedContext(browser)
  try {
    await login(peer.context, { login: user.username, password: user.password })
    const { page } = await openProfile(user.context)
    const twoFactor = page.locator('#section-2fa')
    await page.route('**/api/v1/accounts/2fa/totp/enroll', (route) =>
      route.abort('connectionfailed'),
    )
    await twoFactor.getByRole('button', { name: 'Enable', exact: true }).click()
    await expect(twoFactor.getByRole('alert')).toHaveText(
      'Could not save. Check your connection and try again.',
    )
    expect((await (await user.context.request.get('/api/v1/accounts/2fa')).json()).ok).toBe(false)
    await page.unroute('**/api/v1/accounts/2fa/totp/enroll')
    const enrolling = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/2fa/totp/enroll',
    )
    await twoFactor.getByRole('button', { name: 'Enable', exact: true }).click()
    expect((await enrolling).status()).toBe(200)
    await expect(twoFactor.getByLabel('6-digit code from your app', { exact: true })).toBeVisible()
    await twoFactor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(twoFactor.getByRole('button', { name: 'Enable', exact: true })).toBeVisible()
    const sessions = page.locator('#section-sessions')
    await page.route('**/api/v1/accounts/sessions/*/revoke', (route) =>
      route.abort('connectionfailed'),
    )
    await sessions.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(sessions.getByRole('alert')).toHaveText(
      'Could not save. Check your connection and try again.',
    )
    expect((await peer.context.request.get('/api/v1/me')).status()).toBe(200)
    await page.unroute('**/api/v1/accounts/sessions/*/revoke')
    const revoked = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/revoke'))
    await sessions.getByRole('button', { name: 'Sign out', exact: true }).click()
    expect((await revoked).status()).toBe(204)
    expect((await peer.context.request.get('/api/v1/me')).status()).toBe(401)
    const deletion = page.locator('#section-delete')
    await deletion.getByRole('button', { name: 'Request deletion', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete account', exact: true })
    await dialog.getByRole('textbox').fill(user.username)
    await page.route('**/api/v1/accounts/delete', (route) => route.abort('connectionfailed'))
    await dialog.getByRole('button', { name: 'Request deletion', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'Could not save. Check your connection and try again.',
    )
    expect(
      await (await user.context.request.get('/api/v1/accounts/delete/status')).json(),
    ).toBeNull()
    await page.unroute('**/api/v1/accounts/delete')
    const requested = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/delete',
    )
    await dialog.getByRole('button', { name: 'Request deletion', exact: true }).click()
    expect((await requested).status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    await page.route('**/api/v1/accounts/delete/cancel', (route) => route.abort('connectionfailed'))
    await deletion.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    await expect(deletion.getByRole('alert')).toHaveText(
      'Could not save. Check your connection and try again.',
    )
    expect(
      (await (await user.context.request.get('/api/v1/accounts/delete/status')).json())
        .scheduledFor,
    ).toBeTruthy()
    await page.unroute('**/api/v1/accounts/delete/cancel')
    const cancelled = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/delete/cancel',
    )
    await deletion.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    expect((await cancelled).status()).toBe(204)
    expect(
      await (await user.context.request.get('/api/v1/accounts/delete/status')).json(),
    ).toBeNull()
  } finally {
    await Promise.all([user.context.close(), peer.context.close()])
  }
})

test('case-folded email aliases fail closed when ambiguous and usernames remain usable', async ({
  browser,
}) => {
  const first = await account(browser)
  const second = await account(browser)
  const visitor = await guardedContext(browser)
  try {
    const email = `${uniqueLogin('alias')}@example.invalid`
    expect((await authedPatch(first.context, '/api/v1/accounts/profile', { email })).status()).toBe(
      200,
    )
    await login(visitor.context, { login: ` ${email.toUpperCase()} `, password: first.password })
    const wrongPassword = await visitor.context.request.post('/api/v1/auth/login', {
      data: { login: email, password: qaExampleCredential1 },
    })
    expect(wrongPassword.status()).toBe(401)
    expect(
      (
        await authedPatch(second.context, '/api/v1/accounts/profile', {
          email: email.toUpperCase(),
        })
      ).status(),
    ).toBe(200)
    const ambiguous = await visitor.context.request.post('/api/v1/auth/login', {
      data: { login: email, password: first.password },
    })
    const unknown = await visitor.context.request.post('/api/v1/auth/login', {
      data: { login: 'unknown@example.invalid', password: first.password },
    })
    expect(ambiguous.status()).toBe(401)
    expect(unknown.status()).toBe(401)
    const one = await ambiguous.json()
    const other = await unknown.json()
    const wrong = await wrongPassword.json()
    expect({ code: one.code, detail: one.detail }).toEqual({
      code: other.code,
      detail: other.detail,
    })
    expect({ code: wrong.code, detail: wrong.detail }).toEqual({
      code: other.code,
      detail: other.detail,
    })
    await login(visitor.context, { login: first.username, password: first.password })
    await login(visitor.context, { login: second.username, password: second.password })
    expect(visitor.foreignRequests).toEqual([])
  } finally {
    await Promise.all([first.context.close(), second.context.close(), visitor.context.close()])
  }
})

test('profile photo uses actual PNG upload and WebP variants, rejects invalid bytes and recovers from interrupted upload', async ({
  browser,
}, info) => {
  const user = await account(browser)
  try {
    const { page } = await openProfile(user.context)
    const photo = page.locator('#section-photo')
    const input = photo.locator('input[type=file]')
    const bytes = readFileSync(join(import.meta.dirname, 'fixtures/account-avatar.png'))
    const finalized = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/accounts/avatar',
    )
    await input.setInputFiles({
      name: 'synthetic-avatar.png',
      mimeType: 'image/png',
      buffer: bytes,
    })
    expect((await finalized).status()).toBe(200)
    const image = photo.getByRole('img', { name: 'Your profile photo', exact: true })
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => ({
          width: element.naturalWidth,
          height: element.naturalHeight,
        })),
      )
      .toEqual({ width: 128, height: 128 })
    const src = await image.getAttribute('src')
    expect(src).toMatch(/^\/api\/v1\/accounts\/avatar\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/128$/)
    const variant = await user.context.request.get(src!)
    expect(variant.status()).toBe(200)
    expect(variant.headers()['content-type']).toBe('image/webp')
    const originalAvatarKey = (await (await user.context.request.get('/api/v1/me')).json()).user
      .avatarKey
    await input.setInputFiles({
      name: 'broken-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('This is not an image'),
    })
    await expect(photo.getByRole('alert')).toHaveText('This file is not a valid image.')
    expect((await (await user.context.request.get('/api/v1/me')).json()).user.avatarKey).toBe(
      originalAvatarKey,
    )
    await page.route('**/api/v1/storage/uploads?*', async (route) => {
      if (route.request().method() === 'PUT') await route.abort('connectionfailed')
      else await route.continue()
    })
    await input.setInputFiles({
      name: 'interrupted-avatar.png',
      mimeType: 'image/png',
      buffer: bytes,
    })
    await expect(photo.getByRole('alert')).toHaveText('Could not upload the photo. Try again.')
    expect((await (await user.context.request.get('/api/v1/me')).json()).user.avatarKey).toBe(
      originalAvatarKey,
    )
    await page.unroute('**/api/v1/storage/uploads?*')
    const retried = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/accounts/avatar',
    )
    await input.setInputFiles({ name: 'retry-avatar.png', mimeType: 'image/png', buffer: bytes })
    expect((await retried).status()).toBe(200)
    await expect(photo.getByRole('alert')).toHaveCount(0)
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await photo.screenshot({ path: join(evidence, `${info.project.name}-avatar.png`) })
    const removed = page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        new URL(r.url()).pathname === '/api/v1/accounts/avatar',
    )
    await photo.getByRole('button', { name: 'Remove photo', exact: true }).click()
    expect((await removed).status()).toBe(204)
    expect((await (await user.context.request.get('/api/v1/me')).json()).user.avatarKey).toBeNull()
    await expect(photo.getByRole('img')).toHaveCount(0)
    expect(user.foreignRequests).toEqual([])
  } finally {
    await user.context.close()
  }
})

test('administrator temporary password can be replaced through profile and cannot sign in afterwards', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  const user = await account(browser)
  const visitor = await guardedContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const userId = (await (await user.context.request.get('/api/v1/me')).json()).user.id as string
    const reset = await admin.request.post(`/api/v1/accounts/${userId}/reset-password`, {
      headers: { 'x-csrf-token': await csrfToken(admin) },
      data: {},
    })
    expect(reset.status()).toBe(200)
    const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string }
    expect((await user.context.request.get('/api/v1/me')).status()).toBe(401)
    const page = await visitor.context.newPage()
    await page.goto('/login')
    await signIn(page, user.username, temporaryPassword)
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/account#section-password`)
    await expect(
      page.locator('#section-password').getByLabel('Current password', { exact: true }),
    ).toBeFocused()
    await stripSecureCookies(visitor.context)
    expect(
      (await (await visitor.context.request.get('/api/v1/me')).json()).user.mustChangePassword,
    ).toBe(true)
    const section = page.locator('#section-password')
    await expect(section.getByRole('status')).toHaveText(
      'You signed in with a temporary password. Enter it as your current password and choose a new one below.',
    )
    const replacement = examplePassword()
    await section.getByLabel('Current password', { exact: true }).fill(temporaryPassword)
    await section.getByLabel('New password', { exact: true }).fill(replacement)
    const changed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/accounts/password/change',
    )
    await section.getByLabel('New password', { exact: true }).press('Enter')
    expect((await changed).status()).toBe(204)
    await expect(section.getByText('Password updated', { exact: true })).toBeVisible()
    await expect(
      section.getByText(
        'You signed in with a temporary password. Enter it as your current password and choose a new one below.',
        { exact: true },
      ),
    ).toHaveCount(0)
    expect(
      (await (await visitor.context.request.get('/api/v1/me')).json()).user.mustChangePassword,
    ).toBe(false)
    const signedOut = await visitor.context.request.post('/api/v1/auth/logout', {
      headers: { 'x-csrf-token': await csrfToken(visitor.context) },
      data: {},
    })
    expect(signedOut.status()).toBe(204)
    expect(
      (
        await visitor.context.request.post('/api/v1/auth/login', {
          data: { login: user.username, password: temporaryPassword },
        })
      ).status(),
    ).toBe(401)
    await page.goto('/login')
    await signIn(page, user.username, replacement)
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/`)
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-temporary-password-replaced.png`),
    })
    expect(visitor.foreignRequests).toEqual([])
  } finally {
    await Promise.all([admin.close(), user.context.close(), visitor.context.close()])
  }
})

test('manual invitation key accepts copied raw key and full link with surrounding whitespace', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const first = await account(browser)
  const second = await account(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('account.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic raw key QA',
    })
    const page = await first.context.newPage()
    await page.goto('/join')
    await page.getByLabel('Invite key', { exact: true }).fill(department.joinKey)
    await page.getByLabel('Password', { exact: true }).fill(department.joinPassword)
    const rawJoined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/departments/join',
    )
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    expect((await rawJoined).status()).toBe(200)
    await expect(page.getByRole('heading', { name: "You've joined the department" })).toBeVisible()
    const pasted = await second.context.newPage()
    await pasted.goto('/join')
    await pasted
      .getByLabel('Invite key', { exact: true })
      .fill(`  ${FLOW_WEB_BASE_URL}/join?key=${encodeURIComponent(department.joinKey)}\n`)
    await pasted.getByLabel('Password', { exact: true }).fill(department.joinPassword)
    const linkJoined = pasted.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/departments/join',
    )
    await pasted.getByRole('button', { name: 'Join', exact: true }).click()
    expect((await linkJoined).status()).toBe(200)
    await expect(
      pasted.getByRole('heading', { name: "You've joined the department" }),
    ).toBeVisible()
    expect(
      (
        await (
          await head.request.get(`/api/v1/departments/${department.departmentId}/members`)
        ).json()
      ).members,
    ).toHaveLength(3)
    mkdirSync(evidence, { recursive: true })
    await pasted.screenshot({ path: join(evidence, `${info.project.name}-manual-link-joined.png`) })
  } finally {
    await Promise.all([admin.close(), head.close(), first.context.close(), second.context.close()])
  }
})

test('temporary password guidance preserves an explicit invitation return', async ({ browser }) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const user = await account(browser)
  const visitor = await guardedContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('account.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic temporary invitation QA',
    })
    const userId = (await (await user.context.request.get('/api/v1/me')).json()).user.id as string
    const reset = await admin.request.post(`/api/v1/accounts/${userId}/reset-password`, {
      headers: { 'x-csrf-token': await csrfToken(admin) },
      data: {},
    })
    expect(reset.status()).toBe(200)
    const { temporaryPassword } = await reset.json()
    const invitation = `/join?key=${department.joinKey}`
    const page = await visitor.context.newPage()
    await page.goto(`/login?returnTo=${encodeURIComponent(invitation)}`)
    await signIn(page, user.username, temporaryPassword)
    await expect(page).toHaveURL(new URL(invitation, FLOW_WEB_BASE_URL).href)
    await page.getByLabel('Password', { exact: true }).fill(department.joinPassword)
    const joined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/departments/join',
    )
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    expect((await joined).status()).toBe(200)
    await expect(
      page.getByRole('heading', { name: "You've joined the department", exact: true }),
    ).toBeVisible()
    await stripSecureCookies(visitor.context)
    expect(
      (await (await visitor.context.request.get('/api/v1/me')).json()).user.mustChangePassword,
    ).toBe(true)
    expect(visitor.foreignRequests).toEqual([])
  } finally {
    await Promise.all([admin.close(), head.close(), user.context.close(), visitor.context.close()])
  }
})
