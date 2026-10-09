import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
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
import { FLOW_WEB_BASE_URL } from './flow-env.js'

async function fixture(browser: Browser) {
  const head = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const external: string[] = []
  await Promise.all(
    [head, admin, member].map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('nested.event.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic Nested Events Department',
  })
  await admin.close()
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('nested.event.member'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const response = await authedPost(head, '/api/v1/events', {
    title: 'Synthetic Nested Event',
    category: 'other',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
  })
  expect(response.status()).toBe(201)
  const event = (await response.json()) as { id: string; startsAt: string; endsAt: string }
  const headPage = await head.newPage()
  const memberPage = await member.newPage()
  const open = async (page: Page, tab: string) => {
    await page.goto(`/events?event=${event.id}`)
    const detail = page.getByRole('dialog', { name: 'Synthetic Nested Event', exact: true })
    await expect(detail).toBeVisible()
    await detail.getByRole('tab', { name: tab, exact: true }).click()
    return detail
  }
  return {
    head,
    member,
    headPage,
    memberPage,
    event,
    open,
    close: async () => {
      await Promise.all([head.close(), member.close()])
      expect(external).toEqual([])
    },
  }
}

test('feedback stars support the radio keyboard arrow and single Tab entry convention', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const detail = await f.open(f.memberPage, 'Feedback')
    const three = detail.getByRole('radio', { name: '3', exact: true })
    const four = detail.getByRole('radio', { name: '4', exact: true })
    await three.click()
    await f.memberPage.keyboard.press('ArrowRight')
    await expect(four).toBeChecked()
    await expect(four).toBeFocused()
    await f.memberPage.keyboard.press('Tab')
    await expect(
      detail.getByRole('textbox', { name: 'Comment (optional)', exact: true }),
    ).toBeFocused()
    await detail.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/feedback`)).json())
        .myFeedback.rating,
    ).toBe(4)
  } finally {
    await f.close()
  }
})

test('a delayed real feedback reread cannot overwrite a newer comment draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const detail = await f.open(f.memberPage, 'Feedback')
    await detail.getByRole('radio', { name: '4', exact: true }).click()
    const comment = detail.getByRole('textbox', { name: 'Comment (optional)', exact: true })
    await comment.fill('Synthetic original feedback')
    await detail.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.memberPage.route(`**/api/v1/events/${f.event.id}/feedback`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response })
    })
    await comment.fill('Synthetic submitted feedback revision')
    await detail.getByRole('button', { name: 'Update', exact: true }).click()
    await committed
    await comment.fill('Synthetic next unsaved feedback draft')
    release()
    await expect(
      detail.getByText('Synthetic submitted feedback revision', { exact: true }),
    ).toBeVisible()
    await expect(comment).toHaveValue('Synthetic next unsaved feedback draft')
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/feedback`)).json())
        .myFeedback.comment,
    ).toBe('Synthetic submitted feedback revision')
  } finally {
    release()
    await f.close()
  }
})

