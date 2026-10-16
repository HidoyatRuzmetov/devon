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

test('@flow carpool drivers edit details and occupied rides cannot be deleted or double booked', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const otherDriver = await newFlowContext(browser)
  const rider = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('carpool.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic carpool management',
    })
    await Promise.all(
      (
        [
          [otherDriver, 'carpool.driver'],
          [rider, 'carpool.rider'],
        ] as const
      ).map(([context, login]) =>
        joinDepartmentAsNewUser(context, {
          login: uniqueLogin(login),
          password: examplePassword(),
          joinKey: department.joinKey,
          joinPassword: department.joinPassword,
        }),
      ),
    )
    await Promise.all(
      [head, otherDriver, rider].map(async (context) => {
        expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      }),
    )
    const created = await authedPost(head, '/api/v1/events', {
      title: 'Synthetic ride arrangements',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    })
    expect(created.status()).toBe(201)
    const event = await created.json()
    const rideResponse = await authedPost(head, `/api/v1/events/${event.id}/carpools`, {
      seats: 1,
      departurePlace: 'Main entrance',
      note: 'Original departure',
    })
    expect(rideResponse.status()).toBe(201)
    const ride = await rideResponse.json()
    const secondResponse = await authedPost(otherDriver, `/api/v1/events/${event.id}/carpools`, {
      seats: 2,
    })
    expect(secondResponse.status()).toBe(201)
    const second = await secondResponse.json()
    expect(
      (
        await authedPost(otherDriver, `/api/v1/events/${event.id}/carpools/${ride.id}/claim`, {
          seats: 1,
        })
      ).status(),
    ).toBe(409)

    const headPage = await head.newPage()
    await headPage.goto(`/events?event=${event.id}`)
    const detail = headPage.getByRole('dialog', {
      name: 'Synthetic ride arrangements',
      exact: true,
    })
    await detail.getByRole('tab', { name: 'Carpool', exact: true }).click()
    const own = detail.locator(`[data-carpool-id="${ride.id}"]`)
    expect(await detail.getByRole('button', { name: 'Claim a seat', exact: true }).count()).toBe(0)
    expect(await detail.getByRole('button', { name: 'Offer a ride', exact: true }).count()).toBe(0)
    await own.getByRole('button', { name: 'Edit ride', exact: true }).click()
    const editor = headPage.getByRole('dialog', { name: 'Edit ride', exact: true })
    await editor.getByLabel('Departure point', { exact: true }).fill('West entrance')
    await editor.getByLabel('Note', { exact: true }).fill('Please arrive five minutes early')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor).not.toBeVisible()
    await expect(own.getByText('West entrance', { exact: true })).toBeVisible()
    const saved = (
      await (await head.request.get(`/api/v1/events/${event.id}/carpools`)).json()
    ).items.find((item: { id: string }) => item.id === ride.id)
    expect(saved).toMatchObject({
      departurePlace: 'West entrance',
      note: 'Please arrive five minutes early',
    })

    expect(
      (
        await authedPost(rider, `/api/v1/events/${event.id}/carpools/${ride.id}/claim`, {
          seats: 1,
        })
      ).status(),
    ).toBe(204)
    expect(
      (
        await authedPost(rider, `/api/v1/events/${event.id}/carpools/${second.id}/claim`, {
          seats: 1,
        })
      ).status(),
    ).toBe(409)
    const riderPage = await rider.newPage()
    await riderPage.goto(`/events?event=${event.id}`)
    const riderDetail = riderPage.getByRole('dialog', {
      name: 'Synthetic ride arrangements',
      exact: true,
    })
    await riderDetail.getByRole('tab', { name: 'Carpool', exact: true }).click()
    await expect(
      riderDetail.getByRole('button', { name: 'Give up seat', exact: true }),
    ).toBeVisible()
    await expect(
      riderDetail.getByRole('button', { name: 'Claim a seat', exact: true }),
    ).toHaveCount(0)
    await expect(
      riderDetail.getByRole('button', { name: 'Offer a ride', exact: true }),
    ).toHaveCount(0)

    await headPage.reload()
    await detail.getByRole('tab', { name: 'Carpool', exact: true }).click()
    await own.getByRole('button', { name: 'Delete ride', exact: true }).click()
    const deletion = headPage.getByRole('dialog', { name: 'Delete ride', exact: true })
    await expect(deletion.getByRole('button', { name: 'Delete ride', exact: true })).toBeDisabled()
    await expect(
      deletion.getByText(/All passengers, including people on the waitlist/),
    ).toBeVisible()
    await headPage.screenshot({
      path: test.info().outputPath('occupied-ride-safe-delete.png'),
      fullPage: true,
    })
    await deletion
      .getByRole('button', { name: 'Close', exact: true })
      .filter({ hasText: /^Close$/ })
      .click()

    await riderDetail.getByRole('button', { name: 'Give up seat', exact: true }).click()
    await expect(
      riderDetail.getByRole('button', { name: 'Give up seat', exact: true }),
    ).toHaveCount(0)
    await headPage.reload()
    await detail.getByRole('tab', { name: 'Carpool', exact: true }).click()
    await own.getByRole('button', { name: 'Delete ride', exact: true }).click()
    await deletion.getByRole('button', { name: 'Delete ride', exact: true }).click()
    await expect(deletion).not.toBeVisible()
    const after = (
      await (await head.request.get(`/api/v1/events/${event.id}/carpools`)).json()
    ).items.find((item: { id: string }) => item.id === ride.id)
    // Deleted offers are excluded from the public list. The API integration regression separately
    // verifies the retained cancelled database row and audit event.
    expect(after).toBeUndefined()
    await expect(own).toHaveCount(0)
    await headPage.screenshot({
      path: test.info().outputPath('carpool-management-complete.png'),
      fullPage: true,
    })
  } finally {
    await Promise.all([admin.close(), head.close(), otherDriver.close(), rider.close()])
  }
})
