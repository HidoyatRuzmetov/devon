/* eslint-disable no-restricted-syntax -- A browser's gallery consume/reload transitions must run sequentially. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { authedPatch, authedPost, csrfToken, login, newFlowContext } from './flow-api.js'
import type { WorkTemplate } from '../../src/features/work/api-plus.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(locale: string, key: string, params: Record<string, string> = {}): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing ${locale}:${key}`)
  return value.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match)
}
async function templates(context: BrowserContext): Promise<WorkTemplate[]> {
  const response = await context.request.get('/api/v1/work/templates?kind=card')
  expect(response.status()).toBe(200)
  return response.json() as Promise<WorkTemplate[]>
}
function galleryCard(page: Page, name: string): Locator {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
}
async function screenshot(page: Page, name: string, metadata: Record<string, unknown> = {}) {
  await settleCapture(page, false)
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path })
  appendFileSync(
    test.info().outputPath('captures.jsonl'),
    JSON.stringify({ ...metadata, screenshot: path, pixelInspected: false }) + '\n',
  )
}
async function openCard(
  page: Page,
  context: BrowserContext,
  title: string,
  recurrence?: unknown,
): Promise<string> {
  const response = await authedPost(context, '/api/v1/cards', {
    title,
    kind: 'task',
  })
  expect(response.status()).toBe(201)
  const { id } = (await response.json()) as { id: string }
  if (recurrence)
    expect((await authedPatch(context, `/api/v1/cards/${id}`, { recurrence })).status()).toBe(200)
  await page.goto(`/work?card=${id}`)
  await waitForLoadedRoute(page, '/work')
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue(title)
  return id
}
async function section(page: Page, id: string): Promise<Locator> {
  const toggle = page.locator(`button[aria-controls="${id}"]`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.locator(`[id="${id}"]`)
  await expect(panel).toBeVisible()
  return panel
}
test('@qa card template curation discoverability', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const name = `QA editable card template ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/work/templates', {
      kind: 'card',
      scope: 'department',
      name,
      payload: {
        title: 'Existing template card',
        description: 'Existing card description',
        priority: 'high',
        dueInDays: 7,
        estimateMin: 90,
        labels: [],
        checklist: ['First instruction', 'Second instruction'],
      },
    })
    expect(response.status()).toBe(201)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/work/templates')
    await waitForLoadedRoute(page, '/work/templates')
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(card).toBeVisible()
    await settleCapture(page)
    await page.screenshot({
      path: test.info().outputPath('card-template-gallery-curation.png'),
      fullPage: true,
    })
    await expect
      .soft(page.getByRole('button', { name: 'New card template', exact: true }))
      .toBeVisible()
    await expect.soft(card.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('@qa card template head curation persistence refusal slow cancel use delete', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    const name = `QA curated ${randomUUID().slice(0, 8)}`
    const title = `QA instruction ${randomUUID().slice(0, 8)}`
    const checklist = ['First preserved instruction', 'Second preserved instruction']
    await page.goto('/work/templates')
    await waitForLoadedRoute(page, '/work/templates')
    const opener = page.getByRole('button', {
      name: label('en', 'work.templateEditor.new'),
      exact: true,
    })
    await opener.click()
    let dialog = page.getByRole('dialog', {
      name: label('en', 'work.templateEditor.new'),
      exact: true,
    })
    await dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }).fill(name)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.cardTitle'), { exact: true })
      .fill(title)
    await dialog.getByRole('button', { name: label('en', 'common.cancel'), exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
    expect((await templates(context)).find((row) => row.name === name)).toBeUndefined()
    await opener.click()
    dialog = page.getByRole('dialog', { name: label('en', 'work.templateEditor.new'), exact: true })
    await dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }).fill(name)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.cardTitle'), { exact: true })
      .fill(title)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.scope'), { exact: true })
      .selectOption('department')
    await dialog
      .getByLabel(label('en', 'work.templateEditor.checklist'), { exact: true })
      .fill(checklist.join('\n'))
    let failCreate = true
    await page.route('**/api/v1/work/templates', async (route) => {
      if (route.request().method() === 'POST' && failCreate) {
        failCreate = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: label('en', 'common.save'), exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      label('en', 'work.templateEditor.saveFailed'),
    )
    await expect(
      dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }),
    ).toHaveValue(name)
    await expect(
      dialog.getByLabel(label('en', 'work.templateEditor.checklist'), { exact: true }),
    ).toHaveValue(checklist.join('\n'))
    expect((await templates(context)).find((row) => row.name === name)).toBeUndefined()
    await screenshot(page, 'curation-create-refusal-draft', {
      state: 'create-refusal-draft',
      locale: 'en',
      theme: 'light',
    })
    await dialog.getByRole('button', { name: label('en', 'common.save'), exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(galleryCard(page, name)).toBeVisible()
    const created = (await templates(context)).find((row) => row.name === name)!
    expect(created.scope).toBe('department')
    expect(created.payload).toEqual({ title, checklist })
    const metadata = {
      title,
      checklist,
      description: 'Keep the original description',
      priority: 'high',
      dueInDays: 7,
      estimateMin: 90,
      labels: [],
    }
    expect(
      (
        await authedPatch(context, `/api/v1/work/templates/${created.id}`, {
          payload: metadata,
          description: 'Gallery description remains',
        })
      ).status(),
    ).toBe(204)
    await page.reload()
    await waitForLoadedRoute(page, '/work/templates')
    const edit = galleryCard(page, name).getByRole('button', {
      name: label('en', 'work.templateEditor.edit', { name }),
      exact: true,
    })
    await edit.click()
    dialog = page.getByRole('dialog', {
      name: label('en', 'work.templateEditor.editTitle'),
      exact: true,
    })
    const renamed = `${name} renamed`
    const changedTitle = `${title} edited`
    await dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }).fill(renamed)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.cardTitle'), { exact: true })
      .fill(changedTitle)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(edit).toBeFocused()
    expect((await templates(context)).find((row) => row.id === created.id)?.name).toBe(name)
    await edit.click()
    await dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }).fill(renamed)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.cardTitle'), { exact: true })
      .fill(changedTitle)
    let release: (() => void) | undefined
    let requests = 0
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    let arrived: (() => void) | undefined
    const arrival = new Promise<void>((resolveArrival) => {
      arrived = resolveArrival
    })
    await page.route(`**/api/v1/work/templates/${created.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        requests += 1
        arrived?.()
        await held
        await route.fulfill({ response: await route.fetch() })
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: label('en', 'common.save'), exact: true }).click()
    await arrival
    await expect(
      dialog.getByLabel(label('en', 'work.templateEditor.name'), { exact: true }),
    ).toBeDisabled()
    await expect(
      dialog.getByRole('button', { name: label('en', 'common.cancel'), exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect((await templates(context)).find((row) => row.id === created.id)?.name).toBe(name)
    expect(requests).toBe(1)
    release?.()
    await expect(dialog).not.toBeVisible()
    await expect(galleryCard(page, renamed)).toBeVisible()
    const edited = (await templates(context)).find((row) => row.id === created.id)!
    expect(edited.payload).toEqual({ ...metadata, title: changedTitle })
    expect(edited.description).toBe('Gallery description remains')
    await page.reload()
    await waitForLoadedRoute(page, '/work/templates')
    await expect(galleryCard(page, renamed)).toBeVisible()
    const use = galleryCard(page, renamed).getByRole('button', {
      name: label('en', 'work.templates.createCard'),
      exact: true,
    })
    let failUse = true
    await page.route(`**/api/v1/work/templates/${created.id}/create-card`, async (route) => {
      if (failUse) {
        failUse = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await use.click()
    await expect(
      page.getByText(label('en', 'work.templates.createFailed'), { exact: true }),
    ).toBeVisible()
    expect((await templates(context)).find((row) => row.id === created.id)?.useCount).toBe(0)
    const consumed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/work/templates/${created.id}/create-card`) &&
        response.status() === 201,
    )
    await use.click()
    const { id: cardId } = (await (await consumed).json()) as { id: string }
    await expect(page).toHaveURL(new RegExp(`card=${cardId}`))
    const read = await context.request.get(`/api/v1/cards/${cardId}`)
    expect(read.status()).toBe(200)
    const card = (await read.json()) as {
      title: string
      description: { text: string }
      priority: string
      estimateMin: number
      dueAt: string
      checklist: { text: string }[]
    }
    expect(card.title).toBe(changedTitle)
    expect(card.description.text).toBe(metadata.description)
    expect(card.priority).toBe('high')
    expect(card.estimateMin).toBe(90)
    expect(card.checklist.map((item) => item.text)).toEqual(checklist)
    expect(Math.abs(new Date(card.dueAt).getTime() - Date.now() - 7 * 86_400_000)).toBeLessThan(
      120_000,
    )
    expect((await templates(context)).find((row) => row.id === created.id)?.useCount).toBe(1)
    await page.goto('/work/templates')
    await waitForLoadedRoute(page, '/work/templates')
    let failDelete = true
    await page.route(`**/api/v1/work/templates/${created.id}`, async (route) => {
      if (route.request().method() === 'DELETE' && failDelete) {
        failDelete = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    const remove = galleryCard(page, renamed).getByRole('button', {
      name: label('en', 'work.templates.delete', { name: renamed }),
      exact: true,
    })
    await remove.click()
    await expect(
      page.getByText(label('en', 'work.templates.deleteFailed'), { exact: true }),
    ).toBeVisible()
    expect((await templates(context)).some((row) => row.id === created.id)).toBe(true)
    await remove.click()
    await expect(galleryCard(page, renamed)).not.toBeVisible()
    expect((await templates(context)).some((row) => row.id === created.id)).toBe(false)
    await page.reload()
    await waitForLoadedRoute(page, '/work/templates')
    await expect(galleryCard(page, renamed)).not.toBeVisible()
    expect((await context.request.get(`/api/v1/cards/${cardId}`)).status()).toBe(200)
  } finally {
    await context.close()
  }
})

