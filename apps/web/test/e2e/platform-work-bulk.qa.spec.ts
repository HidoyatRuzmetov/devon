/* eslint-disable no-restricted-syntax -- Each native action must settle before the next selection. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { waitForLoadedRoute } from './platform-capture.js'
import { fullName } from '../../src/features/work/lib/format.js'
import type { Board, CardDetail } from '../../src/features/work/api.js'

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
async function read(context: BrowserContext, id: string): Promise<CardDetail> {
  const response = await context.request.get(`/api/v1/cards/${id}`)
  expect(response.status()).toBe(200)
  return response.json() as Promise<CardDetail>
}
async function select(page: Page, ids: string[]) {
  for (const id of ids) {
    const tile = page.locator(`[data-dnd-card="${id}"]`)
    await tile.hover()
    await page.evaluate((cardId) => {
      document.documentElement.dataset['qaBulkPointer'] = '[]'
      document.documentElement.dataset['qaBulkCard'] = cardId
      if (document.documentElement.dataset['qaBulkListening']) return
      document.documentElement.dataset['qaBulkListening'] = 'true'
      for (const type of ['pointerdown', 'focusin', 'scroll', 'pointerup', 'click']) {
        document.addEventListener(
          type,
          (event) => {
            if (!(event.target instanceof Element)) return
            const card = document.querySelector(
              `[data-dnd-card="${document.documentElement.dataset['qaBulkCard']}"]`,
            )
            const checkbox = card?.querySelector('[role="checkbox"]')
            const ancestry = []
            for (
              let ancestor = checkbox?.parentElement;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const style = getComputedStyle(ancestor)
              if (
                style.transform !== 'none' ||
                ancestor.scrollWidth > ancestor.clientWidth ||
                ancestor.scrollHeight > ancestor.clientHeight
              )
                ancestry.push({
                  tag: ancestor.tagName,
                  className: ancestor.className,
                  transform: style.transform,
                  bounds: ancestor.getBoundingClientRect().toJSON(),
                  scrollLeft: ancestor.scrollLeft,
                  scrollTop: ancestor.scrollTop,
                })
            }
            const entries = JSON.parse(document.documentElement.dataset['qaBulkPointer'] ?? '[]')
            entries.push({
              type,
              time: performance.now(),
              point: event instanceof PointerEvent ? { x: event.clientX, y: event.clientY } : null,
              tile: event.target.closest('[data-dnd-card]')?.getAttribute('data-dnd-card'),
              target: event.target.tagName,
              targetBounds: event.target.getBoundingClientRect().toJSON(),
              checkboxBounds: checkbox?.getBoundingClientRect().toJSON(),
              ancestry,
              activeTile: document.activeElement
                ?.closest('[data-dnd-card]')
                ?.getAttribute('data-dnd-card'),
              activeRole: document.activeElement?.getAttribute('role'),
              toastBounds: [...document.querySelectorAll('[data-sonner-toast]')].map((toast) => ({
                bounds: toast.getBoundingClientRect().toJSON(),
                visible: toast.getAttribute('data-visible'),
                removed: toast.getAttribute('data-removed'),
              })),
              targetClass: event.target.getAttribute('class'),
              sonnerToast: event.target
                .closest('[data-sonner-toast]')
                ?.getAttribute('data-sonner-toast'),
              sonnerToaster: event.target
                .closest('[data-sonner-toaster]')
                ?.getAttribute('data-sonner-toaster'),
              role: event.target.closest('[role]')?.getAttribute('role'),
              checked: event.target.closest('[role="checkbox"]')?.getAttribute('aria-checked'),
            })
            document.documentElement.dataset['qaBulkPointer'] = JSON.stringify(entries.slice(-24))
          },
          true,
        )
      }
    }, id)
    try {
      await tile.getByRole('checkbox').check()
    } finally {
      const diagnostic = await tile.evaluate((element) => {
        const checkbox = element.querySelector('[role="checkbox"]')
        const bounds = checkbox?.getBoundingClientRect()
        const hit = bounds
          ? document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          : null
        return {
          tile: element.getAttribute('data-dnd-card'),
          checked: checkbox?.getAttribute('aria-checked'),
          bounds: bounds?.toJSON(),
          hitTile: hit?.closest('[data-dnd-card]')?.getAttribute('data-dnd-card'),
          hitRole: hit?.closest('[role]')?.getAttribute('role'),
          events: JSON.parse(document.documentElement.dataset['qaBulkPointer'] ?? '[]'),
        }
      })
      appendFileSync(
        test.info().outputPath('selection-diagnostics.jsonl'),
        JSON.stringify(diagnostic) + '\n',
      )
    }
  }
  return page.getByRole('toolbar', { name: label('work.bulk.toolbarLabel'), exact: true })
}
async function undo(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/cards/bulk/undo') && r.status() === 200,
  )
  await page
    .getByRole('button', { name: label('action.undo'), exact: true })
    .last()
    .click()
  await response
}
test('@qa bulk label undo restores mixed original labels', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const name = `QA bulk label ${randomUUID().slice(0, 8)}`
    const result = await authedPost(context, '/api/v1/labels', { name, colour: '#285C48' })
    expect(result.status()).toBe(201)
    const { id: labelId } = (await result.json()) as { id: string }
    const existingResponse = await context.request.get('/api/v1/labels')
    expect(existingResponse.status()).toBe(200)
    const existing = ((await existingResponse.json()) as { id: string }[]).find(
      (row) => row.id !== labelId,
    )!
    const a = await create(context, `${name} first`, { labels: [existing.id] })
    const b = await create(context, `${name} second`)
    const page = await context.newPage()
    await page.goto('/work')
    await waitForLoadedRoute(page, '/work')
    const toolbar = await select(page, [a, b])
    await toolbar.getByRole('button', { name: label('work.bulk.label'), exact: true }).click()
    const applied = page.waitForResponse(
      (r) => r.url().endsWith('/cards/bulk') && r.status() === 200,
    )
    await page.getByRole('menuitem', { name, exact: true }).first().click()
    await applied
    expect((await read(context, a)).labels.slice().sort()).toEqual([existing.id, labelId].sort())
    expect((await read(context, b)).labels).toEqual([labelId])
    await undo(page)
    await page.screenshot({ path: test.info().outputPath('bulk-label-after-undo.png') })
    expect((await read(context, a)).labels).toEqual([existing.id])
    expect((await read(context, b)).labels).toEqual([])
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    expect((await read(context, b)).labels).toEqual([])
  } finally {
    await context.close()
  }
})

test('@qa bulk assignment priority estimate due status archive refusal and clear', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const ids = [
      await create(context, `QA batch first ${suffix}`),
      await create(context, `QA batch second ${suffix}`),
    ]
    const boardResponse = await context.request.get('/api/v1/board')
    expect(boardResponse.status()).toBe(200)
    const board = (await boardResponse.json()) as Board
    const member = board.members.find((row) => row.role === 'member')!
    const page = await context.newPage()
    await page.goto('/work')
    await waitForLoadedRoute(page, '/work')
    let toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.clear'), exact: true }).click()
    await expect(toolbar).not.toBeVisible()
    expect((await read(context, ids[0]!)).priority).toBe('none')
    toolbar = await select(page, ids)
    let refuse = true
    await page.route('**/api/v1/cards/bulk', async (route) => {
      if (refuse) {
        refuse = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ title: 'Local QA refusal', status: 503 }),
        })
      } else await route.continue()
    })
    await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
    await page.getByRole('menuitem', { name: label('work.priority.urgent'), exact: true }).click()
    await expect(page.getByText(label('work.bulk.failed'), { exact: true })).toBeVisible()
    expect((await read(context, ids[0]!)).priority).toBe('none')
    await expect(page.locator(`[data-dnd-card="${ids[0]}"]`).getByRole('checkbox')).toBeChecked()
    for (const priority of ['urgent', 'high', 'medium', 'low', 'none']) {
      toolbar = await select(page, ids)
      const changed = page.waitForResponse(
        (r) => r.url().endsWith('/cards/bulk') && r.status() === 200,
      )
      await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
      await page
        .getByRole('menuitem', { name: label(`work.priority.${priority}`), exact: true })
        .click()
      await changed
      expect((await read(context, ids[0]!)).priority).toBe(priority)
      expect((await read(context, ids[1]!)).priority).toBe(priority)
    }
    toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.assign'), exact: true }).click()
    let changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page.getByRole('menuitem', { name: fullName(member), exact: true }).click()
    await changed
    expect((await read(context, ids[0]!)).assigneeUserId).toBe(member.userId)
    toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.assign'), exact: true }).click()
    changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page.getByRole('menuitem', { name: label('work.field.unassigned'), exact: true }).click()
    await changed
    expect((await read(context, ids[1]!)).assigneeUserId).toBeNull()
    toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.estimate'), exact: true }).click()
    await page
      .getByPlaceholder(label('work.estimate.placeholder'), { exact: true })
      .fill('invalid duration')
    await page
      .getByRole('menu')
      .getByRole('button', { name: label('common.save'), exact: true })
      .click()
    await expect(page.getByText(label('work.estimate.unreadable'), { exact: true })).toBeVisible()
    expect((await read(context, ids[0]!)).estimateMin).toBeNull()
    await page.getByPlaceholder(label('work.estimate.placeholder'), { exact: true }).fill('1h 30m')
    changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page
      .getByRole('menu')
      .getByRole('button', { name: label('common.save'), exact: true })
      .click()
    await changed
    expect((await read(context, ids[0]!)).estimateMin).toBe(90)
    toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.estimate'), exact: true }).click()
    changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page.getByRole('button', { name: label('work.bulk.clearEstimate'), exact: true }).click()
    await changed
    expect((await read(context, ids[1]!)).estimateMin).toBeNull()
    toolbar = await select(page, ids)
    await toolbar.getByRole('button', { name: label('work.bulk.due'), exact: true }).click()
    changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page
      .getByRole('dialog')
      .getByRole('grid')
      .locator('button')
      .filter({ hasText: /^15$/ })
      .first()
      .click()
    await changed
    expect((await read(context, ids[0]!)).dueAt).not.toBeNull()
    await undo(page)
    expect((await read(context, ids[1]!)).dueAt).toBeNull()
    for (const [action, status] of [
      ['work.bulk.markDone', 'done'],
      ['work.card.archive', 'archived'],
    ]) {
      toolbar = await select(page, ids)
      changed = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
      await toolbar.getByRole('button', { name: label(action!), exact: true }).click()
      await changed
      expect((await read(context, ids[0]!)).status).toBe(status)
      expect((await read(context, ids[1]!)).status).toBe(status)
      await undo(page)
      expect((await read(context, ids[0]!)).status).toBe('active')
    }
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    expect((await read(context, ids[0]!)).status).toBe('active')
    expect((await read(context, ids[1]!)).status).toBe('active')
  } finally {
    await context.close()
  }
})