test('poll Create Vote Change vote and Undo preserve the authoritative selected option', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    const detail = await f.open(f.headPage, 'Polls')
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    const form = detail.locator('form')
    await form
      .getByRole('textbox', { name: 'Question', exact: true })
      .fill('Synthetic lunch choice')
    await form.getByPlaceholder('Option text', { exact: true }).nth(0).fill('Synthetic option A')
    await form.getByPlaceholder('Option text', { exact: true }).nth(1).fill('Synthetic option B')
    await form.getByRole('button', { name: 'Create a poll', exact: true }).click()
    await expect(detail.getByText('Synthetic lunch choice', { exact: true })).toBeVisible()
    const member = await f.open(f.memberPage, 'Polls')
    await member.getByRole('radio', { name: 'Synthetic option A', exact: true }).check()
    await member.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(member.getByRole('button', { name: 'Change vote', exact: true })).toBeVisible()
    await member.getByRole('button', { name: 'Change vote', exact: true }).click()
    await member.getByRole('radio', { name: 'Synthetic option B', exact: true }).check()
    await member.getByRole('button', { name: 'Vote', exact: true }).click()
    const hiddenUndo = f.memberPage.getByRole('button', {
      name: 'Undo',
      exact: true,
      includeHidden: true,
    })
    await expect(hiddenUndo).toBeVisible({ timeout: 5_000 })
    await testInfo.attach('poll-undo-modal-boundary.json', {
      contentType: 'application/json',
      body: JSON.stringify(
        await hiddenUndo.evaluate((element) => ({
          hiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
          pointerEvents: getComputedStyle(element).pointerEvents,
        })),
      ),
    })
    const undo = f.memberPage.getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toBeVisible()
    await undo.click({ timeout: 5_000 })
    await expect(
      f.memberPage.getByText('Your previous vote was restored', { exact: true }),
    ).toBeVisible()
    const poll = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/polls`)).json())
      .items[0]
    expect(
      poll.options.find((option: { label: string }) => option.label === 'Synthetic option A')
        .votedByMe,
    ).toBe(true)
    await expect(member.getByText('Synthetic option A', { exact: true })).toHaveClass(/font-medium/)
    await member.getByRole('button', { name: 'Change vote', exact: true }).click()
    await expect(
      member.getByRole('radio', { name: 'Synthetic option A', exact: true }),
    ).toBeChecked()
    await expect(
      member.getByRole('radio', { name: 'Synthetic option B', exact: true }),
    ).not.toBeChecked()
  } finally {
    await f.close()
  }
})

test("shared item Claim and Release persist for the member and protect another person's claim", async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const head = await f.open(f.headPage, 'Items')
    await head
      .getByRole('textbox', { name: 'Add an item', exact: true })
      .fill('Synthetic shared tea')
    await head.getByRole('button', { name: 'Add an item', exact: true }).click()
    await expect(head.getByText('Synthetic shared tea', { exact: true })).toBeVisible()
    const member = await f.open(f.memberPage, 'Items')
    await member.getByRole('button', { name: "I'll bring this", exact: true }).click()
    await expect(member.getByText("You're bringing this", { exact: true })).toBeVisible()
    let saved = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/items`)).json())
      .items[0]
    expect(saved.claimedByMe).toBe(true)
    await f.headPage.reload()
    await f.headPage.getByRole('tab', { name: 'Items', exact: true }).click()
    await expect(head.getByText('Bringing it: Test Member', { exact: true })).toBeVisible()
    await expect(head.getByRole('button', { name: "I'll bring this", exact: true })).toHaveCount(0)
    await expect(head.getByRole('button', { name: 'Give up', exact: true })).toHaveCount(0)
    await member.getByRole('button', { name: 'Give up', exact: true }).click()
    await expect(member.getByRole('button', { name: "I'll bring this", exact: true })).toBeVisible()
    saved = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/items`)).json())
      .items[0]
    expect(saved.claimedBy).toBeNull()
  } finally {
    await f.close()
  }
})

test('carpool Offer Claim Release and modal Undo preserve the actual seat and recover a refused Undo', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const head = await f.open(f.headPage, 'Carpool')
    await head.getByRole('button', { name: 'Offer a ride', exact: true }).click()
    const form = head.locator('form')
    await form.getByRole('spinbutton', { name: 'Seats available', exact: true }).fill('1')
    await form
      .getByRole('textbox', { name: 'Departure point', exact: true })
      .fill('Synthetic north gate')
    await form.getByRole('button', { name: 'Offer a ride', exact: true }).click()
    await expect(head.getByText('Synthetic north gate', { exact: true })).toBeVisible()
    await expect(
      head.getByText("The driver can't claim a seat on their own offer", { exact: true }),
    ).toBeVisible()
    const member = await f.open(f.memberPage, 'Carpool')
    await member.getByRole('button', { name: 'Claim a seat', exact: true }).click()
    await expect(member.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(member.getByText('1 / 1 seats taken', { exact: true })).toBeVisible()
    await member.getByRole('button', { name: 'Give up seat', exact: true }).click()
    const undo = member.getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toBeVisible()
    const resource = `/api/v1/events/${f.event.id}/carpools`
    let saved = (await (await f.member.request.get(resource)).json()).items[0]
    expect(saved.seatsClaimed).toBe(0)
    let refuse = true
    await f.memberPage.route(`**${resource}/*/claim`, (route) => {
      if (!refuse || route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Synthetic Undo refusal',
          status: 503,
          code: 'internal',
        }),
      })
    })
    await undo.click()
    await expect(
      member.getByText('Something went wrong. Please try again.', { exact: true }),
    ).toBeVisible()
    expect((await (await f.member.request.get(resource)).json()).items[0].seatsClaimed).toBe(0)
    refuse = false
    await undo.click()
    await expect(member.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(undo).toHaveCount(0)
    saved = (await (await f.member.request.get(resource)).json()).items[0]
    expect(saved.seatsClaimed).toBe(1)
    expect(saved.passengers[0]).toMatchObject({ seatsClaimed: 1, status: 'confirmed' })
  } finally {
    await f.close()
  }
})

test('RSVP guests Maybe cancellation and modal Undo persist the actual answer', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const member = await f.open(f.memberPage, 'RSVP')
    const note = member.getByRole('textbox', { name: 'Note (optional)', exact: true })
    await note.fill('Synthetic RSVP accessibility note')
    await member.getByRole('button', { name: '+', exact: true }).click()
    await member.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(member.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    const path = `/api/v1/events/${f.event.id}`
    expect((await (await f.member.request.get(path)).json()).myRsvp).toMatchObject({
      status: 'yes',
      guests: 1,
      note: 'Synthetic RSVP accessibility note',
    })
    await member.getByRole('button', { name: 'Maybe', exact: true }).click()
    await member.getByRole('button', { name: 'Update', exact: true }).click()
    await expect
      .poll(async () => (await (await f.member.request.get(path)).json()).myRsvp.status)
      .toBe('maybe')
    const undo = member.getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toBeVisible({ timeout: 5_000 })
    await undo.click({ timeout: 5_000 })
    await expect
      .poll(async () => (await (await f.member.request.get(path)).json()).myRsvp.status)
      .toBe('yes')
    await expect(member.getByRole('button', { name: '+', exact: true })).toBeVisible()
    await member.getByRole('button', { name: 'Not going', exact: true }).click()
    await member.getByRole('button', { name: 'Update', exact: true }).click()
    await expect
      .poll(async () => (await (await f.member.request.get(path)).json()).myRsvp.status)
      .toBe('no')
    const rsvps = (await (await f.member.request.get(`${path}/rsvps`)).json()).items
    expect(rsvps[0]).toMatchObject({ status: 'no', guests: 0 })
  } finally {
    await f.close()
  }
})

for (const [tab, resource, empty] of [
  ['RSVP', 'rsvps', 'No one has answered yet'],
  ['Discussion', 'comments', 'No comments yet. Be the first.'],
  ['Items', 'items', 'The list is empty for now'],
  ['Carpool', 'carpools', 'No carpool offers yet'],
  ['Polls', 'polls', 'No polls yet'],
  ['Photos', 'photos', 'No photos yet'],
  ['Feedback', 'feedback', 'No feedback yet'],
] as const) {
  test(`${tab} child read recovery exposes Retry and loads the real empty state`, async ({
    browser,
  }) => {
    const f = await fixture(browser)
    try {
      let refuse = true
      const path = `/api/v1/events/${f.event.id}/${resource}`
      await f.memberPage.route(`**${path}`, (route) => {
        if (route.request().method() !== 'GET' || !refuse) return route.continue()
        return route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Synthetic child read refusal',
            status: 503,
            code: 'internal',
          }),
        })
      })
      const detail = await f.open(f.memberPage, tab)
      await expect(detail.getByText("Couldn't load events", { exact: true })).toBeVisible()
      const retry = detail.getByRole('button', { name: 'Retry', exact: true })
      await expect(retry).toBeVisible()
      refuse = false
      const read = f.memberPage.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && new URL(response.url()).pathname === path,
      )
      await retry.click()
      expect((await read).status()).toBe(200)
      await expect(detail.getByText(empty, { exact: true })).toBeVisible()
      expect((await (await f.member.request.get(path)).json()).items).toHaveLength(0)
    } finally {
      await f.close()
    }
  })
}

test('a held real comment save preserves the next typed draft and ordinary discussion CRUD persists', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const detail = await f.open(f.memberPage, 'Discussion')
    // This journey tests an acknowledged write after the initial read. A separate native-pointer
    // journey below explicitly covers submitting as the pending read settles.
    await expect(detail.getByText('No comments yet. Be the first.', { exact: true })).toBeVisible()
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.memberPage.route(`**/api/v1/events/${f.event.id}/comments`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      received()
      await gate
      await route.fulfill({ response })
    })
    const draft = detail.getByPlaceholder('Write a comment', { exact: true })
    await draft.fill('Synthetic first saved discussion')
    await expect(draft).toHaveValue('Synthetic first saved discussion')
    await detail.getByRole('button', { name: 'Post', exact: true }).click()
    await committed
    await draft.fill('Synthetic next discussion draft')
    release()
    await expect(
      detail.getByText('Synthetic first saved discussion', { exact: true }),
    ).toBeVisible()
    await expect(draft).toHaveValue('Synthetic next discussion draft')
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/comments`)).json()).items,
    ).toHaveLength(1)
    f.memberPage.once('dialog', (dialog) => dialog.accept())
    await detail.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(detail.getByText('Synthetic first saved discussion', { exact: true })).toBeHidden()
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/comments`)).json()).items,
    ).toHaveLength(0)
  } finally {
    release()
    await f.close()
  }
})

test('a held real shared item save preserves the next label and quantity draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const detail = await f.open(f.headPage, 'Items')
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.headPage.route(`**/api/v1/events/${f.event.id}/items`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      received()
      await gate
      await route.fulfill({ response })
    })
    const label = detail.getByRole('textbox', { name: 'Add an item', exact: true })
    const quantity = detail.getByRole('spinbutton', { name: 'Quantity', exact: true })
    await label.fill('Synthetic saved biscuits')
    await quantity.fill('2')
    await detail.getByRole('button', { name: 'Add an item', exact: true }).click()
    await committed
    await label.fill('Synthetic next tea draft')
    await quantity.fill('5')
    release()
    await expect(detail.getByText('Synthetic saved biscuits ×2', { exact: true })).toBeVisible()
    await expect(label).toHaveValue('Synthetic next tea draft')
    await expect(quantity).toHaveValue('5')
    const items = (await (await f.head.request.get(`/api/v1/events/${f.event.id}/items`)).json())
      .items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Synthetic saved biscuits', quantity: 2 })
  } finally {
    release()
    await f.close()
  }
})

test('anonymous feedback stays selected after reload and updating it cannot publish the author accidentally', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const detail = await f.open(f.memberPage, 'Feedback')
    await detail.getByRole('radio', { name: '5', exact: true }).click()
    await detail
      .getByRole('textbox', { name: 'Comment (optional)', exact: true })
      .fill('Synthetic anonymous feedback')
    await detail.getByRole('checkbox', { name: 'Leave anonymously', exact: true }).check()
    await detail.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    let saved = await (await f.member.request.get(`/api/v1/events/${f.event.id}/feedback`)).json()
    expect(saved.myFeedback.author).toBeNull()
    await f.memberPage.reload()
    await f.memberPage
      .getByRole('dialog')
      .getByRole('tab', { name: 'Feedback', exact: true })
      .click()
    const updated = f.memberPage.getByRole('dialog')
    await expect(updated.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    const anonymousStayedSelected = await updated
      .getByRole('checkbox', { name: 'Leave anonymously', exact: true })
      .isChecked()
    await updated
      .getByRole('textbox', { name: 'Comment (optional)', exact: true })
      .fill('Synthetic revised anonymous feedback')
    await updated.getByRole('button', { name: 'Update', exact: true }).click()
    await expect(
      updated.getByText('Synthetic revised anonymous feedback', { exact: true }),
    ).toBeVisible()
    saved = await (await f.member.request.get(`/api/v1/events/${f.event.id}/feedback`)).json()
    expect(saved.myFeedback.author).toBeNull()
    expect(saved.myFeedback.comment).toBe('Synthetic revised anonymous feedback')
    expect(anonymousStayedSelected).toBe(true)
  } finally {
    await f.close()
  }
})

test('a linked local photo has a visible keyboard Delete target and real metadata removal', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  try {
    const pixels = await readFile(new URL('./fixtures/account-avatar.png', import.meta.url))
    await f.memberPage.route('**/qa-synthetic-photo.png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: pixels }),
    )
    const detail = await f.open(f.memberPage, 'Photos')
    await detail
      .getByRole('textbox', { name: 'Image link', exact: true })
      .fill(`${FLOW_WEB_BASE_URL}/qa-synthetic-photo.png`)
    await detail
      .getByRole('textbox', { name: 'Caption (optional)', exact: true })
      .fill('Synthetic local photo')
    const add = detail.getByRole('button', { name: 'Add a link', exact: true })
    await add.click()
    const remove = detail.getByRole('button', { name: 'Delete', exact: true })
    await expect(
      detail.getByRole('img', { name: 'Synthetic local photo', exact: true }),
    ).toBeVisible()
    const caption = detail.getByRole('textbox', { name: 'Caption (optional)', exact: true })
    await caption.focus()
    await expect(caption).toBeFocused()
    await f.memberPage.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    await f.memberPage.screenshot({ path: testInfo.outputPath('photo-keyboard-delete.png') })
    expect(await remove.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
    await f.memberPage.keyboard.press('Enter')
    await expect(
      detail.getByRole('img', { name: 'Synthetic local photo', exact: true }),
    ).toBeHidden()
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/photos`)).json()).items,
    ).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('organizer edit Back Save and cancel confirmation persist while ordinary members cannot manage', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const member = await f.open(f.memberPage, 'RSVP')
    await expect(member.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0)
    await member.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(member.getByRole('button', { name: 'Update', exact: true })).toBeVisible()
    const detail = await f.open(f.headPage, 'RSVP')
    await detail.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = f.headPage.getByRole('dialog', { name: 'Edit', exact: true })
    await expect(edit.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
      'Synthetic Nested Event',
    )
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await edit
      .getByRole('textbox', { name: 'Place', exact: true })
      .fill('Synthetic west meeting room')
    await edit.getByRole('button', { name: 'Back', exact: true }).click()
    await edit
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Synthetic updated description')
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(edit.getByRole('textbox', { name: 'Place', exact: true })).toHaveValue(
      'Synthetic west meeting room',
    )
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(edit).toBeHidden()
    let saved = await (await f.head.request.get(`/api/v1/events/${f.event.id}`)).json()
    expect(saved).toMatchObject({
      place: 'Synthetic west meeting room',
      description: 'Synthetic updated description',
      status: 'open',
    })
    expect(saved.startsAt).toBe(f.event.startsAt)
    expect(saved.endsAt).toBe(f.event.endsAt)
    expect(saved.updatedSummary.map((change: { field: string }) => change.field)).not.toContain(
      'startsAt',
    )
    expect(saved.updatedSummary.map((change: { field: string }) => change.field)).not.toContain(
      'endsAt',
    )
    await expect(
      detail.getByRole('paragraph').filter({ hasText: /^Synthetic updated description$/ }),
    ).toBeVisible()
    await detail.getByRole('button', { name: 'More actions', exact: true }).click()
    await f.headPage.getByRole('menuitem', { name: 'Cancel event', exact: true }).click()
    const cancel = f.headPage.getByRole('dialog', { name: 'Cancel event', exact: true })
    await expect(cancel.getByText(/1 people who RSVPed/)).toBeVisible()
    await expect(cancel.getByRole('button', { name: 'Yes, cancel', exact: true })).toBeDisabled()
    await cancel.getByRole('textbox', { name: 'Reason', exact: true }).fill('   ')
    await expect(cancel.getByRole('button', { name: 'Yes, cancel', exact: true })).toBeDisabled()
    await cancel.getByRole('button', { name: 'No, keep it', exact: true }).click()
    expect((await (await f.head.request.get(`/api/v1/events/${f.event.id}`)).json()).status).toBe(
      'open',
    )
    await detail.getByRole('button', { name: 'More actions', exact: true }).click()
    await f.headPage.getByRole('menuitem', { name: 'Cancel event', exact: true }).click()
    await expect(cancel.getByRole('textbox', { name: 'Reason', exact: true })).toHaveValue('')
    await cancel
      .getByRole('textbox', { name: 'Reason', exact: true })
      .fill('Synthetic room unavailable')
    await cancel.getByRole('button', { name: 'Yes, cancel', exact: true }).click()
    await expect(cancel).toBeHidden()
    saved = await (await f.member.request.get(`/api/v1/events/${f.event.id}`)).json()
    expect(saved).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Synthetic room unavailable',
    })
    await f.memberPage.reload()
    await expect(
      member.getByRole('paragraph').filter({ hasText: /^Reason: Synthetic room unavailable$/ }),
    ).toBeVisible()
    await expect(member.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0)
  } finally {
    await f.close()
  }
})

