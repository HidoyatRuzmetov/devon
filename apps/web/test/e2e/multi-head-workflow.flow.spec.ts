import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

const dockerReview = process.env['FLOW_DB_NAME'] === 'devon_qa_heads_docker'

// Real application + real PostgreSQL + separate browser sessions. No route mocks. Its screenshots
// live separately from the explicitly labelled UI previews in multi-head-preview.qa.spec.ts.
test('@flow multiple heads retain management across every department workspace and lose it after demotion', async ({
  browser,
}) => {
  test.setTimeout(360_000)
  const admin = await newFlowContext(browser),
    first = await newFlowContext(browser),
    second = await newFlowContext(browser),
    member = await newFlowContext(browser),
    applicant = await newFlowContext(browser)
  const screenshots = dockerReview
    ? resolve(import.meta.dirname, '../../../../artifacts/qa/multiple-heads/live-workflow')
    : test.info().outputPath('multiple-heads')
  try {
    await mkdir(screenshots, { recursive: true })
    await loginAsSuperAdmin(admin)
    const headLogin = uniqueLogin('multiple.head')
    const headPassword = examplePassword()
    const departmentName = `Multiple-head workflow QA ${headLogin.slice(-8)}`
    const department = await createApprovedDepartment(first, admin, {
      headLogin,
      headPassword,
      departmentName,
    })
    for (const context of [second, member])
      await joinDepartmentAsNewUser(context, {
        login: uniqueLogin('multiple.member'),
        password: examplePassword(),
        joinKey: department.joinKey,
        joinPassword: department.joinPassword,
      })
    expect((await authedPatch(admin, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    for (const [index, context] of [first, second, member].entries()) {
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      expect(
        (
          await authedPatch(context, '/api/v1/accounts/profile', {
            givenName: ['Anvar', 'Nodira', 'Aziza'][index],
            familyName: 'Review',
          })
        ).status(),
      ).toBe(200)
    }
    const secondId = (await (await second.request.get('/api/v1/me')).json()).user.id as string
    const memberId = (await (await member.request.get('/api/v1/me')).json()).user.id as string
    const firstPage = await first.newPage(),
      secondPage = await second.newPage()
    const membersPath = `/department?id=${department.departmentId}&tab=members`
    await secondPage.goto(membersPath)
    await expect(secondPage.getByRole('tab', { name: 'Invite', exact: true })).toHaveCount(0)
    await firstPage.goto(membersPath)
    await firstPage.getByRole('button', { name: 'Actions for Nodira Review' }).click()
    await firstPage.getByRole('menuitem', { name: 'Appoint as head' }).click()
    await settleCapture(firstPage)
    await firstPage.screenshot({
      path: resolve(screenshots, '25-appoint-head-confirmation.png'),
      fullPage: true,
    })
    await firstPage.getByRole('dialog').getByRole('button', { name: 'Appoint as head' }).click()
    await expect(firstPage.getByText('Department heads (2)')).toBeVisible()
    // Outbox delivery (or the central bounded reconciliation) updates the already-open session.
    await expect(secondPage.getByRole('tab', { name: 'Invite', exact: true })).toBeVisible({
      timeout: 40_000,
    })
    expect(
      (
        await second.request.get(`/api/v1/departments/${department.departmentId}/join-requests`)
      ).status(),
    ).toBe(200)
    const unit = await authedPost(second, `/api/v1/departments/${department.departmentId}/units`, {
      name: 'Delivery team',
    })
    expect(unit.status()).toBe(201)
    const project = await authedPost(second, '/api/v1/projects', {
      title: 'Joint leadership review',
      ownerUserId: secondId,
      members: [memberId],
    })
    expect(project.status()).toBe(201)
    const projectId = (await project.json()).id as string
    const card = await authedPost(second, '/api/v1/cards', {
      title: 'Review service delivery',
      assigneeUserId: memberId,
      giverUserId: secondId,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(card.status()).toBe(201)
    const cardId = (await card.json()).id as string
    const routes = [
      '/',
      membersPath,
      `/department?id=${department.departmentId}&tab=general`,
      `/department?id=${department.departmentId}&tab=invite`,
      '/departments',
      '/people',
      '/structure',
      '/work',
      '/work/table',
      '/work/calendar',
      '/work/timeline',
      `/work/person?person=${memberId}`,
      `/work/card?id=${cardId}`,
      '/work/templates',
      '/projects',
      `/projects/view?id=${projectId}`,
      '/analytics',
      '/events',
      '/pages',
      '/assistant',
      '/account/ai',
      '/account/telegram',
      '/account/department?tab=members',
    ]
    const browserErrors: string[] = []
    secondPage.on('pageerror', (error) => browserErrors.push(error.message))
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index]!
      await secondPage.goto(route)
      await waitForLoadedRoute(secondPage, route)
      await settleCapture(secondPage)
      await expect(secondPage.locator('main')).not.toContainText('You do not have access')
      await secondPage.screenshot({
        path: resolve(
          screenshots,
          `${String(index + 1).padStart(2, '0')}-${route.split('?')[0]!.replaceAll('/', '-') || 'home'}.png`,
        ),
        fullPage: true,
      })
    }
    expect(browserErrors).toEqual([])
    await secondPage.goto('/structure')
    await secondPage.getByRole('tab', { name: /chart/i }).click()
    await expect(secondPage.getByRole('tree')).toContainText('Anvar Review')
    await expect(secondPage.getByRole('tree')).toContainText('Nodira Review')
    await settleCapture(secondPage)
    await secondPage.screenshot({
      path: resolve(screenshots, '26-chart-two-heads.png'),
      fullPage: true,
    })
    const download = secondPage.waitForEvent('download')
    await secondPage.getByRole('button', { name: /PNG/ }).click()
    await (await download).saveAs(resolve(screenshots, '27-organization-chart-export.png'))

    const memberPage = await member.newPage()
    await memberPage.goto(membersPath)
    await expect(memberPage.getByText('Department heads (2)')).toBeVisible()
    await expect(memberPage.getByRole('button', { name: /Actions for/ })).toHaveCount(0)
    await settleCapture(memberPage)
    await memberPage.screenshot({
      path: resolve(screenshots, '28-member-read-only.png'),
      fullPage: true,
    })

    const adminPage = await admin.newPage()
    await adminPage.goto('/admin/departments')
    // The visible name is deliberately unique to this test run, including repeated Docker runs.
    const departmentButton = adminPage.getByRole('button', { name: departmentName, exact: true })
    await expect(departmentButton).toBeVisible()
    await settleCapture(adminPage)
    await adminPage.screenshot({
      path: resolve(screenshots, '29-admin-departments.png'),
      fullPage: true,
    })
    await departmentButton.click()
    await expect(adminPage.getByRole('dialog')).toContainText('Anvar Review')
    await expect(adminPage.getByRole('dialog')).toContainText('Nodira Review')
    await settleCapture(adminPage)
    await adminPage.screenshot({
      path: resolve(screenshots, '30-admin-department-detail.png'),
      fullPage: true,
    })
    await adminPage.goto('/admin/accounts')
    await waitForLoadedRoute(adminPage, '/admin/accounts')
    await settleCapture(adminPage)
    await adminPage.screenshot({
      path: resolve(screenshots, '31-admin-accounts.png'),
      fullPage: true,
    })

    await secondPage.goto(membersPath)
    await secondPage.getByRole('button', { name: 'Step down as head' }).click()
    await settleCapture(secondPage)
    await secondPage.screenshot({
      path: resolve(screenshots, '32-step-down-confirmation.png'),
      fullPage: true,
    })
    await secondPage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await firstPage.getByRole('button', { name: 'Actions for Aziza Review' }).click()
    await firstPage.getByRole('menuitem', { name: 'Appoint as head' }).click()
    await firstPage.getByRole('dialog').getByRole('button', { name: 'Appoint as head' }).click()
    await expect(firstPage.getByText('Department heads (3)')).toBeVisible()
    await settleCapture(firstPage)
    await firstPage.screenshot({
      path: resolve(screenshots, '33-three-equal-heads.png'),
      fullPage: true,
    })
    await firstPage.getByRole('button', { name: 'Actions for Aziza Review' }).click()
    await firstPage.getByRole('menuitem', { name: 'Remove head role' }).click()
    await firstPage.getByRole('dialog').getByRole('button', { name: 'Remove head role' }).click()
    await expect(firstPage.getByText('Department heads (2)')).toBeVisible()

    const locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl']
    // Each capture reuses this page and account; locale changes must finish in sequence.
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      expect((await authedPatch(second, '/api/v1/me', { locale })).status()).toBe(200)
      await secondPage.setViewportSize({ width: 390, height: 844 })
      await secondPage.evaluate(() => localStorage.setItem('devon_theme', 'dark'))
      await secondPage.goto(membersPath)
      await waitForLoadedRoute(secondPage, membersPath)
      await settleCapture(secondPage)
      const ownRow = secondPage.getByRole('listitem').filter({ hasText: 'Nodira Review' })
      expect(
        await ownRow.evaluate((row) => {
          const bounds = row.getBoundingClientRect()
          const name = row.querySelector('p')!
          return (
            name.clientWidth >= name.scrollWidth &&
            [...row.querySelectorAll('button')].every((button) => {
              const rect = button.getBoundingClientRect()
              return rect.left >= bounds.left && rect.right <= bounds.right
            })
          )
        }),
      ).toBe(true)
      expect(
        await secondPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await ownRow.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await settleCapture(secondPage, false)
      await secondPage.screenshot({
        path: resolve(screenshots, `34-mobile-two-heads-${locale}.png`),
        fullPage: false,
      })
    }
    expect((await authedPatch(second, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    await secondPage.setViewportSize({ width: 1440, height: 1000 })
    await secondPage.evaluate(() => localStorage.setItem('devon_theme', 'light'))

    expect(
      (
        await authedPatch(
          second,
          `/api/v1/departments/${department.departmentId}/invite/approval`,
          { joinRequiresApproval: true },
        )
      ).status(),
    ).toBe(204)
    await joinDepartmentAsNewUser(applicant, {
      login: uniqueLogin('multiple.applicant'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await secondPage.goto(membersPath)
    await expect(secondPage.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await settleCapture(secondPage)
    await secondPage.screenshot({
      path: resolve(screenshots, '35-second-head-join-approval.png'),
      fullPage: true,
    })
    await secondPage.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(secondPage.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    const applicantMe = await (await applicant.request.get('/api/v1/me')).json()
    // /me lists active memberships only; pending requests are deliberately absent.
    expect(applicantMe.memberships).toContainEqual(
      expect.objectContaining({ departmentId: department.departmentId, role: 'member' }),
    )

    await secondPage.goto(membersPath)
    await firstPage.getByRole('button', { name: 'Actions for Nodira Review' }).click()
    await firstPage.getByRole('menuitem', { name: 'Remove head role' }).click()
    await settleCapture(firstPage)
    await firstPage.screenshot({
      path: resolve(screenshots, '36-remove-head-confirmation.png'),
      fullPage: true,
    })
    await firstPage.getByRole('dialog').getByRole('button', { name: 'Remove head role' }).click()
    await expect(firstPage.getByText('Department heads (1)')).toBeVisible()
    await expect(secondPage.getByRole('tab', { name: 'Invite', exact: true })).toHaveCount(0, {
      timeout: 40_000,
    })
    expect(
      (
        await second.request.get(`/api/v1/departments/${department.departmentId}/join-requests`)
      ).status(),
    ).toBe(403)
    await expect(firstPage.getByRole('button', { name: 'Leave department' })).toBeDisabled()
    await settleCapture(firstPage)
    await firstPage.screenshot({
      path: resolve(screenshots, '24-last-head-protected.png'),
      fullPage: true,
    })
    await settleCapture(secondPage)
    await secondPage.screenshot({
      path: resolve(screenshots, '37-demoted-head-read-only.png'),
      fullPage: true,
    })
    await adminPage.goto('/admin/accounts')
    await adminPage.getByRole('textbox', { name: 'Search by name or login' }).fill(headLogin)
    await adminPage
      .getByRole('row')
      .filter({ hasText: 'Anvar Review' })
      .getByRole('button', { name: 'Actions', exact: true })
      .click()
    await adminPage.getByRole('menuitem', { name: 'Lock', exact: true }).click()
    await adminPage
      .getByRole('textbox', { name: 'Reason', exact: true })
      .fill('Local QA final-head safeguard')
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Lock', exact: true }).click()
    await expect(
      adminPage
        .getByRole('dialog')
        .getByText(
          'This account is the last active head of a department. Appoint another active head before locking or deleting it.',
        ),
    ).toBeVisible()
    await settleCapture(adminPage)
    await adminPage.screenshot({
      path: resolve(screenshots, '38-admin-last-head-protected.png'),
      fullPage: true,
    })

    // Leave the review fixture with two heads so the user can inspect the finished workflow.
    await firstPage.getByRole('button', { name: 'Actions for Nodira Review' }).click()
    await firstPage.getByRole('menuitem', { name: 'Appoint as head' }).click()
    await firstPage.getByRole('dialog').getByRole('button', { name: 'Appoint as head' }).click()
    await expect(firstPage.getByText('Department heads (2)')).toBeVisible()
    const reviewAccount = resolve(
      import.meta.dirname,
      '.tmp/devon_qa_heads_docker/review-account.json',
    )
    if (dockerReview)
      await writeFile(
        reviewAccount,
        JSON.stringify({
          login: headLogin,
          password: headPassword,
          departmentId: department.departmentId,
        }),
        { mode: 0o600 },
      )
    expect(browserErrors).toEqual([])
  } finally {
    await Promise.all([admin, first, second, member, applicant].map((context) => context.close()))
  }
})

test('@flow co-head invitation rotation clears another open head session through real realtime delivery', async ({
  browser,
}) => {
  test.skip(!dockerReview, 'Requires the dedicated Docker stack with its real realtime broker')
  test.setTimeout(90_000)
  const admin = await newFlowContext(browser)
  const first = await newFlowContext(browser)
  const second = await newFlowContext(browser)
  const screenshots = dockerReview
    ? resolve(import.meta.dirname, '../../../../artifacts/qa/multiple-heads/live-workflow')
    : test.info().outputPath('multiple-heads')
  try {
    await mkdir(screenshots, { recursive: true })
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(first, admin, {
      headLogin: uniqueLogin('invite.head'),
      headPassword: examplePassword(),
      departmentName: `Shared invitations ${uniqueLogin('qa')}`,
    })
    await joinDepartmentAsNewUser(second, {
      login: uniqueLogin('invite.second'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const context of [first, second])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const secondId = (await (await second.request.get('/api/v1/me')).json()).user.id as string
    expect(
      (
        await authedPatch(
          first,
          `/api/v1/departments/${department.departmentId}/members/${secondId}/role`,
          { role: 'head', expectedVersion: 1 },
        )
      ).status(),
    ).toBe(204)
    const a = await first.newPage(),
      b = await second.newPage()
    const messages: string[] = []
    a.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => messages.push(String(payload))),
    )
    const path = `/department?id=${department.departmentId}&tab=invite`
    await a.goto(path)
    await b.goto(path)
    await a.getByLabel('Set my own password', { exact: true }).fill(examplePassword())
    await a.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(a.getByRole('textbox', { name: 'Password', exact: true })).toBeVisible()
    await expect
      .poll(() => messages.some((message) => message.includes('departments.invite.changed')), {
        timeout: 15_000,
      })
      .toBe(true)
    messages.length = 0
    await b.getByRole('button', { name: 'Rotate password', exact: true }).click()
    await settleCapture(b)
    await b.screenshot({
      path: resolve(screenshots, '39-co-head-invite-rotation.png'),
      fullPage: true,
    })
    await b
      .getByRole('dialog')
      .getByRole('button', { name: 'Rotate password', exact: true })
      .click()
    await expect(b.getByRole('textbox', { name: 'Password', exact: true })).toBeVisible()
    await expect
      .poll(() => messages.some((message) => message.includes('departments.invite.changed')), {
        timeout: 15_000,
      })
      .toBe(true)
    await expect(a.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(0)
    await settleCapture(a)
    await a.screenshot({
      path: resolve(screenshots, '40-other-head-stale-password-cleared.png'),
      fullPage: true,
    })
    const leakedSecret = await b
      .getByRole('textbox', { name: 'Password', exact: true })
      .inputValue()
    expect(messages.every((message) => !message.includes(leakedSecret))).toBe(true)
  } finally {
    await Promise.all([admin, first, second].map((context) => context.close()))
  }
})
