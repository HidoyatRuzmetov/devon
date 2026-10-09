import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { eventFixture } from './event-nested-fixtures.js'
import { authedPost } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

test('date poll options are named and a real anonymous date ballot persists', async ({
  browser,
}, testInfo) => {
  const f = await eventFixture(browser)
  try {
    const detail = await f.open(f.memberPage, 'Polls')
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    const form = detail.locator('form')
    await form.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('date')
    await f.memberPage.screenshot({ path: testInfo.outputPath('date-poll-form.png') })
    const axe = await new AxeBuilder({ page: f.memberPage }).include('[role="dialog"]').analyze()
    expect(
      axe.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
    ).toEqual([])
    await form.getByRole('textbox', { name: 'Question', exact: true }).fill('Synthetic date choice')
    await form.locator('#poll-option-0').fill('2030-01-01T10:00')
    await form.locator('#poll-option-1').fill('2030-01-02T10:00')
    await form.getByRole('checkbox').check()
    await form.getByRole('button', { name: 'Create a poll', exact: true }).click()
    await expect(form).toHaveCount(0)
    const saved = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/polls`)).json())
      .items
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      kind: 'date',
      question: 'Synthetic date choice',
      anonymous: true,
    })
    expect(saved[0].options).toHaveLength(2)
    expect(
      saved[0].options.every((option: { optionDate: string }) =>
        Number.isFinite(Date.parse(option.optionDate)),
      ),
    ).toBe(true)
    await detail.getByRole('radio').first().check()
    await detail.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Change vote', exact: true })).toBeVisible()
    const voted = (await (await f.member.request.get(`/api/v1/events/${f.event.id}/polls`)).json())
      .items[0]
    expect(
      voted.options
        .filter((option: { votedByMe: boolean }) => option.votedByMe)
        .map((option: { id: string }) => option.id),
    ).toEqual([saved[0].options[0].id])
  } finally {
    await f.close()
  }
})

test('poll construction enforces the real ten-option maximum and removal restores capacity', async ({
  browser,
}) => {
  const f = await eventFixture(browser)
  try {
    const detail = await f.open(f.headPage, 'Polls')
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    const form = detail.locator('form')
    await form.getByRole('textbox', { name: 'Question', exact: true }).fill('Synthetic ten choices')
    const add = form.getByRole('button', { name: 'Add option', exact: true })
    for (let index = 2; index < 10; index += 1) await add.click()
    await expect(form.locator('[id^="poll-option-"]')).toHaveCount(10)
    await expect(add).toBeDisabled()
    await form.getByRole('button', { name: 'Remove option 1', exact: true }).click()
    await expect(add).toBeEnabled()
    await add.click()
    for (let index = 0; index < 10; index += 1)
      await form.locator(`#poll-option-${index}`).fill(`Synthetic choice ${index + 1}`)
    await form.getByRole('button', { name: 'Create a poll', exact: true }).click()
    await expect(form).toHaveCount(0)
    expect(
      (await (await f.head.request.get(`/api/v1/events/${f.event.id}/polls`)).json()).items[0]
        .options,
    ).toHaveLength(10)
  } finally {
    await f.close()
  }
})

test('switching a text poll to dates cannot submit invisible stale text and preserves both drafts', async ({
  browser,
}) => {
  const f = await eventFixture(browser)
  try {
    const detail = await f.open(f.headPage, 'Polls')
    await detail.getByRole('button', { name: 'Create a poll', exact: true }).click()
    const form = detail.locator('form')
    await form.getByRole('textbox', { name: 'Question', exact: true }).fill('Synthetic kind choice')
    await form.locator('#poll-option-0').fill('Synthetic text A')
    await form.locator('#poll-option-1').fill('Synthetic text B')
    await form.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('date')
    await expect(form.locator('#poll-option-0')).toHaveValue('')
    await expect(form.getByRole('button', { name: 'Create a poll', exact: true })).toBeDisabled()
    await form.locator('#poll-option-0').fill('2030-01-01T10:00')
    await form.locator('#poll-option-1').fill('2030-01-02T10:00')
    await form.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('multi')
    await expect(form.locator('#poll-option-0')).toHaveValue('Synthetic text A')
    await expect(form.locator('#poll-option-1')).toHaveValue('Synthetic text B')
    await form.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('date')
    await expect(form.locator('#poll-option-0')).toHaveValue('2030-01-01T10:00')
    await expect(form.locator('#poll-option-1')).toHaveValue('2030-01-02T10:00')
    expect(
      (await (await f.head.request.get(`/api/v1/events/${f.event.id}/polls`)).json()).items,
    ).toHaveLength(0)
  } finally {
    await f.close()
  }
})