test('an organizer edit keeps its title and current wizard step across a real reconnect reread', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const detail = await f.open(f.headPage, 'RSVP')
    await detail.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = f.headPage.getByRole('dialog', { name: 'Edit', exact: true })
    await edit
      .getByRole('textbox', { name: 'Event title', exact: true })
      .fill('Synthetic unsaved organizer draft')
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await edit.getByRole('textbox', { name: 'Place', exact: true }).fill('Synthetic unsaved room')
    await f.head.setOffline(true)
    expect(
      (
        await authedPatch(f.member, `/api/v1/events/${f.event.id}`, {
          place: 'Forbidden member update',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await authedPatch(f.head, `/api/v1/events/${f.event.id}`, {
          place: 'Synthetic remote room',
        })
      ).status(),
    ).toBe(200)
    const read = f.headPage.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === `/api/v1/events/${f.event.id}`,
    )
    await f.head.setOffline(false)
    expect((await read).status()).toBe(200)
    await expect(edit.getByRole('textbox', { name: 'Place', exact: true })).toHaveValue(
      'Synthetic unsaved room',
    )
    await edit.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(edit.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
      'Synthetic unsaved organizer draft',
    )
    await f.headPage.keyboard.press('Escape')
    expect((await (await f.head.request.get(`/api/v1/events/${f.event.id}`)).json()).title).toBe(
      'Synthetic Nested Event',
    )
  } finally {
    await f.head.setOffline(false)
    await f.close()
  }
})

