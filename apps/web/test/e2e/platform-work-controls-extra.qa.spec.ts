import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing en:${key}`)
  return value
}
async function create(context: BrowserContext, title: string, extra: Record<string, unknown> = {}) {
  const response = await authedPost(context, '/api/v1/cards', { title, kind: 'task', ...extra })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}
async function open(page: Page, id: string, title: string) {
  await page.goto(`/work?card=${id}`)
  await waitForLoadedRoute(page, '/work')
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue(title)
}
async function section(page: Page, id: string) {
  const toggle = page.locator(`button[aria-controls="${id}"]`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator(`[id="${id}"]`)
  await expect(panel).toBeVisible()
  return panel
}
test('@qa dependency and reminder read refusal have explicit retry', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `QA panel read retry ${randomUUID().slice(0, 8)}`
    const id = await create(context, title)
    const page = await context.newPage()
    let refuse = true
    await page.route(`**/api/v1/cards/${id}/{dependencies,reminders}`, async (route) => {
      if (refuse)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      else await route.continue()
    })
    await open(page, id, title)
    const dependencies = await section(page, `card-deps-${id}`)
    const reminders = await section(page, `card-reminders-${id}`)
    for (const panel of [dependencies, reminders])
      await expect(
        panel.getByRole('button', { name: label('state.error.action'), exact: true }),
      ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('panel-read-refusal.png') })
    refuse = false
    for (const panel of [dependencies, reminders])
      await panel.getByRole('button', { name: label('state.error.action'), exact: true }).click()
    await expect(
      dependencies.getByText(label('work.dependencies.blockedByEmpty'), { exact: true }),
    ).toBeVisible()
    await expect(reminders.getByText(label('work.reminders.empty'), { exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})
for (const failedRead of ['graph', 'candidates']) {
  test(`@qa dependency ${failedRead} refusal blocks unsafe picker until explicit retry`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    try {
      await login(context, { login: 'demo.boshliq', password: examplePassword })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const suffix = randomUUID().slice(0, 8)
      const title = `QA graph refusal ${suffix}`
      const id = await create(context, title)
      const blocker = await create(context, `QA graph candidate ${suffix}`)
      expect(
        (
          await authedPost(context, `/api/v1/cards/${blocker}/dependencies`, {
            blockedByCardId: id,
          })
        ).status(),
      ).toBe(201)
      const page = await context.newPage()
      let refuse = true
      await page.route(
        (url) =>
          failedRead === 'graph'
            ? url.pathname === '/api/v1/work/dependencies'
            : url.pathname === '/api/v1/cards' && url.searchParams.get('limit') === '100',
        async (route) => {
          if (refuse)
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
            })
          else await route.continue()
        },
      )
      await open(page, id, title)
      const panel = await section(page, `card-deps-${id}`)
      await panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
      await expect(
        panel.getByRole('button', { name: label('state.error.action'), exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: test.info().outputPath('dependency-graph-refusal.png') })
      await expect(panel.getByRole('combobox')).toHaveCount(0)
      refuse = false
      await panel.getByRole('button', { name: label('state.error.action'), exact: true }).click()
      await panel.getByRole('combobox').click()
      await page
        .getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true })
        .fill(`QA graph candidate ${suffix}`)
      await expect(
        page.getByRole('option', {
          name: `QA graph candidate ${suffix} ${label('work.dependencies.wouldLoop')}`,
          exact: true,
        }),
      ).toHaveAttribute('aria-disabled', 'true')
    } finally {
      await context.close()
    }
  })
}
test('@qa recurrence enable weekly validation monthly daily boundaries and held commit', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `QA recurrence choices ${randomUUID().slice(0, 8)}`
    const id = await create(context, title, { dueAt: '2026-10-30T12:00:00Z' })
    const page = await context.newPage()
    await open(page, id, title)
    const panel = await section(page, `card-repeat-${id}`)
    await panel.getByRole('button', { name: label('work.recurrence.enable'), exact: true }).click()
    const freq = panel.getByLabel(label('work.recurrence.freqLabel'), { exact: true })
    await expect(freq).toHaveValue('weekly')
    await panel
      .getByRole('button', { name: label('work.recurrence.weekday.mon'), exact: true })
      .click()
    await expect(
      panel.getByText(label('work.recurrence.weekdaysEmptyHint'), { exact: true }),
    ).toBeVisible()
    const weeklySaved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/cards/${id}`) && r.request().method() === 'PATCH' && r.status() === 200,
    )
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await weeklySaved
    expect(
      (await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence,
    ).toMatchObject({ freq: 'weekly', weekdays: [] })
    for (const day of ['tue', 'sun'])
      await panel
        .getByRole('button', { name: label(`work.recurrence.weekday.${day}`), exact: true })
        .click()
    const chosenWeekdays = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/cards/${id}`) && r.request().method() === 'PATCH' && r.status() === 200,
    )
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await chosenWeekdays
    expect(
      (await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence,
    ).toMatchObject({ freq: 'weekly', weekdays: [2, 7], interval: 1, mode: 'schedule' })
    await freq.selectOption('monthly')
    await panel.getByLabel(label('work.recurrence.dayOfMonthLabel'), { exact: true }).fill('31')
    await panel.getByLabel(label('work.recurrence.untilLabel'), { exact: true }).fill('2027-06-01')
    const monthlySaved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/cards/${id}`) && r.request().method() === 'PATCH' && r.status() === 200,
    )
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await monthlySaved
    expect(
      (await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence,
    ).toMatchObject({ freq: 'monthly', dayOfMonth: 31, until: '2027-06-01' })
    await panel.getByLabel(label('work.recurrence.dayOfMonthLabel'), { exact: true }).fill('')
    await panel.getByLabel(label('work.recurrence.untilLabel'), { exact: true }).fill('')
    await freq.selectOption('daily')
    await panel.getByRole('radio').nth(1).click()
    await panel.getByLabel(label('work.recurrence.countLabel'), { exact: true }).fill('2')
    let release: (() => void) | undefined
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    let arrived: (() => void) | undefined
    const arrival = new Promise<void>((resolveArrival) => {
      arrived = resolveArrival
    })
    await page.route(`**/api/v1/cards/${id}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      arrived?.()
      await held
      await route.continue()
    })
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await arrival
    await expect(freq).toBeDisabled()
    await expect(panel.getByRole('radio').nth(1)).toBeDisabled()
    await expect(
      panel.getByRole('button', { name: label('work.recurrence.stop'), exact: true }),
    ).toBeDisabled()
    release?.()
    await expect(freq).toBeEnabled()
    expect(
      (await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence,
    ).toMatchObject({ freq: 'daily', mode: 'after_done', count: 2 })
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    const reloaded = await section(page, `card-repeat-${id}`)
    await expect(
      reloaded.getByLabel(label('work.recurrence.freqLabel'), { exact: true }),
    ).toHaveValue('daily')
    await reloaded.getByRole('button', { name: label('work.recurrence.stop'), exact: true }).click()
    await expect(
      reloaded.getByRole('button', { name: label('work.recurrence.enable'), exact: true }),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})
