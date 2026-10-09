/* eslint-disable no-restricted-syntax -- Agenda range changes and fixtures must be observed sequentially. */
import { expect, test, type Browser } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { settleCapture } from './platform-capture.js'

async function fixture(browser: Browser, department = false) {
  const context = await newFlowContext(browser)
  if (department) {
    const admin = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      const info = await createApprovedDepartment(context, admin, {
        headLogin: uniqueLogin('agenda.head'),
        headPassword: examplePassword(),
        departmentName: 'Synthetic agenda regression',
      })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      return { context, info }
    } finally {
      await admin.close()
    }
  }
  await registerUser(context, {
    login: uniqueLogin('agenda.empty'),
    password: examplePassword(),
    givenName: 'Calendar',
    familyName: 'Synthetic',
  })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  return { context, info: undefined }
}

test('@qa calendar ranges retain owner task scope, event status and working deep links', async ({
  browser,
}) => {
  const f = await fixture(browser, true)
  const member = await newFlowContext(browser)
  try {
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('agenda.member'),
      password: examplePassword(),
      joinKey: f.info!.joinKey,
      joinPassword: f.info!.joinPassword,
    })
    const headId = (await (await f.context.request.get('/api/v1/me')).json()).user.id
    const memberId = (await (await member.request.get('/api/v1/me')).json()).user.id
    const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
    const own = await authedPost(f.context, '/api/v1/cards', {
      title: 'Synthetic head due task',
      assigneeUserId: headId,
      dueAt: future(2),
    })
    expect(own.status()).toBe(201)
    const cardId = (await own.json()).id as string
    expect(
      (
        await authedPost(f.context, '/api/v1/cards', {
          title: 'Synthetic other owner task',
          assigneeUserId: memberId,
          dueAt: future(2),
        })
      ).status(),
    ).toBe(201)
    const ids: string[] = []
    for (const days of [3, 15, 60]) {
      const event = await authedPost(f.context, '/api/v1/events', {
        title: `Synthetic event ${days} days`,
        startsAt: future(days),
        endsAt: new Date(Date.parse(future(days)) + 3_600_000).toISOString(),
      })
      expect(event.status()).toBe(201)
      ids.push((await event.json()).id)
    }
    const page = await f.context.newPage()
    await page.goto('/calendar')
    const period = page.getByRole('radiogroup', { name: 'Period', exact: true })
    for (const [days, count] of [
      [7, 1],
      [30, 2],
      [90, 3],
    ] as const) {
      await period.getByRole('radio', { name: `${days} days`, exact: true }).click()
      await expect(period.getByRole('radio', { name: `${days} days`, exact: true })).toBeChecked()
      await expect(page.getByRole('button', { name: /Synthetic head due task/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /Synthetic other owner task/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Synthetic event .* days/ })).toHaveCount(count)
      const stored = await (
        await f.context.request.get(`/api/v1/calendar/agenda?days=${days}`)
      ).json()
      expect(stored.items.filter((item: { kind: string }) => item.kind === 'event')).toHaveLength(
        count,
      )
      expect(
        stored.items
          .filter((item: { kind: string }) => item.kind === 'card')
          .map((item: { id: string }) => item.id),
      ).toEqual([cardId])
    }
    await page.getByRole('button', { name: /Synthetic head due task/ }).click()
    await expect(page).toHaveURL(
      (url) => url.pathname === '/work' && url.searchParams.get('card') === cardId,
    )
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
    ).toHaveValue('Synthetic head due task')
    await page.goto('/calendar')
    await page.getByRole('button', { name: /Synthetic event 3 days/ }).click()
    await expect(page).toHaveURL(
      (url) => url.pathname === '/events' && url.searchParams.get('event') === ids[0],
    )
    await expect(
      page.getByRole('dialog', { name: 'Synthetic event 3 days', exact: true }),
    ).toBeVisible()
    expect(
      (
        await authedPost(f.context, `/api/v1/events/${ids[0]}/cancel`, {
          reason: 'Synthetic cancelled calendar fixture',
        })
      ).status(),
    ).toBe(200)
    await page.goto('/calendar')
    const cancelled = page.getByRole('button', { name: /Synthetic event 3 days/ })
    await expect(cancelled).toBeVisible()
    const stored = await (await f.context.request.get('/api/v1/calendar/agenda?days=30')).json()
    expect(stored.items.find((item: { id: string }) => item.id === ids[0]).status).toBe('cancelled')
    await settleCapture(page, false)
    await page.screenshot({ path: test.info().outputPath('cancelled-agenda.png'), fullPage: true })
    await expect(cancelled.getByText('Cancelled', { exact: true })).toBeVisible()
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const memberPage = await member.newPage()
    await memberPage.goto('/calendar')
    await memberPage
      .getByRole('radiogroup', { name: 'Period', exact: true })
      .getByRole('radio', { name: '90 days', exact: true })
      .click()
    await expect(
      memberPage.getByRole('button', { name: /Synthetic other owner task/ }),
    ).toBeVisible()
    await expect(memberPage.getByRole('button', { name: /Synthetic head due task/ })).toHaveCount(0)
    await expect(memberPage.getByRole('button', { name: /Synthetic event .* days/ })).toHaveCount(3)
    const memberStored = await (await member.request.get('/api/v1/calendar/agenda?days=90')).json()
    expect(
      memberStored.items
        .filter((item: { kind: string }) => item.kind === 'event')
        .map((item: { id: string }) => item.id),
    ).toEqual(ids)
  } finally {
    await member.close()
    await f.context.close()
  }
})