test('@qa bulk mixed ownership preserves refusal selection and never reports an empty Undo as success', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: examplePassword })
    await login(head, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const own = await create(context, `QA own batch ${suffix}`)
    const forbidden = await create(head, `QA forbidden batch ${suffix}`)
    const page = await context.newPage()
    await page.goto('/work')
    await waitForLoadedRoute(page, '/work')
    let toolbar = await select(page, [own, forbidden])
    await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
    const changed = page.waitForResponse(
      (r) => r.url().endsWith('/cards/bulk') && r.status() === 200,
    )
    await page.getByRole('menuitem', { name: label('work.priority.high'), exact: true }).click()
    const body = (await (await changed).json()) as { updated: string[]; forbidden: string[] }
    expect(body.updated).toEqual([own])
    expect(body.forbidden).toEqual([forbidden])
    expect((await read(context, own)).priority).toBe('high')
    expect((await read(context, forbidden)).priority).toBe('none')
    await expect(page.locator(`[data-dnd-card="${own}"]`).getByRole('checkbox')).not.toBeChecked()
    await expect(page.locator(`[data-dnd-card="${forbidden}"]`).getByRole('checkbox')).toBeChecked()
    await expect(
      page.getByText(label('work.bulk.partial').replace('{count}', '1'), { exact: false }),
    ).toBeVisible()
    await undo(page)
    expect((await read(context, own)).priority).toBe('none')
    toolbar = await select(page, [forbidden])
    await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
    const none = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page.getByRole('menuitem', { name: label('work.priority.high'), exact: true }).click()
    expect(((await (await none).json()) as { updated: string[] }).updated).toEqual([])
    await expect(page.getByText(label('work.bulk.noneApplied'), { exact: true })).toBeVisible()
    expect((await read(context, forbidden)).priority).toBe('none')
    await expect(page.getByText(label('work.bulk.noneApplied'), { exact: true })).toHaveCount(0, {
      timeout: 15_000,
    })
    await page.route('**/api/v1/cards/bulk/undo', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: [], forbidden: [own], notFound: [], undo: [] }),
      }),
    )
    toolbar = await select(page, [own])
    await toolbar.getByRole('button', { name: label('work.bulk.priority'), exact: true }).click()
    const next = page.waitForResponse((r) => r.url().endsWith('/cards/bulk') && r.status() === 200)
    await page.getByRole('menuitem', { name: label('work.priority.high'), exact: true }).click()
    await next
    await undo(page)
    expect((await read(context, own)).priority).toBe('high')
    await expect(page.getByText(label('work.bulk.noneApplied'), { exact: true })).toBeVisible()
  } finally {
    await Promise.all([context.close(), head.close()])
  }
})