test('Mine ICS refusal gives visible feedback and a subsequent real download contains the RSVP event', async ({
  browser,
}) => {
  const f = await eventFixture(browser)
  try {
    expect(
      (
        await authedPost(f.member, `/api/v1/events/${f.event.id}/rsvp`, {
          status: 'yes',
          guests: 0,
        })
      ).status(),
    ).toBe(200)
    let refuse = true
    const errors: string[] = []
    f.memberPage.on('pageerror', (error) => errors.push(error.message))
    await f.memberPage.route('**/api/v1/events/ics/me', (route) =>
      refuse
        ? route.fulfill({
            status: 503,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'Synthetic ICS refusal',
              status: 503,
              code: 'internal',
            }),
          })
        : route.continue(),
    )
    await f.memberPage.goto('/events')
    await f.memberPage.getByRole('button', { name: 'More actions', exact: true }).click()
    await f.memberPage.getByRole('menuitem', { name: 'My events (.ics)', exact: true }).click()
    await expect(
      f.memberPage.getByText('Could not download the calendar file. Try again.', { exact: true }),
    ).toBeVisible()
    expect(errors).toEqual([])
    refuse = false
    await f.memberPage.getByRole('button', { name: 'More actions', exact: true }).click()
    const pending = f.memberPage.waitForEvent('download')
    await f.memberPage.getByRole('menuitem', { name: 'My events (.ics)', exact: true }).click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/\.ics$/)
    const path = await download.path()
    expect(path).not.toBeNull()
    const ics = await readFile(path!, 'utf8')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('Synthetic Nested Event')
    expect(ics).toContain('END:VCALENDAR')
  } finally {
    await f.close()
  }
})

test('an ordinary member can publish edit and cancel their own event with independently persisted ownership', async ({
  browser,
}) => {
  const f = await eventFixture(browser)
  try {
    await f.memberPage.goto('/events?new=1')
    const wizard = f.memberPage.getByRole('dialog', { name: 'Create event', exact: true })
    await wizard
      .getByRole('textbox', { name: 'Event title', exact: true })
      .fill('Synthetic Member Event')
    await wizard.getByRole('button', { name: 'Next', exact: true }).click()
    await wizard.getByLabel('Starts at', { exact: true }).fill('2030-01-01T10:00')
    await wizard.getByLabel('Ends at', { exact: true }).fill('2030-01-01T11:00')
    await wizard.getByRole('button', { name: 'Next', exact: true }).click()
    expect((await (await f.member.request.get('/api/v1/events')).json()).items).toHaveLength(1)
    await wizard.getByRole('button', { name: 'Create event', exact: true }).click()
    const detail = f.memberPage.getByRole('dialog', { name: 'Synthetic Member Event', exact: true })
    await expect(detail).toBeVisible()
    const id = new URL(f.memberPage.url()).searchParams.get('event')
    expect(id).not.toBeNull()
    const saved = await (await f.member.request.get(`/api/v1/events/${id}`)).json()
    const me = await (await f.member.request.get('/api/v1/me')).json()
    expect(saved.organizer.id).toBe(me.user.id)
    expect(saved.canManage).toBe(true)
    await detail.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = f.memberPage.getByRole('dialog', { name: 'Edit', exact: true })
    await edit
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Synthetic member edited description')
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await edit.getByRole('button', { name: 'Next', exact: true }).click()
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(edit).toBeHidden()
    expect((await (await f.head.request.get(`/api/v1/events/${id}`)).json()).description).toBe(
      'Synthetic member edited description',
    )
    await detail.getByRole('button', { name: 'More actions', exact: true }).click()
    await f.memberPage.getByRole('menuitem', { name: 'Cancel event', exact: true }).click()
    const cancel = f.memberPage.getByRole('dialog', { name: 'Cancel event', exact: true })
    await cancel
      .getByRole('textbox', { name: 'Reason', exact: true })
      .fill('Synthetic member changed plan')
    await cancel.getByRole('button', { name: 'Yes, cancel', exact: true }).click()
    await expect(cancel).toBeHidden()
    expect(await (await f.head.request.get(`/api/v1/events/${id}`)).json()).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Synthetic member changed plan',
    })
    await f.memberPage.reload()
    await expect(detail.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(
      detail.getByRole('paragraph').filter({ hasText: /^Reason: Synthetic member changed plan$/ }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('a saved photo caption stays fully readable in the narrow gallery', async ({
  browser,
}, testInfo) => {
  const f = await eventFixture(browser)
  try {
    const pixels = await readFile(new URL('./fixtures/account-avatar.png', import.meta.url))
    await f.memberPage.route('**/qa-readable-caption.png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: pixels }),
    )
    const caption =
      'Synthetic saved caption describing who attended the meeting and what they presented, with the details colleagues need to read after opening the photo gallery.'
    expect(
      (
        await authedPost(f.member, `/api/v1/events/${f.event.id}/photos`, {
          url: `${FLOW_WEB_BASE_URL}/qa-readable-caption.png`,
          caption,
        })
      ).status(),
    ).toBe(201)
    await f.memberPage.setViewportSize({ width: 320, height: 640 })
    const detail = await f.open(f.memberPage, 'Photos')
    const text = detail.locator('figcaption')
    await expect(text).toHaveText(caption)
    await text.scrollIntoViewIfNeeded()
    await f.memberPage.screenshot({ path: testInfo.outputPath('photo-caption-narrow.png') })
    const size = await text.evaluate((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth,
    }))
    expect(
      size.content,
      'The saved caption must be readable without a hidden horizontal ellipsis',
    ).toBeLessThanOrEqual(size.visible + 1)
  } finally {
    await f.close()
  }
})