test('@qa calendar empty guidance and refused agenda/feed reads recover through actual Retry', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.context.newPage()
    await page.goto('/calendar')
    await expect(
      page.getByRole('heading', { name: 'Nothing in the days ahead', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Go to events', exact: true }).click()
    await expect(page).toHaveURL(/\/events$/)
    for (const [path, routePath, heading, recovered] of [
      [
        '**/api/v1/calendar/agenda?*',
        '/calendar',
        "Couldn't open your agenda",
        'Nothing in the days ahead',
      ],
      [
        '**/api/v1/calendar/feeds',
        '/calendar?tab=feeds',
        "Couldn't open your subscriptions",
        'No subscriptions yet',
      ],
    ]) {
      await page.route(path!, async (route) => {
        if (route.request().method() === 'GET')
          await route.fulfill({ status: 503, json: { code: 'maintenance' } })
        else await route.continue()
      })
      await page.goto(routePath!)
      await expect(page.getByRole('heading', { name: heading!, exact: true })).toBeVisible()
      await page.unroute(path!)
      const read = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname ===
            (routePath!.includes('feeds') ? '/api/v1/calendar/feeds' : '/api/v1/calendar/agenda'),
      )
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      expect((await read).status()).toBe(200)
      await expect(page.getByRole('heading', { name: recovered!, exact: true })).toBeVisible()
    }
  } finally {
    await f.context.close()
  }
})

test('@qa subscription cap explains the remedy while keeping the refused draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    for (let index = 0; index < 20; index++)
      expect(
        (
          await authedPost(f.context, '/api/v1/calendar/feeds', {
            kind: 'all',
            label: `Synthetic existing subscription ${index}`,
          })
        ).status(),
      ).toBe(200)
    const page = await f.context.newPage()
    await page.goto('/calendar?tab=feeds')
    await page.getByRole('button', { name: 'Create subscription', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New subscription', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic retryable subscription')
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/calendar/feeds',
    )
    await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
    const capResponse = await refused
    expect(capResponse.status()).toBe(422)
    expect(capResponse.headers()['content-type']).toContain('application/problem+json')
    expect(await capResponse.json()).toMatchObject({
      status: 422,
      code: 'validation_failed',
      errors: [{ path: 'feeds', code: 'too_many_feeds' }],
    })
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic retryable subscription',
    )
    expect(
      (await (await f.context.request.get('/api/v1/calendar/feeds')).json()).items,
    ).toHaveLength(20)
    await expect(dialog.getByRole('alert')).toHaveText(
      'You have 20 active subscriptions. Close this dialog and delete an unused subscription before creating another.',
    )
    await settleCapture(page, false)
    await dialog.screenshot({ path: test.info().outputPath('subscription-cap.png') })
  } finally {
    await f.context.close()
  }
})

test('@qa a held subscription receipt cannot discard a later dialog draft', async ({ browser }) => {
  const f = await fixture(browser)
  let release: (() => void) | undefined
  try {
    const page = await f.context.newPage()
    let persisted: (() => void) | undefined
    const committed = new Promise<void>((resolve) => {
      persisted = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/calendar/feeds', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      persisted!()
      await held
      await route.fulfill({ response })
    })
    await page.goto('/calendar?tab=feeds')
    await page.getByRole('button', { name: 'Create subscription', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'New subscription', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic accepted first')
    await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
    await committed
    expect(
      (await (await f.context.request.get('/api/v1/calendar/feeds')).json()).items,
    ).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Create subscription', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'New subscription', exact: true })
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic later draft')
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/calendar/feeds',
    )
    const refreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/calendar/feeds',
    )
    release!()
    expect((await receipt).status()).toBe(200)
    expect((await refreshed).status()).toBe(200)
    await expect(
      dialog.getByRole('button', { name: 'Create subscription', exact: true }),
    ).toBeEnabled()
    await expect(dialog).toHaveAttribute('data-state', 'open')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic later draft',
    )
    await dialog.screenshot({ path: test.info().outputPath('held-create-draft.png') })
  } finally {
    release?.()
    await f.context.close()
  }
})

