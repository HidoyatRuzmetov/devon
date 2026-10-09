import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import type { NotificationListDto } from '../../src/features/inbox/api.js'
import { settleCapture } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

const evidence = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/inbox')

async function list(context: BrowserContext, status = 'inbox') {
  const response = await context.request.get(`/api/v1/notifications?status=${status}&limit=30`)
  expect(response.status()).toBe(200)
  return (await response.json()) as NotificationListDto
}

async function openInbox(context: BrowserContext) {
  await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  // Each journey starts from the same populated, local-only seed. Archive tests deliberately
  // persist their writes; restore those owned fixture rows before the next browser/journey rather
  // than allowing earlier cases to consume the later cases' input data.
  const archived = await list(context, 'archived')
  if (archived.items.length > 0) {
    const response = await authedPost(context, '/api/v1/notifications/restore', {
      ids: archived.items.map((notification) => notification.id),
    })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ updated: archived.items.length })
  }
  expect(
    (await list(context)).items.length,
    'independent populated fixture read',
  ).toBeGreaterThanOrEqual(2)
  const page = await context.newPage()
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  return page
}

function row(page: Page, title: string) {
  return page.getByRole('button').filter({ hasText: title }).first().locator('..')
}

test('@qa inbox archive persists when leaving immediately', async ({ browser }, info) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    const notification = (await list(context)).items[0]!
    expect(notification, 'populated synthetic notification fixture').toBeTruthy()
    await row(page, notification.title.en!)
      .getByRole('button', { name: 'Archive', exact: true })
      .click()
    await expect(
      page.getByText('Archived', { exact: true }).filter({ visible: true }).last(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Notification preferences', exact: true }).click()
    await expect(page).toHaveURL(/\/account\/notifications$/)
    const archived = await list(context, 'archived')
    expect(archived.items.some((item) => item.id === notification.id)).toBe(true)
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    await expect(
      page
        .getByRole('tabpanel')
        .filter({ visible: true })
        .getByRole('button')
        .filter({ hasText: notification.title.en! }),
    ).toHaveCount(0)
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-archive-persisted.png`),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('@qa inbox undo restores only the selected persisted notification', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    const [first, second] = (await list(context)).items
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    await row(page, first!.title.en!).getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
    expect(
      (await authedPost(context, '/api/v1/notifications/archive', { ids: [second!.id] })).status(),
    ).toBe(200)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(async () => (await list(context)).items.some((n) => n.id === first!.id))
      .toBe(true)
    expect((await list(context, 'archived')).items.some((n) => n.id === second!.id)).toBe(true)
    await page.reload()
    await expect(row(page, first!.title.en!)).toBeVisible()
    const other = await newFlowContext(browser)
    try {
      await login(other, { login: 'demo.xodim', password: qaExampleCredential1 })
      const response = await authedPost(other, '/api/v1/notifications/restore', {
        ids: [second!.id],
      })
      expect(response.status()).toBe(200)
      expect(await response.json()).toEqual({ updated: 0 })
      expect((await list(context, 'archived')).items.some((n) => n.id === second!.id)).toBe(true)
    } finally {
      await other.close()
    }
  } finally {
    await context.close()
  }
})

test('@qa inbox failed archive retains the row and reports failure', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    const notification = (await list(context)).items[0]!
    await page.route('**/api/v1/notifications/archive', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Controlled local fault', status: 503 }),
      }),
    )
    await row(page, notification.title.en!)
      .getByRole('button', { name: 'Archive', exact: true })
      .click()
    await expect(page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(row(page, notification.title.en!)).toBeVisible()
    expect((await list(context)).items.some((n) => n.id === notification.id)).toBe(true)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa inbox toolbar Enter activates its focused control', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    const preferences = page.getByRole('button', { name: 'Notification preferences', exact: true })
    await preferences.focus()
    await preferences.press('Enter')
    await expect(page).toHaveURL(/\/account\/notifications$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa inbox row shortcuts follow visible order and archive the focused row', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    await page.setViewportSize({ width: 768, height: 600 })
    const panel = page.getByRole('tabpanel').filter({ visible: true })
    const openers = panel.locator('[data-inbox-opener]')
    const first = openers.nth(0)
    const second = openers.nth(1)
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    const firstId = await first.getAttribute('data-inbox-opener')
    const secondId = await second.getAttribute('data-inbox-opener')
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    await first.focus()
    await first.press('j')
    await expect(second).toBeFocused()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await second.press('k')
    await expect(first).toBeFocused()
    await first.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').press('Escape')
    await expect(first).toBeFocused()
    await second.focus()
    await second.press('e')
    await expect
      .poll(async () => (await list(context, 'archived')).items.some((n) => n.id === secondId))
      .toBe(true)
    expect((await list(context)).items.some((n) => n.id === firstId)).toBe(true)
  } finally {
    await context.close()
  }
})

test('@qa inbox row Archive button returns focus to a surviving row', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    const panel = page.getByRole('tabpanel').filter({ visible: true })
    const first = panel.locator('[data-inbox-opener]').nth(0)
    const second = panel.locator('[data-inbox-opener]').nth(1)
    const archivedId = await first.getAttribute('data-inbox-opener')
    const nextId = await second.getAttribute('data-inbox-opener')
    expect(archivedId).toBeTruthy()
    expect(nextId).toBeTruthy()
    const archive = first.locator('..').getByRole('button', { name: 'Archive', exact: true })
    await archive.focus()
    await archive.press('Enter')
    await expect
      .poll(async () => (await list(context, 'archived')).items.some((n) => n.id === archivedId))
      .toBe(true)
    await expect(panel.locator(`[data-inbox-opener="${nextId}"]`)).toBeFocused()
  } finally {
    await context.close()
  }
})

test('@qa inbox detail keeps a failed archive open and retry returns focus safely', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    await page.setViewportSize({ width: 768, height: 600 })
    const notification = (await list(context)).items[0]!
    await row(page, notification.title.en!)
      .getByRole('button')
      .filter({ hasText: notification.title.en! })
      .click()
    const detail = page.getByRole('dialog')
    await expect(detail).toBeVisible()
    const fault = '**/api/v1/notifications/archive'
    await page.route(fault, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Controlled local fault', status: 503 }),
      }),
    )
    await detail.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(detail).toBeVisible()
    expect((await list(context)).items.some((n) => n.id === notification.id)).toBe(true)
    await page.unroute(fault)
    await detail.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(detail).toHaveCount(0)
    expect((await list(context, 'archived')).items.some((n) => n.id === notification.id)).toBe(true)
    await expect(page.getByRole('tab', { name: 'All', exact: true })).toBeFocused()
  } finally {
    await context.close()
  }
})

test('@qa inbox keyboard tabs and tablet detail sheet remain reachable', async ({
  browser,
}, info) => {
  const context = await newFlowContext(browser)
  try {
    const page = await openInbox(context)
    await page.setViewportSize({ width: 768, height: 600 })
    const all = page.getByRole('tab', { name: 'All', exact: true })
    await all.focus()
    await all.press('End')
    await expect(page.getByRole('tab', { name: 'Archived', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('tab', { name: 'Archived', exact: true }).press('Home')
    await expect(all).toHaveAttribute('aria-selected', 'true')
    const notification = (await list(context)).items[0]!
    const opener = row(page, notification.title.en!)
      .getByRole('button')
      .filter({ hasText: notification.title.en! })
    await opener.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(opener).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(overflow).toBeLessThanOrEqual(769)
    await settleCapture(page)
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-tablet-inbox.png`),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})
