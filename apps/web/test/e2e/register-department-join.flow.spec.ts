// @flow -- H30.1 flow 1/6: register -> department (request + super_admin approval) -> invite -> join.
// Traces the real UI for the two steps a visitor actually drives (registration, the create-request
// stepper, joining by key+password) and the real `/api/v1/*` contract for the one step only a
// super_admin can do (approving the request) -- see `flow-api.ts`'s header for why that split is
// deliberate, not a shortcut.
import { expect, test } from '@playwright/test'
import {
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  stripSecureCookies,
  uniqueLogin,
} from './flow-api.js'

test('@flow register -> department request -> super_admin approval -> invite -> join', async ({
  page,
  browser,
}) => {
  const headLogin = uniqueLogin('flow.head')
  const headPassword = examplePassword()
  const departmentName = `Raqamli xizmatlar ${headLogin.slice(-8)}`

  // 1. Register the future head through the real form (accounts/register-screen.tsx).
  await page.goto('/register')
  await page.getByLabel('Ism', { exact: true }).fill('Aziza')
  await page.getByLabel('Familiya').fill('Karimova')
  await page.getByLabel('Login').fill(headLogin)
  await page.getByLabel('Parol').fill(headPassword)
  await page.getByRole('button', { name: 'Hisob yaratish' }).click()
  await expect(page).toHaveURL(/\/departments$/)

  // 2. File a department request through the real 3-step stepper (create-request-screen.tsx). A
  //    brand-new head has no departments yet, so `/departments` itself would show the landing choice
  //    cards (create-request-screen.tsx's own header describes that state) -- going straight to
  //    `/departments/new` exercises the same real stepper without depending on the landing cards'
  //    exact clickable element shape.
  await page.goto('/departments/new')
  await page.getByLabel('Boshqarma nomi').fill(departmentName)
  await page.getByRole('button', { name: 'Keyingisi' }).click()
  await page.getByRole('button', { name: 'Keyingisi' }).click()
  await page.getByRole('button', { name: 'Soʻrov yuborish' }).click()
  await expect(page.getByText('Soʻrovingiz koʻrib chiqilmoqda')).toBeVisible()

  // 3. A separate super_admin session approves the request -- the one step no ordinary UI click can
  //    do (design.md §2.2: "approved once by the super admin"). Real `/api/v1/*` contract, not a
  //    direct DB write.
  const superAdminCtx = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminCtx)

  const pendingRes = await superAdminCtx.request.get('/api/v1/departments/requests?status=pending')
  expect(pendingRes.status()).toBe(200)
  const { requests } = (await pendingRes.json()) as { requests: { id: string; name: string }[] }
  const ourRequest = requests.find((r) => r.name === departmentName)
  expect(ourRequest, `expected a pending request named ${departmentName}`).toBeTruthy()

  const superAdminCsrf = await csrfToken(superAdminCtx)
  const approveRes = await superAdminCtx.request.post(
    `/api/v1/departments/requests/${ourRequest!.id}/approve`,
    { headers: { 'x-csrf-token': superAdminCsrf } },
  )
  expect(approveRes.status()).toBe(200)
  const approved = (await approveRes.json()) as {
    departmentId: string
    joinKey: string
    joinPassword: string
  }
  await superAdminCtx.close()

  // 4. Back as the head: the department now shows as an active one of "my departments". Scoped to a
  //    heading (not a bare `getByText`) -- the same name also appears in the sidebar's department
  //    switcher (visible + a screen-reader-only echo of it), which would otherwise make this locator
  //    ambiguous.
  await page.goto('/departments')
  await expect(page.getByRole('heading', { name: departmentName })).toBeVisible()

  // 5. A second, brand-new visitor joins by key + password through the real `/join` screen.
  const memberLogin = uniqueLogin('flow.member')
  const memberPassword = examplePassword()
  const memberContext = await newFlowContext(browser)
  const memberPage = await memberContext.newPage()

  await memberPage.goto('/register')
  await memberPage.getByLabel('Ism', { exact: true }).fill('Bekzod')
  await memberPage.getByLabel('Familiya').fill('Yusupov')
  await memberPage.getByLabel('Login').fill(memberLogin)
  await memberPage.getByLabel('Parol').fill(memberPassword)
  await memberPage.getByRole('button', { name: 'Hisob yaratish' }).click()
  await expect(memberPage).toHaveURL(/\/departments$/)

  await memberPage.goto(`/join?key=${approved.joinKey}`)
  await expect(memberPage.getByText(departmentName)).toBeVisible()
  await memberPage.getByLabel('Parol').fill(approved.joinPassword)
  await memberPage.getByRole('button', { name: 'Qoʻshilish' }).click()
  await expect(memberPage.getByText('Boshqarmaga qoʻshildingiz')).toBeVisible()

  await memberContext.close()

  // 6. The head sees the new member in the department's real roster (cross-checks the join actually
  //    landed, not just that the join screen said so). `page.request` is not the page's own network
  //    stack (see `stripSecureCookies`'s header) so the real-UI-login session cookie needs the same
  //    `secure: false` re-application `flow-api.ts`'s own register/login helpers do automatically.
  await stripSecureCookies(page.context())
  const membersRes = await page.request.get(`/api/v1/departments/${approved.departmentId}/members`)
  expect(membersRes.status()).toBe(200)
  const { members } = (await membersRes.json()) as { members: { role: string }[] }
  expect(members).toHaveLength(2)
  expect(members.some((m) => m.role === 'head')).toBe(true)
  expect(members.some((m) => m.role === 'member')).toBe(true)
})
