// @flow -- H30.1 flow 6/6: the super admin's pause switch (TECH-SPEC §11) driven through the real
// `/admin/departments` console -- row -> drawer -> reason sheet -> pause -- then a department member
// finding writes refused (reads still allowed) while paused, and both restored on resume.
import { expect, test } from '@playwright/test'
import {
  authedPost,
  createApprovedDepartment,
  examplePassword,
  newFlowContext,
  loginAsSuperAdmin,
  uniqueLogin,
} from './flow-api.js'

test('@flow admin pause: paused blocks writes not reads, resume restores both, via the real console', async ({
  browser,
}) => {
  const superAdminContext = await newFlowContext(browser)
  const superAdminPage = await superAdminContext.newPage()
  await loginAsSuperAdmin(superAdminContext)

  const headContext = await newFlowContext(browser)
  const head = { login: uniqueLogin('flow.ahead'), password: examplePassword() }
  const departmentName = `Pause flow ${head.login.slice(-8)}`
  await createApprovedDepartment(headContext, superAdminContext, {
    headLogin: head.login,
    headPassword: head.password,
    departmentName,
  })

  // Sanity: a write works before anything is paused.
  const beforePause = await authedPost(headContext, '/api/v1/cards', {
    title: 'Before pause',
  })
  expect(beforePause.status()).toBe(201)

  // 1. Real UI: find the department in the console table and open its drawer.
  await superAdminPage.goto('/admin/departments')
  await superAdminPage
    .getByPlaceholder('Boʻlim nomi boʻyicha qidirish')
    .fill(departmentName)
  const row = superAdminPage.getByRole('button', { name: departmentName })
  await expect(row).toBeVisible()
  await row.click()

  // 2. Pause, with a reason, through the real sheet.
  await superAdminPage.getByRole('button', { name: 'Toʻxtatish', exact: true }).click()
  await superAdminPage.getByLabel('Sabab').fill('Flow test: scheduled maintenance')
  await superAdminPage.getByRole('button', { name: 'Toʻxtatish', exact: true }).click()
  await expect(superAdminPage.getByText('Boʻlim toʻxtatildi')).toBeVisible()

  // 3. While paused: the department's board is still readable, but a write is refused.
  const boardWhilePaused = await headContext.request.get('/api/v1/board')
  expect(boardWhilePaused.status()).toBe(200)
  const writeWhilePaused = await authedPost(headContext, '/api/v1/cards', {
    title: 'Should be refused while paused',
  })
  expect(writeWhilePaused.status()).toBeGreaterThanOrEqual(400)
  expect(writeWhilePaused.status()).toBeLessThan(500)

  // 4. Resume, through the real console again.
  await superAdminPage.goto('/admin/departments')
  await superAdminPage
    .getByPlaceholder('Boʻlim nomi boʻyicha qidirish')
    .fill(departmentName)
  await superAdminPage.getByRole('button', { name: departmentName }).click()
  await superAdminPage.getByRole('button', { name: 'Davom ettirish' }).click()
  await expect(superAdminPage.getByText('Boʻlim qayta faollashtirildi')).toBeVisible()

  // 5. Writes work again.
  const afterResume = await authedPost(headContext, '/api/v1/cards', {
    title: 'After resume',
  })
  expect(afterResume.status()).toBe(201)

  await superAdminContext.close()
  await headContext.close()
})
