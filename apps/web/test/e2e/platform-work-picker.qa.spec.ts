import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { waitForLoadedRoute } from './platform-capture.js'
import type { Card } from '../../src/features/work/api.js'

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

test('@qa complete dependency pages retain literal search through later-page refusal and retry', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    async function create(title: string): Promise<string> {
      const response = await authedPost(context, '/api/v1/cards', { title, kind: 'task' })
      expect(response.status()).toBe(201)
      return ((await response.json()) as { id: string }).id
    }
    const initial = await context.request.get('/api/v1/cards?limit=100')
    expect(initial.status()).toBe(200)
    const initialPage = (await initial.json()) as { items: Card[]; nextCursor: string | null }
    if (initialPage.nextCursor === null) {
      for (let number = initialPage.items.length; number < 103; number++) {
        await create(`QA picker padding ${suffix} ${number}`)
      }
    }
    const title = `QA crowded dependency ${suffix}`
    const id = await create(title)
    const targetTitle = `QA literal Oʻzbek : q éй ${suffix}`
    const targetId = await create(targetTitle)
    const searchDraft = `Ozbek : q eи ${suffix}`
    let cursor: string | null = null
    const independentPages: { count: number; hasCursor: boolean; targetPresent: boolean }[] = []
    do {
      const params = new URLSearchParams({ limit: '100' })
      if (cursor) params.set('cursor', cursor)
      const response = await context.request.get(`/api/v1/cards?${params}`)
      expect(response.status()).toBe(200)
      const result = (await response.json()) as { items: Card[]; nextCursor: string | null }
      independentPages.push({
        count: result.items.length,
        hasCursor: result.nextCursor !== null,
        targetPresent: result.items.some((card) => card.id === targetId),
      })
      cursor = result.nextCursor
    } while (cursor !== null)
    expect(independentPages.length).toBeGreaterThan(1)
    expect(independentPages[0]!.targetPresent).toBe(false)
    expect(independentPages.some((page) => page.targetPresent)).toBe(true)

    const page = await context.newPage()
    let refuseLaterPage = true
    let release: (() => void) | undefined
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld
    })
    let arrived: (() => void) | undefined
    const laterPageArrival = new Promise<void>((resolveArrival) => {
      arrived = resolveArrival
    })
    const browserPages: { cursor: boolean; refused: boolean }[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/cards' && url.searchParams.get('limit') === '100',
      async (route) => {
        const hasCursor = new URL(route.request().url()).searchParams.has('cursor')
        browserPages.push({ cursor: hasCursor, refused: hasCursor && refuseLaterPage })
        if (hasCursor && refuseLaterPage) {
          arrived?.()
          await held
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Local later-page refusal', status: 503 }),
          })
        } else await route.continue()
      },
    )
    await page.goto(`/work?card=${id}`)
    await waitForLoadedRoute(page, '/work')
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
    ).toHaveValue(title)
    const toggle = page.locator(`button[aria-controls="card-deps-${id}"]`)
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    const panel = page.locator(`[id="card-deps-${id}"]`)
    await expect(
      panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }),
    ).toBeVisible()
    expect(browserPages).toEqual([])
    await panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
    await laterPageArrival
    await panel.getByRole('combobox').click()
    const search = page.getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true })
    await search.fill(searchDraft)
    await expect(
      page.getByText(label('work.dependencies.pickEmpty'), { exact: true }),
    ).not.toBeVisible()
    await expect(page.locator('[cmdk-item][role="option"]')).toHaveCount(0)
    release?.()
    const retry = panel.getByRole('button', { name: label('state.error.action'), exact: true })
    await expect(retry).toBeVisible({ timeout: 30_000 })
    await expect(panel.getByRole('combobox')).toHaveCount(0)
    await expect(page.locator('[cmdk-item][role="option"]:visible')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('later-page-refusal.png') })
    refuseLaterPage = false
    await retry.click()
    await expect(panel.getByRole('combobox')).toBeVisible()
    if (!(await search.isVisible())) await panel.getByRole('combobox').click()
    await expect(search).toHaveValue(searchDraft)
    const target = page.getByRole('option', { name: targetTitle, exact: true })
    await expect(target).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('later-page-recovered-search.png') })
    await target.click()
    await expect(panel.getByRole('button', { name: targetTitle, exact: true })).toBeVisible()
    const read = await context.request.get(`/api/v1/cards/${id}/dependencies`)
    expect(read.status()).toBe(200)
    expect((await read.json()).blockedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ card: expect.objectContaining({ id: targetId }) }),
      ]),
    )
    await page.reload()
    await waitForLoadedRoute(page, '/work')
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await expect(panel.getByRole('button', { name: targetTitle, exact: true })).toBeVisible()
    writeFileSync(
      test.info().outputPath('candidate-pages.json'),
      JSON.stringify(
        {
          independentPages,
          totalCards: independentPages.reduce((sum, page) => sum + page.count, 0),
          browserPages,
          searchDraft,
          recoveredSearch: searchDraft,
          persistedBlockerId: targetId,
          fault:
            'Controlled HTTP503 for actual later-page request; real cursor responses and real add/persist/reload',
        },
        null,
        2,
      ),
    )
  } finally {
    await context.close()
  }
})
