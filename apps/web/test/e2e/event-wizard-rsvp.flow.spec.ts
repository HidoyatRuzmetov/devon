// The local browser journey uses actual API/storage/database fixtures. Telegram and application
// AI are disabled by global-setup's guard; bot transport behavior has separate local sink tests.
import { expect, test } from '@playwright/test'
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

test('@flow event wizard requires Publish, preserves the created detail route and persists RSVP across sessions', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  await loginAsSuperAdmin(admin)
  const head = await newFlowContext(browser)
  const { joinKey, joinPassword } = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('qa.event.head'),
    headPassword: examplePassword(),
    departmentName: 'Local event wizard QA',
  })
  await admin.close()
  const member = await newFlowContext(browser)
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('qa.event.member'),
    password: examplePassword(),
    joinKey,
    joinPassword,
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await head.newPage()
  const title = `Local browser event ${Date.now()}`
  let creates = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/events')
      creates += 1
  })
  await page.goto('/events?new=1')
  const wizard = page.getByRole('dialog', { name: 'Create event', exact: true })
  await wizard.getByRole('textbox', { name: 'Event title' }).fill(title)
  await wizard.getByRole('button', { name: 'Next', exact: true }).click()
  await wizard
    .getByLabel('Starts at', { exact: true })
    .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16))
  await wizard
    .getByLabel('Ends at', { exact: true })
    .fill(new Date(Date.now() + 90_000_000).toISOString().slice(0, 16))
  await wizard.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(wizard.getByLabel('Capacity', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('wizard-capacity.png'), fullPage: true })
  expect(creates).toBe(0)
  const beforePublish = await head.request.get('/api/v1/events')
  expect((await beforePublish.json()).items).toHaveLength(0)
  await wizard.getByLabel('Capacity', { exact: true }).fill('1')
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/events' &&
      response.request().method() === 'POST',
  )
  await wizard.getByRole('button', { name: 'Create event', exact: true }).click()
  const response = await createdResponse
  expect(response.status()).toBe(201)
  const event = (await response.json()) as { id: string }
  expect(creates).toBe(1)
  await expect(page).toHaveURL(
    (url) => url.pathname === '/events' && url.searchParams.get('event') === event.id,
  )
  await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible()

  // A member answers through the real form, then a separate API read and reload prove persistence.
  const memberPage = await member.newPage()
  await memberPage.goto(`/events?event=${event.id}`)
  const detail = memberPage.getByRole('dialog')
  await detail.getByRole('button', { name: "Yes, I'll go", exact: true }).click()
  await detail.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(detail.getByText('1 / 1 spots', { exact: true })).toBeVisible()
  await memberPage.screenshot({
    path: test.info().outputPath('member-rsvp-saved.png'),
    fullPage: true,
  })
  let persisted = await member.request.get(`/api/v1/events/${event.id}`)
  expect((await persisted.json()).myRsvp.status).toBe('yes')
  await memberPage.reload()
  await expect(
    memberPage.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }),
  ).toBeVisible()
  await expect(
    memberPage.getByRole('dialog').getByText('1 / 1 spots', { exact: true }),
  ).toBeVisible()

  // The same real capacity rule returns a waitlist result; the UI and independent head read agree.
  expect(
    (
      await authedPost(head, `/api/v1/events/${event.id}/rsvp`, { status: 'yes', guests: 0 })
    ).status(),
  ).toBe(200)
  await page.reload()
  await expect(page.getByRole('dialog').getByText('1 waitlisted', { exact: true })).toBeVisible()
  persisted = await head.request.get(`/api/v1/events/${event.id}`)
  expect((await persisted.json()).myRsvp.status).toBe('waitlist')

  await memberPage
    .getByRole('dialog')
    .getByRole('button', { name: 'Not going', exact: true })
    .click()
  await memberPage.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await head.request.get(`/api/v1/events/${event.id}`)).json()).myRsvp.status,
    )
    .toBe('yes')
  await memberPage.reload()
  const ownAnswer = await member.request.get(`/api/v1/events/${event.id}`)
  expect((await ownAnswer.json()).myRsvp.status).toBe('no')
  await head.close()
  await member.close()
})