test('@qa card template member personal curation department permission boundary', async ({
  browser,
}) => {
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await login(head, { login: 'demo.boshliq', password: examplePassword })
    await login(member, { login: 'demo.xodim', password: examplePassword })
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const name = `QA head gallery ${randomUUID().slice(0, 8)}`
    const response = await authedPost(head, '/api/v1/work/templates', {
      kind: 'card',
      scope: 'department',
      name,
      payload: { title: name, checklist: ['Member can consume'] },
    })
    expect(response.status()).toBe(201)
    const { id } = (await response.json()) as { id: string }
    const page = await member.newPage()
    await page.goto('/work/templates')
    await waitForLoadedRoute(page, '/work/templates')
    const shared = galleryCard(page, name)
    await expect(shared).toBeVisible()
    await expect(
      shared.getByRole('button', {
        name: label('en', 'work.templateEditor.edit', { name }),
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      shared.getByRole('button', {
        name: label('en', 'work.templates.delete', { name }),
        exact: true,
      }),
    ).toHaveCount(0)
    expect(
      (
        await authedPatch(member, `/api/v1/work/templates/${id}`, { name: `${name} forbidden` })
      ).status(),
    ).toBe(403)
    expect(
      (
        await authedPost(member, '/api/v1/work/templates', {
          kind: 'card',
          scope: 'department',
          name: `${name} forbidden`,
          payload: { title: name },
        })
      ).status(),
    ).toBe(403)
    await page
      .getByRole('button', { name: label('en', 'work.templateEditor.new'), exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: label('en', 'work.templateEditor.new'),
      exact: true,
    })
    const scope = dialog.getByLabel(label('en', 'work.templateEditor.scope'), { exact: true })
    await expect(scope.locator('option')).toHaveCount(1)
    await expect(scope).toHaveValue('personal')
    const personalName = `QA member private ${randomUUID().slice(0, 8)}`
    await dialog
      .getByLabel(label('en', 'work.templateEditor.name'), { exact: true })
      .fill(personalName)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.cardTitle'), { exact: true })
      .fill(personalName)
    await dialog
      .getByLabel(label('en', 'work.templateEditor.checklist'), { exact: true })
      .fill('Private instruction')
    await dialog.getByRole('button', { name: label('en', 'common.save'), exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(galleryCard(page, personalName)).toBeVisible()
    const personal = (await templates(member)).find((row) => row.name === personalName)!
    expect(personal.scope).toBe('personal')
    expect((await templates(head)).some((row) => row.id === personal.id)).toBe(false)
    expect(
      (
        await authedPatch(head, `/api/v1/work/templates/${personal.id}`, {
          name: 'Forbidden private edit',
        })
      ).status(),
    ).toBe(404)
    expect(
      (await authedPost(head, `/api/v1/work/templates/${personal.id}/create-card`, {})).status(),
    ).toBe(404)
    expect(
      (
        await head.request.delete(`/api/v1/work/templates/${personal.id}`, {
          headers: { 'x-csrf-token': await csrfToken(head) },
        })
      ).status(),
    ).toBe(404)
    await page.reload()
    await waitForLoadedRoute(page, '/work/templates')
    await expect(galleryCard(page, personalName)).toBeVisible()
    await screenshot(page, 'member-gallery-permission', {
      state: 'member-personal-and-department-read',
      locale: 'en',
      theme: 'light',
    })
    await galleryCard(page, personalName)
      .getByRole('button', {
        name: label('en', 'work.templateEditor.edit', { name: personalName }),
        exact: true,
      })
      .click()
    const editDialog = page.getByRole('dialog', {
      name: label('en', 'work.templateEditor.editTitle'),
      exact: true,
    })
    const renamed = `${personalName} edited`
    await editDialog
      .getByLabel(label('en', 'work.templateEditor.name'), { exact: true })
      .fill(renamed)
    await editDialog.getByRole('button', { name: label('en', 'common.save'), exact: true }).click()
    await expect(editDialog).not.toBeVisible()
    expect((await templates(member)).find((row) => row.id === personal.id)?.name).toBe(renamed)
    for (const [templateName, templateId, expectedChecklist] of [
      [renamed, personal.id, 'Private instruction'],
      [name, id, 'Member can consume'],
    ]) {
      await page.goto('/work/templates')
      await waitForLoadedRoute(page, '/work/templates')
      const consumed = page.waitForResponse(
        (r) => r.url().endsWith(`/work/templates/${templateId}/create-card`) && r.status() === 201,
      )
      await galleryCard(page, templateName!)
        .getByRole('button', { name: label('en', 'work.templates.createCard'), exact: true })
        .click()
      const { id: cardId } = (await (await consumed).json()) as { id: string }
      await expect(page).toHaveURL(new RegExp(`card=${cardId}`))
      const read = await member.request.get(`/api/v1/cards/${cardId}`)
      expect(read.status()).toBe(200)
      expect((await read.json()).checklist.map((row: { text: string }) => row.text)).toEqual([
        expectedChecklist,
      ])
    }
    await page.goto('/work/templates')
    await waitForLoadedRoute(page, '/work/templates')
    await galleryCard(page, renamed)
      .getByRole('button', {
        name: label('en', 'work.templates.delete', { name: renamed }),
        exact: true,
      })
      .click()
    await expect(galleryCard(page, renamed)).not.toBeVisible()
    expect((await templates(member)).some((row) => row.id === personal.id)).toBe(false)
    expect((await templates(member)).some((row) => row.id === id)).toBe(true)
  } finally {
    await Promise.all([head.close(), member.close()])
  }
})

test('@qa reminder slow response retains newer draft', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    const id = await openCard(page, context, `QA reminder ${randomUUID().slice(0, 8)}`)
    const panel = await section(page, `card-reminders-${id}`)
    const note = panel.getByLabel(label('en', 'work.reminders.noteLabel'), { exact: true })
    await note.fill('Submitted first reminder')
    let release: (() => void) | undefined
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    let arrived: (() => void) | undefined
    const arrival = new Promise<void>((resolveArrival) => {
      arrived = resolveArrival
    })
    await page.route(`**/api/v1/cards/${id}/reminders`, async (route) => {
      if (route.request().method() === 'POST') {
        const response = await route.fetch()
        arrived?.()
        await held
        await route.fulfill({ response })
      } else await route.continue()
    })
    await panel
      .getByRole('button', { name: label('en', 'work.reminders.add'), exact: true })
      .click()
    await arrival
    await note.fill('Newer unsaved reminder draft')
    const when = panel.getByLabel(label('en', 'work.reminders.whenLabel'), { exact: true })
    const newerWhen = '2027-02-12T11:30'
    await when.fill(newerWhen)
    release?.()
    await expect(panel.getByText('Submitted first reminder', { exact: true })).toBeVisible()
    const read = await context.request.get(`/api/v1/cards/${id}/reminders`)
    expect(read.status()).toBe(200)
    const rows = (await read.json()) as { note: string }[]
    expect(rows.map((row) => row.note)).toEqual(['Submitted first reminder'])
    await screenshot(page, 'reminder-response-newer-draft', {
      state: 'slow-response-newer-draft',
      locale: 'en',
      theme: 'light',
    })
    await expect.soft(note).toHaveValue('Newer unsaved reminder draft')
    await expect.soft(when).toHaveValue(newerWhen)
  } finally {
    await context.close()
  }
})

test('@qa recurrence refused stop retains persisted rule', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    const rule = { freq: 'weekly', interval: 1, mode: 'schedule', weekdays: [1] }
    const id = await openCard(page, context, `QA recurrence ${randomUUID().slice(0, 8)}`, rule)
    const panel = await section(page, `card-repeat-${id}`)
    await expect(
      panel.getByRole('button', { name: label('en', 'work.recurrence.stop'), exact: true }),
    ).toBeVisible()
    await page.route(`**/api/v1/cards/${id}`, async (route) => {
      if (route.request().method() === 'PATCH')
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      else await route.continue()
    })
    await panel
      .getByRole('button', { name: label('en', 'work.recurrence.stop'), exact: true })
      .click()
    await expect(
      page.getByText(label('en', 'work.recurrence.saveFailed'), { exact: true }),
    ).toBeVisible()
    const read = await context.request.get(`/api/v1/cards/${id}`)
    expect(read.status()).toBe(200)
    expect((await read.json()).recurrence).toEqual(rule)
    await screenshot(page, 'recurrence-refused-stop', {
      state: 'stop-refusal',
      locale: 'en',
      theme: 'light',
    })
    await expect(
      panel.getByRole('button', { name: label('en', 'work.recurrence.stop'), exact: true }),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})
