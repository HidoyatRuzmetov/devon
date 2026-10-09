import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'
import type { CardDependencies, CardReminder } from '../../src/features/work/api-plus.js'

const examplePassword = 'Ishonchli#2026'
function label(key: string, params: Record<string, string | number> = {}): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing en:${key}`)
  return value.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match))
}
async function capture(page: Page, state: string) {
  await settleCapture(page, false)
  const screenshot = test.info().outputPath(`${state}.png`)
  await page.screenshot({ path: screenshot })
  appendFileSync(
    test.info().outputPath('captures.jsonl'),
    JSON.stringify({ state, screenshot, pixelInspected: false }) + '\n',
  )
}
async function card(context: BrowserContext, title: string): Promise<string> {
  const response = await authedPost(context, '/api/v1/cards', { title, kind: 'task' })
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
async function section(page: Page, id: string): Promise<Locator> {
  const toggle = page.locator(`button[aria-controls="${id}"]`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator(`[id="${id}"]`)
  await expect(panel).toBeVisible()
  return panel
}
async function readDependencies(context: BrowserContext, id: string): Promise<CardDependencies> {
  const r = await context.request.get(`/api/v1/cards/${id}/dependencies`)
  expect(r.status()).toBe(200)
  return r.json() as Promise<CardDependencies>
}
async function pickDependency(page: Page, panel: Locator, title: string) {
  await panel
    .getByRole('combobox', { name: label('work.dependencies.pickLabel'), exact: true })
    .click()
  await page.getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true }).fill(title)
  return page.getByRole('option', { name: title, exact: true })
}
async function selectCard(page: Page, id: string) {
  const tile = page.locator(`[data-dnd-card="${id}"]`)
  await tile.hover()
  await tile.getByRole('checkbox').check()
}

test('@qa dependency CRUD cancel refusal loop and blocked state', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const titleA = `QA blocked ${suffix}`
    const titleB = `QA blocker ${suffix}`
    const a = await card(context, titleA)
    const b = await card(context, titleB)
    const page = await context.newPage()
    await open(page, a, titleA)
    let panel = await section(page, `card-deps-${a}`)
    await expect(
      panel.getByText(label('work.dependencies.blockedByEmpty'), { exact: true }),
    ).toBeVisible()
    await panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
    await panel.getByRole('button', { name: label('common.cancel'), exact: true }).click()
    expect((await readDependencies(context, a)).blockedBy).toEqual([])
    let refuseAdd = true
    await page.route(`**/api/v1/cards/${a}/dependencies`, async (route) => {
      if (route.request().method() === 'POST' && refuseAdd) {
        refuseAdd = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
    await (await pickDependency(page, panel, titleB)).click()
    await expect(
      page.getByText(label('work.dependencies.addFailed'), { exact: true }),
    ).toBeVisible()
    expect((await readDependencies(context, a)).blockedBy).toEqual([])
    await (await pickDependency(page, panel, titleB)).click()
    await expect(panel.getByRole('button', { name: titleB, exact: true })).toBeVisible()
    const edge = (await readDependencies(context, a)).blockedBy[0]!
    expect(edge.card.id).toBe(b)
    await expect(
      panel.getByText(label('work.dependencies.stillOpen'), { exact: true }),
    ).toBeVisible()
    let read = await context.request.get(`/api/v1/cards/${a}`)
    expect((await read.json()).blockedByOpenCount).toBe(1)
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    panel = await section(page, `card-deps-${a}`)
    await expect(panel.getByRole('button', { name: titleB, exact: true })).toBeVisible()
    await capture(page, 'dependency-persisted-active-blocker')
    await panel.getByRole('button', { name: titleB, exact: true }).click()
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
    ).toHaveValue(titleB)
    const reverse = await section(page, `card-deps-${b}`)
    await expect(reverse.getByRole('button', { name: titleA, exact: true })).toBeVisible()
    await expect(
      reverse.getByRole('button', {
        name: label('work.dependencies.remove', { title: titleA }),
        exact: true,
      }),
    ).toHaveCount(0)
    await reverse.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
    await reverse
      .getByRole('combobox', { name: label('work.dependencies.pickLabel'), exact: true })
      .click()
    await page.getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true }).fill(titleA)
    const loop = page.getByRole('option').filter({ hasText: titleA })
    await expect(loop).toHaveAttribute('aria-disabled', 'true')
    await expect(loop).toContainText(label('work.dependencies.wouldLoop'))
    await page.keyboard.press('Escape')
    await reverse.getByRole('button', { name: label('common.cancel'), exact: true }).click()
    expect((await readDependencies(context, b)).blockedBy).toEqual([])
    expect((await authedPatch(context, `/api/v1/cards/${b}`, { status: 'done' })).status()).toBe(
      200,
    )
    await open(page, a, titleA)
    panel = await section(page, `card-deps-${a}`)
    await expect(
      panel.getByText(label('work.dependencies.doneAlready'), { exact: true }),
    ).toBeVisible()
    read = await context.request.get(`/api/v1/cards/${a}`)
    expect((await read.json()).blockedByOpenCount).toBe(0)
    let refuseRemove = true
    await page.route(`**/api/v1/cards/${a}/dependencies/${edge.id}`, async (route) => {
      if (refuseRemove) {
        refuseRemove = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    const remove = panel.getByRole('button', {
      name: label('work.dependencies.remove', { title: titleB }),
      exact: true,
    })
    await remove.click()
    await expect(
      page.getByText(label('work.dependencies.removeFailed'), { exact: true }),
    ).toBeVisible()
    expect((await readDependencies(context, a)).blockedBy).toHaveLength(1)
    await remove.click()
    await expect(panel.getByRole('button', { name: titleB, exact: true })).toHaveCount(0)
    expect((await readDependencies(context, a)).blockedBy).toEqual([])
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    await expect(
      (await section(page, `card-deps-${a}`)).getByText(label('work.dependencies.blockedByEmpty'), {
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('@qa reminders validation refusal delete reload and personal scope', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  const other = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    await login(other, { login: 'demo.xodim', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `QA reminder CRUD ${randomUUID().slice(0, 8)}`
    const id = await card(context, title)
    const page = await context.newPage()
    await open(page, id, title)
    let panel = await section(page, `card-reminders-${id}`)
    const when = panel.getByLabel(label('work.reminders.whenLabel'), { exact: true })
    const note = panel.getByLabel(label('work.reminders.noteLabel'), { exact: true })
    const add = panel.getByRole('button', { name: label('work.reminders.add'), exact: true })
    await when.fill('')
    await expect(add).toBeDisabled()
    await when.fill('2020-01-01T09:00')
    await expect(add).toBeDisabled()
    await expect(panel.getByText(label('work.reminders.inPast'), { exact: true })).toBeVisible()
    await when.fill('2027-02-12T11:30')
    await note.fill('Personal reminder instructions')
    let refuse = true
    await page.route(`**/api/v1/cards/${id}/reminders`, async (route) => {
      if (route.request().method() === 'POST' && refuse) {
        refuse = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await add.click()
    await expect(page.getByText(label('work.reminders.addFailed'), { exact: true })).toBeVisible()
    await expect(note).toHaveValue('Personal reminder instructions')
    const empty = await context.request.get(`/api/v1/cards/${id}/reminders`)
    expect(await empty.json()).toEqual([])
    await add.click()
    await expect(panel.getByText('Personal reminder instructions', { exact: true })).toBeVisible()
    await expect(note).toHaveValue('')
    const read = await context.request.get(`/api/v1/cards/${id}/reminders`)
    expect(read.status()).toBe(200)
    const rows = (await read.json()) as CardReminder[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sentAt).toBeNull()
    const expectedInstant = await page.evaluate(() => new Date('2027-02-12T11:30').toISOString())
    expect(rows[0]!.remindAt).toBe(expectedInstant)
    const otherRead = await other.request.get(`/api/v1/cards/${id}/reminders`)
    expect(otherRead.status()).toBe(200)
    expect(await otherRead.json()).toEqual([])
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    panel = await section(page, `card-reminders-${id}`)
    await expect(panel.getByText('Personal reminder instructions', { exact: true })).toBeVisible()
    await expect(panel.getByText(label('work.reminders.pending'), { exact: true })).toBeVisible()
    await capture(page, 'reminder-persisted-pending')
    let refuseDelete = true
    await page.route(`**/api/v1/cards/${id}/reminders/${rows[0]!.id}`, async (route) => {
      if (refuseDelete) {
        refuseDelete = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    const remove = panel.getByRole('button', { name: label('work.reminders.delete'), exact: true })
    await remove.click()
    await expect(
      page.getByText(label('work.reminders.deleteFailed'), { exact: true }),
    ).toBeVisible()
    expect(await (await context.request.get(`/api/v1/cards/${id}/reminders`)).json()).toHaveLength(
      1,
    )
    await remove.click()
    await expect(panel.getByText(label('work.reminders.empty'), { exact: true })).toBeVisible()
    expect(await (await context.request.get(`/api/v1/cards/${id}/reminders`)).json()).toEqual([])
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    await expect(
      (await section(page, `card-reminders-${id}`)).getByText(label('work.reminders.empty'), {
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    await Promise.all([context.close(), other.close()])
  }
})

test('@qa recurrence read-only controls stay disabled', async ({ browser }) => {
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await login(head, { login: 'demo.boshliq', password: examplePassword })
    await login(member, { login: 'demo.xodim', password: examplePassword })
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `QA readonly recurrence ${randomUUID().slice(0, 8)}`
    const id = await card(head, title)
    const rule = { freq: 'weekly', interval: 1, mode: 'schedule', weekdays: [1] }
    expect((await authedPatch(head, `/api/v1/cards/${id}`, { recurrence: rule })).status()).toBe(
      200,
    )
    const page = await member.newPage()
    await open(page, id, title)
    const panel = await section(page, `card-repeat-${id}`)
    await expect(
      panel.getByRole('button', { name: label('common.save'), exact: true }),
    ).toBeDisabled()
    await panel.getByRole('radio').nth(0).scrollIntoViewIfNeeded()
    await capture(page, 'recurrence-read-only-controls')
    await expect.soft(panel.getByRole('radio').nth(0)).toBeDisabled()
    await expect.soft(panel.getByRole('radio').nth(1)).toBeDisabled()
    expect((await (await member.request.get(`/api/v1/cards/${id}`)).json()).recurrence).toEqual(
      rule,
    )
  } finally {
    await Promise.all([head.close(), member.close()])
  }
})

test('@qa bulk response retains newer selection', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const ids = [
      await card(context, `QA bulk first ${suffix}`),
      await card(context, `QA bulk second ${suffix}`),
      await card(context, `QA bulk next ${suffix}`),
    ]
    const page = await context.newPage()
    await page.goto('/work')
    await waitForLoadedRoute(page, '/work')
    await selectCard(page, ids[0]!)
    await selectCard(page, ids[1]!)
    const toolbar = page.getByRole('toolbar', {
      name: label('work.bulk.toolbarLabel'),
      exact: true,
    })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    let arrived: (() => void) | undefined
    const arrival = new Promise<void>((resolveArrival) => {
      arrived = resolveArrival
    })
    await page.route('**/api/v1/cards/bulk', async (route) => {
      const response = await route.fetch()
      arrived?.()
      await held
      await route.fulfill({ response })
    })
    await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
    await page.getByRole('menuitem', { name: label('work.priority.high'), exact: true }).click()
    await arrival
    await page.screenshot({ path: test.info().outputPath('bulk-pending-controls.png') })
    await expect
      .soft(toolbar.getByRole('button', { name: label('work.bulk.due'), exact: true }))
      .toBeDisabled()
    await selectCard(page, ids[2]!)
    release?.()
    await expect(
      page.getByText(label('work.bulk.prioritySet', { count: 2 }), { exact: true }),
    ).toBeVisible()
    for (const id of ids.slice(0, 2))
      expect((await (await context.request.get(`/api/v1/cards/${id}`)).json()).priority).toBe(
        'high',
      )
    expect((await (await context.request.get(`/api/v1/cards/${ids[2]}`)).json()).priority).toBe(
      'none',
    )
    const screenshot = test.info().outputPath('bulk-response-newer-selection.png')
    await page.screenshot({ path: screenshot })
    appendFileSync(
      test.info().outputPath('captures.jsonl'),
      JSON.stringify({
        state: 'bulk-response-newer-selection',
        screenshot,
        pixelInspected: false,
        finiteAnimationsSettled: false,
      }) + '\n',
    )
    await expect(page.locator(`[data-dnd-card="${ids[2]}"]`).getByRole('checkbox')).toBeChecked()
    await expect(toolbar).toContainText(label('work.bulk.selectedCount', { count: 1 }))
  } finally {
    await context.close()
  }
})

test('@qa recurrence save refusal keeps editable draft', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `QA recurrence edit ${randomUUID().slice(0, 8)}`
    const id = await card(context, title)
    const original = { freq: 'weekly', interval: 1, mode: 'schedule', weekdays: [1] }
    expect(
      (await authedPatch(context, `/api/v1/cards/${id}`, { recurrence: original })).status(),
    ).toBe(200)
    const page = await context.newPage()
    await open(page, id, title)
    const panel = await section(page, `card-repeat-${id}`)
    const freq = panel.getByLabel(label('work.recurrence.freqLabel'), { exact: true })
    await freq.selectOption('daily')
    await panel.getByLabel(label('work.recurrence.everyLabel'), { exact: true }).fill('2')
    await panel.getByRole('radio').nth(1).click()
    await panel.getByLabel(label('work.recurrence.countLabel'), { exact: true }).fill('3')
    let refuse = true
    await page.route(`**/api/v1/cards/${id}`, async (route) => {
      if (route.request().method() === 'PATCH' && refuse) {
        refuse = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await expect(page.getByText(label('work.recurrence.saveFailed'), { exact: true })).toBeVisible()
    expect((await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence).toEqual(
      original,
    )
    await freq.scrollIntoViewIfNeeded()
    await capture(page, 'recurrence-save-refusal-draft')
    await expect(freq).toHaveValue('daily')
    await expect(
      panel.getByLabel(label('work.recurrence.everyLabel'), { exact: true }),
    ).toHaveValue('2')
    await expect(panel.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true')
    await panel.getByRole('button', { name: label('common.save'), exact: true }).click()
    await expect(page.getByText(label('work.recurrence.saved'), { exact: true })).toBeVisible()
    expect(
      (await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence,
    ).toMatchObject({ freq: 'daily', interval: 2, mode: 'after_done', count: 3 })
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
    expect((await (await context.request.get(`/api/v1/cards/${id}`)).json()).recurrence).toBeNull()
  } finally {
    await context.close()
  }
})
