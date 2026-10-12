import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_DB_NAME, FLOW_WEB_BASE_URL } from './flow-env.js'

if (FLOW_DB_NAME !== 'devon_flow_e2e_dept_decision') {
  throw new Error('Department decision proof requires its exact owned local database')
}

type Request = {
  id: string
  name: string
  status: 'pending' | 'rejected' | 'approved'
  reason: string | null
  units: { name: string }[]
  createdDepartmentId: string | null
}

async function fixture(browser: Browser) {
  const contexts: BrowserContext[] = []
  const errors: string[] = []
  const foreign: string[] = []
  const decisions: { path: string; status: number }[] = []
  async function context() {
    const value = await newFlowContext(browser)
    contexts.push(value)
    await value.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
    await value.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === FLOW_WEB_BASE_URL) await route.continue()
      else {
        foreign.push(url.hostname)
        await route.abort('blockedbyclient')
      }
    })
    value.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        const url = new URL(response.url())
        if (/\/departments\/requests\/[^/]+\/(approve|reject)$/.test(url.pathname)) {
          decisions.push({ path: url.pathname, status: response.status() })
        }
      })
    })
    return value
  }
  const admin = await context()
  const head = await context()
  await loginAsSuperAdmin(admin)
  await registerUser(head, {
    login: uniqueLogin('decision.head'),
    password: examplePassword(),
    givenName: 'Synthetic',
    familyName: 'Requester',
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  expect((await authedPatch(admin, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  return {
    admin,
    head,
    decisions,
    async requests() {
      const response = await head.request.get('/api/v1/departments/requests/mine')
      expect(response.status()).toBe(200)
      return ((await response.json()) as { requests: Request[] }).requests
    },
    async close() {
      await test.info().attach('sanitized-department-decisions', {
        body: JSON.stringify({ decisions, errors, foreign }, null, 2),
        contentType: 'application/json',
      })
      await Promise.all(contexts.map((value) => value.close()))
      expect(errors).toEqual([])
      expect(foreign).toEqual([])
    },
  }
}

async function sendRequest(page: Page, name: string, unitName: string) {
  await page.getByLabel('Department name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Add a unit', exact: true }).click()
  await page.getByPlaceholder('Unit name', { exact: true }).fill(unitName)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('combobox', { name: /^Language/ }).selectOption('en')
  const submitted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/departments/requests' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send request', exact: true }).click()
  expect((await submitted).status()).toBe(201)
  await expect(
    page.getByRole('heading', {
      name: 'Your request is under review',
      exact: true,
    }),
  ).toBeVisible()
}

test('@qa admin request sheet discards closed rejection drafts and rejection can be resubmitted and approved with its unit', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const headPage = await f.head.newPage()
    const adminPage = await f.admin.newPage()
    await headPage.setViewportSize({ width: 1280, height: 800 })
    await adminPage.setViewportSize({ width: 1280, height: 800 })
    const name = `Synthetic management request ${test.info().project.name}`
    const unit = 'Reporting unit'
    const reason = 'Please use the revised department name.'
    await headPage.goto('/departments/new')
    await sendRequest(headPage, name, unit)
    const [initial] = await f.requests()
    expect(initial).toMatchObject({
      name,
      status: 'pending',
      reason: null,
      units: [{ name: unit }],
    })

    await adminPage.goto('/departments/requests')
    await adminPage.getByText(name, { exact: true }).click()
    const sheet = adminPage.getByRole('dialog', { name, exact: true })
    await expect(sheet.getByText(unit, { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Reject', exact: true }).click()
    await sheet.getByRole('textbox', { name: 'Reason', exact: true }).fill('Abandoned draft')
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).not.toBeVisible()
    await adminPage.getByText(name, { exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect(sheet.getByRole('textbox', { name: 'Reason', exact: true })).toHaveCount(0)
    expect(f.decisions).toEqual([])
    await sheet.screenshot({ path: test.info().outputPath('closed-draft-discarded.png') })

    await sheet.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(sheet.getByRole('textbox', { name: 'Reason', exact: true })).toHaveValue('')
    await sheet.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason)
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    expect((await f.requests())[0]!.status).toBe('pending')
    expect(f.decisions).toEqual([])
    await sheet.getByRole('button', { name: 'Reject', exact: true }).click()
    await sheet.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason)
    const rejected = adminPage.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/${initial!.id}/reject`),
    )
    await sheet.getByRole('button', { name: 'Reject', exact: true }).click()
    expect((await rejected).status()).toBe(204)
    await expect(sheet).not.toBeVisible()
    expect((await f.requests())[0]).toMatchObject({
      id: initial!.id,
      status: 'rejected',
      reason,
    })
    await adminPage.getByRole('tab', { name: 'All', exact: true }).click()
    await expect(adminPage.getByText(name, { exact: true })).toBeVisible()

    await headPage.reload()
    await expect(
      headPage.getByRole('heading', { name: 'Your request was rejected', exact: true }),
    ).toBeVisible()
    await expect(headPage.getByText('The super admin will review your request soon.')).toHaveCount(
      0,
    )
    await expect(headPage.getByText(`Reason: ${reason}`, { exact: true })).toBeVisible()
    await headPage.screenshot({
      path: test.info().outputPath('requester-rejection.png'),
    })
    await headPage.getByRole('button', { name: 'Send another request', exact: true }).click()
    await expect(headPage.getByLabel('Department name', { exact: true })).toBeVisible()
    await expect(headPage.getByLabel('Department name', { exact: true })).toHaveValue('')
    const revised = `Synthetic management revised ${test.info().project.name}`
    await sendRequest(headPage, revised, unit)
    const [resubmitted] = await f.requests()
    expect(resubmitted).toMatchObject({
      name: revised,
      status: 'pending',
      reason: null,
    })
    expect(resubmitted!.id).not.toBe(initial!.id)

    await adminPage.reload()
    await adminPage.getByRole('tab', { name: 'Pending', exact: true }).click()
    await adminPage.getByText(revised, { exact: true }).click()
    const approvedSheet = adminPage.getByRole('dialog', {
      name: revised,
      exact: true,
    })
    const approved = adminPage.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/${resubmitted!.id}/approve`),
    )
    await approvedSheet.getByRole('button', { name: 'Approve', exact: true }).click()
    const response = await approved
    expect(response.status()).toBe(200)
    const departmentId = ((await response.json()) as { departmentId: string }).departmentId
    await expect(approvedSheet).not.toBeVisible()
    expect((await f.requests())[0]).toMatchObject({
      id: resubmitted!.id,
      status: 'approved',
      createdDepartmentId: departmentId,
    })
    const overview = await f.head.request.get(`/api/v1/departments/${departmentId}/units`)
    expect(overview.status()).toBe(200)
    expect(await overview.json()).toMatchObject({
      myRole: 'head',
      units: [{ name: unit }],
    })
    await headPage.goto('/departments')
    await expect(headPage.getByRole('heading', { name: revised, exact: true })).toBeVisible()
    await headPage.reload()
    await expect(headPage.getByRole('heading', { name: revised, exact: true })).toBeVisible()
    await headPage.screenshot({
      path: test.info().outputPath('approved-head-department.png'),
    })
    expect(f.decisions).toEqual([
      {
        path: `/api/v1/departments/requests/${initial!.id}/reject`,
        status: 204,
      },
      {
        path: `/api/v1/departments/requests/${resubmitted!.id}/approve`,
        status: 200,
      },
    ])
  } finally {
    await f.close()
  }
})