test('@qa denied clipboard copy explains and selects the usable link fallback', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const created = await authedPost(f.context, '/api/v1/calendar/feeds', {
      kind: 'tasks',
      label: 'Synthetic clipboard subscription',
    })
    expect(created.status()).toBe(200)
    const saved = await created.json()
    await f.context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new DOMException('Synthetic policy refusal', 'NotAllowedError')
          },
        },
      })
    })
    const page = await f.context.newPage()
    await page.goto('/calendar?tab=feeds')
    const link = page.getByRole('textbox', { name: 'Link (https)', exact: true })
    await expect(link).toHaveValue(saved.url)
    await page.getByRole('button', { name: 'Copy', exact: true }).first().click()
    await expect(
      page.getByText(
        'Could not copy automatically. The link is selected; copy it with your keyboard or touch menu.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(link).toBeFocused()
    expect(
      await link.evaluate((element: HTMLInputElement) => ({
        start: element.selectionStart,
        end: element.selectionEnd,
      })),
    ).toEqual({ start: 0, end: saved.url.length })
    await expect(page.getByText('Link copied', { exact: true })).toHaveCount(0)
    await settleCapture(page, false)
    await page
      .getByText(
        'Could not copy automatically. The link is selected; copy it with your keyboard or touch menu.',
        { exact: true },
      )
      .screenshot({ path: test.info().outputPath('clipboard-fallback-feedback.png') })
    await page.screenshot({
      path: test.info().outputPath('clipboard-fallback.png'),
      mask: [page.getByRole('textbox')],
    })
  } finally {
    await f.context.close()
  }
})

for (const outcome of ['success', 'denied'] as const) {
  test(`@qa a late ${outcome} clipboard receipt cannot describe a renewed credential`, async ({
    browser,
  }) => {
    const f = await fixture(browser)
    try {
      const response = await authedPost(f.context, '/api/v1/calendar/feeds', {
        kind: 'tasks',
        label: 'Synthetic clipboard rotation',
      })
      expect(response.status()).toBe(200)
      const original = await response.json()
      // Controlled browser clipboard boundary only. Renewal, persistence and old URL refusal
      // use the real local API. This does not claim an operating-system clipboard write.
      await f.context.addInitScript((result) => {
        const probe = { pending: false, release: () => {} }
        Object.defineProperty(window, '__qaClipboard', { value: probe })
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () =>
              new Promise<void>((resolve, reject) => {
                probe.pending = true
                probe.release = () => {
                  probe.pending = false
                  if (result === 'success') resolve()
                  else reject(new DOMException('Synthetic policy refusal', 'NotAllowedError'))
                }
              }),
          },
        })
      }, outcome)
      const page = await f.context.newPage()
      await page.goto('/calendar?tab=feeds')
      const link = page.getByRole('textbox', { name: 'Link (https)', exact: true })
      await expect(link).toHaveValue(original.url)
      await page.getByRole('button', { name: 'Copy', exact: true }).first().click()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __qaClipboard: { pending: boolean } }).__qaClipboard.pending,
          ),
        )
        .toBe(true)
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Renew the link', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Renew this link?', exact: true })
        .getByRole('button', { name: 'Yes, renew it', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const renewed = (await (await f.context.request.get('/api/v1/calendar/feeds')).json())
        .items[0]
      expect(renewed.id).toBe(original.id)
      expect(renewed.url).not.toBe(original.url)
      await expect(link).toHaveValue(renewed.url)
      expect((await f.context.request.get(original.url)).status()).toBe(404)
      expect((await f.context.request.get(renewed.url)).status()).toBe(200)
      await page.evaluate(async () => {
        ;(window as unknown as { __qaClipboard: { release: () => void } }).__qaClipboard.release()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      })
      // Assert the immediate receipt. Waiting for dismiss animations here would let stale
      // success/error feedback disappear and could turn this regression into a false pass.
      await page.screenshot({
        path: test.info().outputPath(`late-clipboard-${outcome}.png`),
        mask: [page.getByRole('textbox')],
      })
      expect(await page.getByText('Link copied', { exact: true }).count()).toBe(0)
      expect(
        await page
          .getByText(
            'Could not copy automatically. The link is selected; copy it with your keyboard or touch menu.',
            { exact: true },
          )
          .count(),
      ).toBe(0)
      expect(await page.getByRole('button', { name: 'Copied', exact: true }).count()).toBe(0)
      await expect(link).not.toBeFocused()
    } finally {
      await f.context.close()
    }
  })
}