test('a held real photo save retains the next URL and caption draft', async ({ browser }) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const pixels = await readFile(new URL('./fixtures/account-avatar.png', import.meta.url))
    await f.memberPage.route('**/qa-*-photo.png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: pixels }),
    )
    const detail = await f.open(f.memberPage, 'Photos')
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.memberPage.route(`**/api/v1/events/${f.event.id}/photos`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      received()
      await gate
      await route.fulfill({ response })
    })
    const url = detail.getByRole('textbox', { name: 'Image link', exact: true })
    const caption = detail.getByRole('textbox', { name: 'Caption (optional)', exact: true })
    await url.fill(`${FLOW_WEB_BASE_URL}/qa-first-photo.png`)
    await caption.fill('Synthetic saved first photo')
    await detail.getByRole('button', { name: 'Add a link', exact: true }).click()
    await committed
    await url.fill(`${FLOW_WEB_BASE_URL}/qa-next-photo.png`)
    await caption.fill('Synthetic next unsaved caption')
    release()
    await expect(detail.getByText('Synthetic saved first photo', { exact: true })).toBeVisible()
    await expect(url).toHaveValue(`${FLOW_WEB_BASE_URL}/qa-next-photo.png`)
    await expect(caption).toHaveValue('Synthetic next unsaved caption')
    const saved = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/photos`)).json())
      .items
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      url: `${FLOW_WEB_BASE_URL}/qa-first-photo.png`,
      caption: 'Synthetic saved first photo',
    })
  } finally {
    release()
    await f.close()
  }
})

test('a late actual carpool offer receipt cannot close or clear a reopened offer draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const detail = await f.open(f.headPage, 'Carpool')
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.headPage.route(`**/api/v1/events/${f.event.id}/carpools`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      received()
      await gate
      await route.fulfill({ response })
    })
    await detail.getByRole('button', { name: 'Offer a ride', exact: true }).click()
    const form = detail.locator('form')
    await form
      .getByRole('textbox', { name: 'Departure point', exact: true })
      .fill('Synthetic saved departure')
    await form.getByRole('button', { name: 'Offer a ride', exact: true }).click()
    await committed
    // The first control is the panel's toggle, followed by the form's submit control.
    await detail.getByRole('button', { name: 'Offer a ride', exact: true }).first().click()
    await expect(form).toBeHidden()
    await detail.getByRole('button', { name: 'Offer a ride', exact: true }).click()
    await form
      .getByRole('textbox', { name: 'Departure point', exact: true })
      .fill('Synthetic next departure draft')
    release()
    await expect(detail.getByText('Synthetic saved departure', { exact: true })).toBeVisible()
    await expect(form).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'Departure point', exact: true })).toHaveValue(
      'Synthetic next departure draft',
    )
    expect(
      (await (await f.head.request.get(`/api/v1/events/${f.event.id}/carpools`)).json()).items,
    ).toHaveLength(1)
  } finally {
    release()
    await f.close()
  }
})

test('a late actual poll create receipt cannot close a different reopened poll form', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    const detail = await f.open(f.headPage, 'Polls')
    let received = () => {}
    const committed = new Promise<void>((resolve) => {
      received = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.headPage.route(`**/api/v1/events/${f.event.id}/polls`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      received()
      await gate
      await route.fulfill({ response })
    })
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    const form = detail.locator('form')
    await form.getByRole('textbox', { name: 'Question', exact: true }).fill('Synthetic saved poll')
    await form.getByPlaceholder('Option text', { exact: true }).nth(0).fill('Synthetic first A')
    await form.getByPlaceholder('Option text', { exact: true }).nth(1).fill('Synthetic first B')
    await form.getByRole('button', { name: 'Create a poll', exact: true }).click()
    await committed
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).first().click()
    await expect(form).toBeHidden()
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    await form
      .getByRole('textbox', { name: 'Question', exact: true })
      .fill('Synthetic next unsaved poll')
    release()
    await expect(detail.getByText('Synthetic saved poll', { exact: true })).toBeVisible()
    await expect(form).toBeVisible()
    await expect(form.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(
      'Synthetic next unsaved poll',
    )
    expect(
      (await (await f.head.request.get(`/api/v1/events/${f.event.id}/polls`)).json()).items,
    ).toHaveLength(1)
  } finally {
    release()
    await f.close()
  }
})

test('discussion read completion cannot move Post out from under a native pointer press', async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser)
  let release = () => {}
  try {
    let readCommitted = false
    let posted = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await f.memberPage.route(`**/api/v1/events/${f.event.id}/comments`, async (route) => {
      if (route.request().method() === 'POST') {
        posted += 1
        return route.continue()
      }
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      readCommitted = true
      await gate
      await route.fulfill({ response })
    })
    const detail = await f.open(f.memberPage, 'Discussion')
    await expect.poll(() => readCommitted).toBe(true)
    await detail
      .getByPlaceholder('Write a comment', { exact: true })
      .fill('Synthetic native loading press')
    const post = detail.getByRole('button', { name: 'Post', exact: true })
    const before = await post.boundingBox()
    expect(before).not.toBeNull()
    const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 }
    await f.memberPage.mouse.move(point.x, point.y)
    await f.memberPage.mouse.down()
    release()
    await expect(detail.getByText('No comments yet. Be the first.', { exact: true })).toBeVisible()
    const after = await post.boundingBox()
    const releasedOver = await f.memberPage.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return {
        tag: element?.tagName,
        button: element?.closest('button')?.textContent,
        text: element?.textContent?.slice(0, 100),
      }
    }, point)
    await f.memberPage.mouse.up()
    await testInfo.attach('discussion-native-read-layout.json', {
      contentType: 'application/json',
      body: JSON.stringify({ before, after, releasedOver }),
    })
    await expect.poll(() => posted, { timeout: 5_000 }).toBe(1)
    await expect(
      detail.getByRole('paragraph').filter({ hasText: /^Synthetic native loading press$/ }),
    ).toBeVisible()
    expect(
      (await (await f.member.request.get(`/api/v1/events/${f.event.id}/comments`)).json()).items,
    ).toHaveLength(1)
  } finally {
    release()
    await f.close()
  }
})
